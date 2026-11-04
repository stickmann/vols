import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, lineGeom, pointGeom, timestamps } from "./_common.js";
import { cableTypes, equipmentModels } from "./catalog.js";
import {
  connectionKind,
  equipmentKind,
  fiberCondition,
  fiberSide,
  objectStatus,
  portFace,
  portRole,
  routeKind,
  siteKind,
  terminalKind,
} from "./enums.js";
import { tenants } from "./tenancy.js";

/*
 * Все ссылки между объектами сети — составные (tenant_id, id). Внешний ключ
 * проверяется в обход RLS, и без tenant_id в ключе можно было бы сослаться
 * на объект другого оператора, зная его uuid.
 */

const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

const props = () => jsonb("properties").$type<Record<string, unknown>>().notNull().default({});

// ---------------------------------------------------------------- инфраструктура

/** Место на карте: узел связи, опора, колодец, шкаф, здание... */
export const sites = pgTable(
  "sites",
  {
    id: id(),
    tenantId: tenantId(),
    kind: siteKind("kind").notNull(),
    name: text("name"),
    geom: pointGeom("geom").notNull(),
    address: text("address"),
    status: objectStatus("status").notNull().default("planned"),
    properties: props(),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    unique("sites_tenant_id_uq").on(t.tenantId, t.id),
    index("sites_geom_gix").using("gist", t.geom),
    index().on(t.tenantId, t.kind),
  ],
);

/**
 * Участок трассы между двумя местами: пролёт между опорами, канал канализации и т.п.
 * Концы линии триггером «прилипают» к координатам мест и двигаются вместе с ними.
 */
export const routes = pgTable(
  "routes",
  {
    id: id(),
    tenantId: tenantId(),
    kind: routeKind("kind").notNull(),
    name: text("name"),
    fromSiteId: uuid("from_site_id").notNull(),
    toSiteId: uuid("to_site_id").notNull(),
    geom: lineGeom("geom").notNull(),
    lengthM: doublePrecision("length_m")
      .notNull()
      .generatedAlwaysAs(sql`ST_Length(geom::geography)`),
    status: objectStatus("status").notNull().default("planned"),
    properties: props(),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    unique("routes_tenant_id_uq").on(t.tenantId, t.id),
    foreignKey({ name: "routes_from_site_fk", columns: [t.tenantId, t.fromSiteId], foreignColumns: [sites.tenantId, sites.id] }),
    foreignKey({ name: "routes_to_site_fk", columns: [t.tenantId, t.toSiteId], foreignColumns: [sites.tenantId, sites.id] }),
    check("routes_ends_ck", sql`${t.fromSiteId} <> ${t.toSiteId}`),
    check("routes_geom_ck", sql`ST_NPoints(${t.geom}) >= 2`),
    index("routes_geom_gix").using("gist", t.geom),
    index().on(t.fromSiteId),
    index().on(t.toSiteId),
  ],
);

// ---------------------------------------------------------------- оборудование

/**
 * Оборудование в месте: муфта на опоре, кросс и OLT в узле, сплиттер внутри муфты.
 * Вложенное оборудование (parent_id) всегда в том же месте, что и родитель.
 * Порты (terminals) создаются триггером по модели.
 */
