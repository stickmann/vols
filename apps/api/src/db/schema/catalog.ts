import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, numeric, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common.js";
import { cableConstruction, equipmentKind } from "./enums.js";
import { tenants } from "./tenancy.js";

const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

/**
 * Цветовые схемы — шаблоны для быстрого заполнения конструкции кабеля.
 * Тип кабеля хранит свои цвета копией, поэтому правка схемы не меняет существующие кабели.
 */
export const colorSchemes = pgTable(
  "color_schemes",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    /** [{ name, hex }] по порядку. */
    colors: jsonb("colors").$type<{ name: string; hex: string }[]>().notNull(),
    ...timestamps(),
  },
  (t) => [unique("color_schemes_tenant_name_uq").on(t.tenantId, t.name)],
);

/** Тип (марка) кабеля в справочнике оператора. Конструкция — в cable_type_modules / cable_type_fibers. */
export const cableTypes = pgTable(
  "cable_types",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    construction: cableConstruction("construction").notNull(),
    fiberStandard: text("fiber_standard"),
    attenuation1310DbKm: numeric("attenuation_1310_db_km", { precision: 5, scale: 3, mode: "number" })
      .notNull()
      .default(0.35),
    attenuation1550DbKm: numeric("attenuation_1550_db_km", { precision: 5, scale: 3, mode: "number" })
      .notNull()
      .default(0.22),
    outerDiameterMm: numeric("outer_diameter_mm", { precision: 5, scale: 2, mode: "number" }),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    unique("cable_types_tenant_id_uq").on(t.tenantId, t.id),
    unique("cable_types_tenant_name_uq").on(t.tenantId, t.name),
  ],
);

/** Модуль (оптический модуль/трубка) в конструкции кабеля. fiber_count = 0 — кордель-заполнитель. */
export const cableTypeModules = pgTable(
  "cable_type_modules",
  {
    id: id(),
    tenantId: tenantId(),
    cableTypeId: uuid("cable_type_id").notNull(),
    moduleNo: integer("module_no").notNull(),
    colorName: text("color_name").notNull(),
    colorHex: text("color_hex").notNull(),
    colorMarks: integer("color_marks").notNull().default(0),
    fiberCount: integer("fiber_count").notNull(),
  },
  (t) => [
    unique("cable_type_modules_no_uq").on(t.cableTypeId, t.moduleNo),
    foreignKey({
      name: "cable_type_modules_type_fk",
      columns: [t.tenantId, t.cableTypeId],
      foreignColumns: [cableTypes.tenantId, cableTypes.id],
    }).onDelete("cascade"),
    check("cable_type_modules_no_ck", sql`${t.moduleNo} >= 1`),
    check("cable_type_modules_count_ck", sql`${t.fiberCount} >= 0`),
    check("cable_type_modules_hex_ck", sql`${t.colorHex} ~ '^#[0-9a-fA-F]{6}$'`),
  ],
);

/** Волокно в конструкции: сквозной номер, модуль, позиция и собственный цвет. */
export const cableTypeFibers = pgTable(
  "cable_type_fibers",
  {
    id: id(),
    tenantId: tenantId(),
    cableTypeId: uuid("cable_type_id").notNull(),
    number: integer("number").notNull(),
    moduleNo: integer("module_no").notNull(),
    position: integer("position").notNull(),
    colorName: text("color_name").notNull(),
    colorHex: text("color_hex").notNull(),
    colorMarks: integer("color_marks").notNull().default(0),
  },
  (t) => [
    unique("cable_type_fibers_number_uq").on(t.cableTypeId, t.number),
    unique("cable_type_fibers_pos_uq").on(t.cableTypeId, t.moduleNo, t.position),
    foreignKey({
      name: "cable_type_fibers_module_fk",
      columns: [t.cableTypeId, t.moduleNo],
      foreignColumns: [cableTypeModules.cableTypeId, cableTypeModules.moduleNo],
    }).onDelete("cascade"),
    foreignKey({
      name: "cable_type_fibers_type_fk",
      columns: [t.tenantId, t.cableTypeId],
      foreignColumns: [cableTypes.tenantId, cableTypes.id],
    }).onDelete("cascade"),
    check("cable_type_fibers_ck", sql`${t.number} >= 1 AND ${t.position} >= 1`),
    check("cable_type_fibers_hex_ck", sql`${t.colorHex} ~ '^#[0-9a-fA-F]{6}$'`),
  ],
);

/** Модели оборудования: муфты, ящики, кроссы, сплиттеры, OLT, ONU. */
export const equipmentModels = pgTable(
  "equipment_models",
  {
    id: id(),
    tenantId: tenantId(),
    kind: equipmentKind("kind").notNull(),
    name: text("name").notNull(),
    manufacturer: text("manufacturer"),
    /** Адаптеры кросса/ящика, PON-порты OLT/ONU. */
    portCount: integer("port_count"),
    maxSplices: integer("max_splices"),
    cableEntries: integer("cable_entries"),
    splitterInputs: integer("splitter_inputs"),
    splitterOutputs: integer("splitter_outputs"),
    /** Номинальные потери на выход сплиттера. */
    insertionLossDb: numeric("insertion_loss_db", { precision: 5, scale: 2, mode: "number" }),
    /** Для несимметричных FBT: потери по каждому выходу. */
    outputLossesDb: jsonb("output_losses_db").$type<number[]>(),
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull().default({}),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    unique("equipment_models_tenant_id_uq").on(t.tenantId, t.id),
    unique("equipment_models_tenant_id_kind_uq").on(t.tenantId, t.id, t.kind),
    unique("equipment_models_tenant_name_uq").on(t.tenantId, t.kind, t.name),
    check(
      "equipment_models_splitter_ck",
      sql`${t.kind} <> 'splitter' OR (${t.splitterInputs} BETWEEN 1 AND 2 AND ${t.splitterOutputs} BETWEEN 2 AND 128)`,
    ),
    check(
      "equipment_models_ports_ck",
      sql`${t.kind} NOT IN ('odf', 'terminal_box', 'olt', 'onu') OR ${t.portCount} BETWEEN 1 AND 576`,
    ),
  ],
);