export const equipment = pgTable(
  "equipment",
  {
    id: id(),
    tenantId: tenantId(),
    kind: equipmentKind("kind").notNull(),
    modelId: uuid("model_id").notNull(),
    siteId: uuid("site_id").notNull(),
    parentId: uuid("parent_id"),
    name: text("name"),
    serial: text("serial"),
    status: objectStatus("status").notNull().default("planned"),
    properties: props(),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    unique("equipment_tenant_id_uq").on(t.tenantId, t.id),
    unique("equipment_tenant_id_site_uq").on(t.tenantId, t.id, t.siteId),
    foreignKey({
      name: "equipment_model_fk",
      columns: [t.tenantId, t.modelId, t.kind],
      foreignColumns: [equipmentModels.tenantId, equipmentModels.id, equipmentModels.kind],
    }),
    foreignKey({ name: "equipment_site_fk", columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id] })
      .onUpdate("cascade"),
    foreignKey({
      name: "equipment_parent_fk",
      columns: [t.tenantId, t.parentId, t.siteId],
      foreignColumns: [t.tenantId, t.id, t.siteId],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    check("equipment_parent_ck", sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
    index().on(t.siteId),
    index().on(t.parentId),
  ],
);

// ---------------------------------------------------------------- кабели

/** Физический кабель (оболочка) определённого типа. */
export const cables = pgTable(
  "cables",
  {
    id: id(),
    tenantId: tenantId(),
    cableTypeId: uuid("cable_type_id").notNull(),
    name: text("name"),
    status: objectStatus("status").notNull().default("planned"),
    properties: props(),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    unique("cables_tenant_id_uq").on(t.tenantId, t.id),
    foreignKey({
      name: "cables_type_fk",
      columns: [t.tenantId, t.cableTypeId],
      foreignColumns: [cableTypes.tenantId, cableTypes.id],
    }),
  ],
);

/**
 * Пролёт кабеля между двумя точками разделки (муфтами, кроссами, ящиками).
 * Кабель, зашедший в муфту транзитом, — это два пролёта; неразрезанные волокна
 * соединены между ними связью kind = 'through'.
 * Волокна и их концы (terminals) создаются триггером по конструкции типа кабеля.
 */
export const cableSpans = pgTable(
  "cable_spans",
  {
    id: id(),
    tenantId: tenantId(),
    cableId: uuid("cable_id").notNull(),
    seq: integer("seq").notNull(),
    fromSiteId: uuid("from_site_id").notNull(),
    toSiteId: uuid("to_site_id").notNull(),
    fromEquipmentId: uuid("from_equipment_id"),
    toEquipmentId: uuid("to_equipment_id"),
    /** Измеренная длина, если отличается от суммы трасс и запасов. */
    measuredLengthM: numeric("measured_length_m", { precision: 10, scale: 2, mode: "number" }),
    /** Метраж по меткам на оболочке. */
    startMarkM: numeric("start_mark_m", { precision: 10, scale: 2, mode: "number" }),
    endMarkM: numeric("end_mark_m", { precision: 10, scale: 2, mode: "number" }),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    unique("cable_spans_tenant_id_uq").on(t.tenantId, t.id),
    unique("cable_spans_seq_uq").on(t.cableId, t.seq),
    foreignKey({ name: "cable_spans_cable_fk", columns: [t.tenantId, t.cableId], foreignColumns: [cables.tenantId, cables.id] })
      .onDelete("cascade"),
    foreignKey({ name: "cable_spans_from_site_fk", columns: [t.tenantId, t.fromSiteId], foreignColumns: [sites.tenantId, sites.id] }),
    foreignKey({ name: "cable_spans_to_site_fk", columns: [t.tenantId, t.toSiteId], foreignColumns: [sites.tenantId, sites.id] }),
    foreignKey({
      name: "cable_spans_from_eq_fk",
      columns: [t.tenantId, t.fromEquipmentId, t.fromSiteId],
      foreignColumns: [equipment.tenantId, equipment.id, equipment.siteId],
    }).onUpdate("cascade"),
    foreignKey({
      name: "cable_spans_to_eq_fk",
      columns: [t.tenantId, t.toEquipmentId, t.toSiteId],
      foreignColumns: [equipment.tenantId, equipment.id, equipment.siteId],
    }).onUpdate("cascade"),
    check("cable_spans_ends_ck", sql`${t.fromSiteId} <> ${t.toSiteId}`),
    check("cable_spans_seq_ck", sql`${t.seq} >= 1`),
    index().on(t.fromSiteId),
    index().on(t.toSiteId),
    index().on(t.fromEquipmentId),
    index().on(t.toEquipmentId),
  ],
);

/** По каким участкам трассы идёт пролёт кабеля, по порядку. */
export const spanRoutes = pgTable(
  "span_routes",
  {
    tenantId: tenantId(),
    spanId: uuid("span_id").notNull(),
    seq: integer("seq").notNull(),
    routeId: uuid("route_id").notNull(),
    /** true — кабель идёт по участку от to_site к from_site. */
    reversed: boolean("reversed").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.spanId, t.seq] }),
    foreignKey({ name: "span_routes_span_fk", columns: [t.tenantId, t.spanId], foreignColumns: [cableSpans.tenantId, cableSpans.id] })
      .onDelete("cascade"),
    foreignKey({ name: "span_routes_route_fk", columns: [t.tenantId, t.routeId], foreignColumns: [routes.tenantId, routes.id] }),
    index().on(t.routeId),
  ],
);

/** Запас кабеля (петля) в месте. Нужен для точной длины и локализации по рефлектометру. */
export const cableSlacks = pgTable(
  "cable_slacks",
  {
    id: id(),
    tenantId: tenantId(),
    spanId: uuid("span_id").notNull(),
    siteId: uuid("site_id").notNull(),
    lengthM: numeric("length_m", { precision: 8, scale: 2, mode: "number" }).notNull(),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    foreignKey({ name: "cable_slacks_span_fk", columns: [t.tenantId, t.spanId], foreignColumns: [cableSpans.tenantId, cableSpans.id] })
      .onDelete("cascade"),
    foreignKey({ name: "cable_slacks_site_fk", columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id] }),
    check("cable_slacks_len_ck", sql`${t.lengthM} > 0`),
    index().on(t.spanId),
  ],
);

/** Волокно в пролёте. Номер, модуль и позиция — из конструкции типа кабеля. */
export const fibers = pgTable(
  "fibers",
  {
    id: id(),
    tenantId: tenantId(),
    spanId: uuid("span_id").notNull(),
    number: integer("number").notNull(),
    moduleNo: integer("module_no").notNull(),
    position: integer("position").notNull(),
    condition: fiberCondition("condition").notNull().default("ok"),
    notes: text("notes"),
  },
  (t) => [
    unique("fibers_tenant_id_uq").on(t.tenantId, t.id),
    unique("fibers_span_number_uq").on(t.spanId, t.number),
    foreignKey({ name: "fibers_span_fk", columns: [t.tenantId, t.spanId], foreignColumns: [cableSpans.tenantId, cableSpans.id] })
      .onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------- связность

/**
 * Точка подключения — вершина графа связности:
 *  - конец волокна (fiber_end): сторона a — в from_site пролёта, b — в to_site;
 *  - порт оборудования (port): вход/выход сплиттера, адаптер кросса/ящика (rear/front), PON-порт.
 */
export const terminals = pgTable(
  "terminals",
  {
    id: id(),
    tenantId: tenantId(),
    kind: terminalKind("kind").notNull(),
    siteId: uuid("site_id").notNull(),
    equipmentId: uuid("equipment_id"),
    fiberId: uuid("fiber_id"),
    fiberSide: fiberSide("fiber_side"),
    portRole: portRole("port_role"),
    portNo: integer("port_no"),
    portFace: portFace("port_face"),
    label: text("label"),
  },
  (t) => [
    unique("terminals_tenant_id_uq").on(t.tenantId, t.id),
    unique("terminals_fiber_end_uq").on(t.fiberId, t.fiberSide),
    uniqueIndex("terminals_port_uq")
      .on(t.equipmentId, t.portRole, t.portNo)
      .where(sql`${t.kind} = 'port' AND ${t.portFace} IS NULL`),
    uniqueIndex("terminals_adapter_uq")
      .on(t.equipmentId, t.portNo, t.portFace)
      .where(sql`${t.portFace} IS NOT NULL`),
    foreignKey({ name: "terminals_site_fk", columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id] }),
    foreignKey({
      name: "terminals_equipment_fk",
      columns: [t.tenantId, t.equipmentId, t.siteId],
      foreignColumns: [equipment.tenantId, equipment.id, equipment.siteId],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({ name: "terminals_fiber_fk", columns: [t.tenantId, t.fiberId], foreignColumns: [fibers.tenantId, fibers.id] })
      .onDelete("cascade"),
    check(
      "terminals_kind_ck",
      sql`(${t.kind} = 'fiber_end' AND ${t.fiberId} IS NOT NULL AND ${t.fiberSide} IS NOT NULL
            AND ${t.portRole} IS NULL AND ${t.portNo} IS NULL AND ${t.portFace} IS NULL)
       OR (${t.kind} = 'port' AND ${t.equipmentId} IS NOT NULL AND ${t.portRole} IS NOT NULL AND ${t.portNo} >= 1
            AND ${t.fiberId} IS NULL AND ${t.fiberSide} IS NULL
            AND ((${t.portRole} = 'adapter') = (${t.portFace} IS NOT NULL)))`,
    ),
    index().on(t.siteId),
    index().on(t.equipmentId),
  ],
);

/**
 * Соединение двух точек: сварка, механический сплайс, патч-корд, транзит.
 * Каждая точка участвует не более чем в одном соединении (уникальность a и b,
 * перекрёстная проверка — в триггере), обе точки в месте соединения.
 */
export const connections = pgTable(
  "connections",
  {
    id: id(),
    tenantId: tenantId(),
    kind: connectionKind("kind").notNull(),
    siteId: uuid("site_id").notNull(),
    /** Корпус, где выполнено соединение (муфта, кросс, ящик), если есть. */
    equipmentId: uuid("equipment_id"),
    aTerminalId: uuid("a_terminal_id").notNull(),
    bTerminalId: uuid("b_terminal_id").notNull(),
    /** Измеренное затухание; если нет — берётся типовое по виду соединения. */
    lossDb: numeric("loss_db", { precision: 5, scale: 2, mode: "number" }),
    trayNo: integer("tray_no"),
    slotNo: integer("slot_no"),
    performedAt: timestamp("performed_at", { withTimezone: true }),
    performedBy: text("performed_by"),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    unique("connections_a_uq").on(t.aTerminalId),
    unique("connections_b_uq").on(t.bTerminalId),
    foreignKey({ name: "connections_site_fk", columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id] }),
    foreignKey({
      name: "connections_equipment_fk",
      columns: [t.tenantId, t.equipmentId, t.siteId],
      foreignColumns: [equipment.tenantId, equipment.id, equipment.siteId],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({ name: "connections_a_fk", columns: [t.tenantId, t.aTerminalId], foreignColumns: [terminals.tenantId, terminals.id] })
      .onDelete("cascade"),
    foreignKey({ name: "connections_b_fk", columns: [t.tenantId, t.bTerminalId], foreignColumns: [terminals.tenantId, terminals.id] })
      .onDelete("cascade"),
    check("connections_ends_ck", sql`${t.aTerminalId} <> ${t.bTerminalId}`),
    index().on(t.siteId),
    index().on(t.equipmentId),
  ],
);
