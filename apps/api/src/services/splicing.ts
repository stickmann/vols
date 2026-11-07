import type { ConnectionBatch, ConnectionInput } from "@vols/shared";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { cableSpans, connections } from "../db/schema/index.js";
import { HttpError } from "../errors.js";

const CONTAINERS = ["closure", "terminal_box", "odf"];

async function loadContainer(tx: Tx, id: string) {
  const [e] = await tx.execute<{ id: string; kind: string; siteId: string; name: string | null }>(sql`
    SELECT id, kind, site_id AS "siteId", name FROM equipment WHERE id = ${id}`);
  if (!e) throw new HttpError(404, "Оборудование не найдено");
  if (!CONTAINERS.includes(e.kind)) throw new HttpError(422, "Разварка ведётся в муфте, абонентском ящике или кроссе");
  return e;
}

/**
 * Всё для схемы разварки корпуса: заведённые кабели с волокнами и цветами,
 * вложенные сплиттеры, порты адаптеров, соединения, а также кабели, которые
 * можно завести (концы в этом месте и транзитные).
 */
export async function getSplicing(tx: Tx, equipmentId: string) {
  const eqp = await loadContainer(tx, equipmentId);

  const [info] = await tx.execute(sql`
    SELECT e.id, e.kind, e.name, e.status, m.name AS "modelName", m.max_splices AS "maxSplices",
           s.id AS "siteId", s.name AS "siteName", s.kind AS "siteKind"
    FROM equipment e JOIN equipment_models m ON m.id = e.model_id JOIN sites s ON s.id = e.site_id
    WHERE e.id = ${equipmentId}`);

  const cablesIn = await tx.execute<Record<string, unknown>>(sql`
    SELECT sp.id AS "spanId", c.id AS "cableId", c.name, t.name AS "typeName",
           CASE WHEN sp.from_equipment_id = ${equipmentId} THEN 'a' ELSE 'b' END AS side,
           CASE WHEN sp.from_equipment_id = ${equipmentId} THEN o2.name ELSE o1.name END AS "otherSiteName",
           CASE WHEN sp.from_equipment_id = ${equipmentId} THEN o2.kind ELSE o1.kind END AS "otherSiteKind",
           (
             SELECT jsonb_agg(jsonb_build_object(
               'terminalId', tm.id, 'fiberId', f.id, 'number', f.number, 'module', f.module_no, 'position', f.position,
               'condition', f.condition,
               'color', jsonb_build_object('name', tf.color_name, 'hex', tf.color_hex, 'marks', tf.color_marks),
               'moduleColor', jsonb_build_object('name', tm2.color_name, 'hex', tm2.color_hex, 'marks', tm2.color_marks)
             ) ORDER BY f.number)
             FROM fibers f
             JOIN terminals tm ON tm.fiber_id = f.id
               AND tm.fiber_side = (CASE WHEN sp.from_equipment_id = ${equipmentId} THEN 'a' ELSE 'b' END)::fiber_side
             JOIN cable_type_fibers tf ON tf.cable_type_id = c.cable_type_id AND tf.number = f.number
             JOIN cable_type_modules tm2 ON tm2.cable_type_id = c.cable_type_id AND tm2.module_no = f.module_no
             WHERE f.span_id = sp.id
           ) AS fibers
    FROM cable_spans sp
    JOIN cables c ON c.id = sp.cable_id
    JOIN cable_types t ON t.id = c.cable_type_id
    JOIN sites o1 ON o1.id = sp.from_site_id
    JOIN sites o2 ON o2.id = sp.to_site_id
    WHERE sp.from_equipment_id = ${equipmentId} OR sp.to_equipment_id = ${equipmentId}
    ORDER BY c.name NULLS LAST, sp.seq`);

  const devices = await tx.execute(sql`
    SELECT e.id, e.kind, e.name, m.name AS "modelName", m.insertion_loss_db::float AS "insertionLossDb",
           (SELECT jsonb_agg(jsonb_build_object('terminalId', t.id, 'role', t.port_role, 'no', t.port_no, 'face', t.port_face)
                             ORDER BY t.port_role, t.port_no, t.port_face)
            FROM terminals t WHERE t.equipment_id = e.id AND t.kind = 'port') AS ports
    FROM equipment e JOIN equipment_models m ON m.id = e.model_id
    WHERE e.id = ${equipmentId} OR e.parent_id = ${equipmentId}
    ORDER BY (e.id = ${equipmentId}) DESC, e.name`);

  const conns = await tx.execute(sql`
    SELECT cn.id, cn.kind, cn.a_terminal_id AS "aTerminalId", cn.b_terminal_id AS "bTerminalId",
           cn.loss_db::float AS "lossDb", cn.tray_no AS "trayNo", cn.slot_no AS "slotNo", cn.notes
    FROM connections cn
    -- Соединения корпуса и все, что касаются портов его оборудования. Три ветки вместо OR,
    -- чтобы каждая шла по индексу, а не перебирала все соединения оператора.
    WHERE cn.id IN (
      SELECT id FROM connections WHERE equipment_id = ${equipmentId}
      UNION
      SELECT c.id FROM connections c JOIN terminals t ON t.id = c.a_terminal_id
        JOIN equipment e ON e.id = t.equipment_id WHERE e.id = ${equipmentId} OR e.parent_id = ${equipmentId}
      UNION
      SELECT c.id FROM connections c JOIN terminals t ON t.id = c.b_terminal_id
        JOIN equipment e ON e.id = t.equipment_id WHERE e.id = ${equipmentId} OR e.parent_id = ${equipmentId})
    ORDER BY cn.tray_no NULLS LAST, cn.slot_no NULLS LAST, cn.created_at, cn.id`);

  // Что ещё можно завести в корпус.
  const candidates = await tx.execute(sql`
    SELECT sp.id AS "spanId", c.name, t.name AS "typeName",
           CASE WHEN sp.from_site_id = ${eqp.siteId} OR sp.to_site_id = ${eqp.siteId} THEN 'end' ELSE 'transit' END AS mode
    FROM cable_spans sp
    JOIN cables c ON c.id = sp.cable_id JOIN cable_types t ON t.id = c.cable_type_id
    WHERE (sp.from_site_id = ${eqp.siteId} AND sp.from_equipment_id IS NULL)
       OR (sp.to_site_id = ${eqp.siteId} AND sp.to_equipment_id IS NULL)
       OR (sp.from_site_id <> ${eqp.siteId} AND sp.to_site_id <> ${eqp.siteId} AND EXISTS (
             SELECT 1 FROM span_routes x JOIN routes r ON r.id = x.route_id
             WHERE x.span_id = sp.id AND (r.from_site_id = ${eqp.siteId} OR r.to_site_id = ${eqp.siteId})))
    ORDER BY mode, c.name`);

  return { equipment: info, cables: cablesIn, devices, connections: conns, candidates };
}

// ---------------------------------------------------------------- соединения

async function defaultKind(tx: Tx, a: string, b: string): Promise<"fusion" | "patch"> {
  const [r] = await tx.execute<{ patch: boolean }>(sql`
    SELECT bool_or(port_face = 'front' OR port_role = 'pon') AS patch FROM terminals WHERE id IN (${a}, ${b})`);
  return r?.patch ? "patch" : "fusion";
}

export async function createConnection(tx: Tx, tenantId: string, v: ConnectionInput) {
  const eqp = await loadContainer(tx, v.equipmentId);
  const kind = v.kind ?? (await defaultKind(tx, v.aTerminalId, v.bTerminalId));
  const [c] = await tx
    .insert(connections)
    .values({
      tenantId,
      kind,
      siteId: eqp.siteId,
      equipmentId: eqp.id,
      aTerminalId: v.aTerminalId,
      bTerminalId: v.bTerminalId,
      lossDb: v.lossDb ?? null,
      trayNo: v.trayNo ?? null,
      slotNo: v.slotNo ?? null,
      notes: v.notes ?? null,
      performedAt: new Date(),
    })
    .returning({ id: connections.id });
  return c!.id;
}

/** Пакетная сварка (например, модуль в модуль по порядку). Всё или ничего. */
export async function createConnections(tx: Tx, tenantId: string, v: ConnectionBatch) {
  const ids: string[] = [];
  for (const p of v.pairs) {
    ids.push(await createConnection(tx, tenantId, { equipmentId: v.equipmentId, kind: v.kind, trayNo: v.trayNo, ...p }));
  }
  return ids;
}

export async function updateConnection(
  tx: Tx,
  id: string,
  v: { kind?: "fusion" | "mechanical" | "patch"; lossDb?: number | null; trayNo?: number | null; slotNo?: number | null; notes?: string | null },
) {
  const [cur] = await tx.select({ kind: connections.kind }).from(connections).where(eq(connections.id, id));
  if (!cur) throw new HttpError(404, "Соединение не найдено");
  if (cur.kind === "through" && v.kind) throw new HttpError(422, "Транзит нельзя превратить в сварку — разрежьте волокно и сварите заново");
  await tx
    .update(connections)
    .set({
      ...(v.kind !== undefined && { kind: v.kind }),
      ...(v.lossDb !== undefined && { lossDb: v.lossDb }),
      ...(v.trayNo !== undefined && { trayNo: v.trayNo }),
      ...(v.slotNo !== undefined && { slotNo: v.slotNo }),
      ...(v.notes !== undefined && { notes: v.notes }),
    })
    .where(eq(connections.id, id));
}

export async function deleteConnection(tx: Tx, id: string) {
  const res = await tx.delete(connections).where(eq(connections.id, id)).returning({ id: connections.id });
  if (res.length === 0) throw new HttpError(404, "Соединение не найдено");
}

// ---------------------------------------------------------------- ввод кабеля в корпус

/**
 * Завести кабель в корпус.
 * - Пролёт заканчивается в этом месте и никуда не заведён — просто привязываем конец к корпусу.
 * - Пролёт проходит через место транзитом — разрезаем его на два пролёта в этом месте.
 *   Все волокна сначала идут транзитом (связи 'through'); чтобы развести волокно, транзит удаляют.
 *   Сварки на дальнем конце переносятся на волокна второго пролёта.
 */
export async function enterCable(tx: Tx, tenantId: string, equipmentId: string, spanId: string) {
  const eqp = await loadContainer(tx, equipmentId);
  const [span] = await tx.select().from(cableSpans).where(eq(cableSpans.id, spanId));
  if (!span) throw new HttpError(404, "Пролёт кабеля не найден");

  if (span.fromSiteId === eqp.siteId || span.toSiteId === eqp.siteId) {
    const end = span.fromSiteId === eqp.siteId ? "from" : "to";
    const current = end === "from" ? span.fromEquipmentId : span.toEquipmentId;
    if (current === equipmentId) return { split: false };
    if (current) throw new HttpError(409, "Этот конец кабеля уже заведён в другое оборудование");
    await tx
      .update(cableSpans)
      .set(end === "from" ? { fromEquipmentId: equipmentId } : { toEquipmentId: equipmentId })
      .where(eq(cableSpans.id, spanId));
    return { split: false };
  }

  // Последовательность мест вдоль пролёта.
  const legs = await tx.execute<{ seq: number; fromSiteId: string; toSiteId: string; reversed: boolean }>(sql`
    SELECT x.seq, r.from_site_id AS "fromSiteId", r.to_site_id AS "toSiteId", x.reversed
    FROM span_routes x JOIN routes r ON r.id = x.route_id
    WHERE x.span_id = ${spanId} ORDER BY x.seq`);
  const sites = [span.fromSiteId, ...legs.map((l) => (l.reversed ? l.fromSiteId : l.toSiteId))];
  const k = sites.indexOf(eqp.siteId);
  if (k <= 0 || k >= sites.length - 1) throw new HttpError(422, "Кабель не проходит через место этого корпуса");

  // Освобождаем номер для нового пролёта: сдвигаем последующие (в два шага из-за уникальности).
  await tx.execute(sql`UPDATE cable_spans SET seq = seq + 100000 WHERE cable_id = ${span.cableId} AND seq > ${span.seq}`);
  await tx.execute(sql`UPDATE cable_spans SET seq = seq - 99999 WHERE cable_id = ${span.cableId} AND seq > 100000`);

  const [second] = await tx
    .insert(cableSpans)
    .values({
      tenantId,
      cableId: span.cableId,
      seq: span.seq + 1,
      fromSiteId: eqp.siteId,
      toSiteId: span.toSiteId,
      fromEquipmentId: equipmentId,
      toEquipmentId: span.toEquipmentId,
      endMarkM: span.endMarkM,
    })
    .returning({ id: cableSpans.id });
  const secondId = second!.id;

  // Участки трассы после места уходят во второй пролёт, запасы — по месту.
  await tx.execute(sql`
    UPDATE span_routes SET span_id = ${secondId}, seq = seq - ${k}
    WHERE span_id = ${spanId} AND seq > ${k}`);
  const after = sites.slice(k + 1);
  if (after.length) {
    await tx.execute(sql`
      UPDATE cable_slacks SET span_id = ${secondId}
      WHERE span_id = ${spanId} AND site_id IN (${sql.join(after.map((s) => sql`${s}`), sql`, `)})`);
  }

  // Состояние волокон переносим на второй пролёт.
  await tx.execute(sql`
    UPDATE fibers f2 SET condition = f1.condition, notes = f1.notes
    FROM fibers f1 WHERE f1.span_id = ${spanId} AND f2.span_id = ${secondId} AND f2.number = f1.number`);

  // Соединения дальнего конца переезжают на концы волокон второго пролёта.
  for (const col of ["a_terminal_id", "b_terminal_id"] as const) {
    await tx.execute(sql`
      UPDATE connections cn SET ${sql.raw(col)} = new_t.id
      FROM fibers f1
      JOIN terminals old_t ON old_t.fiber_id = f1.id AND old_t.fiber_side = 'b'
      JOIN fibers f2 ON f2.span_id = ${secondId} AND f2.number = f1.number
      JOIN terminals new_t ON new_t.fiber_id = f2.id AND new_t.fiber_side = 'b'
      WHERE f1.span_id = ${spanId} AND cn.${sql.raw(col)} = old_t.id`);
  }

  // Первый пролёт теперь заканчивается в корпусе.
  await tx
    .update(cableSpans)
    .set({ toSiteId: eqp.siteId, toEquipmentId: equipmentId, measuredLengthM: null, endMarkM: null })
    .where(eq(cableSpans.id, spanId));

  // Все волокна по умолчанию проходят транзитом.
  await tx.execute(sql`
    INSERT INTO connections (tenant_id, kind, site_id, equipment_id, a_terminal_id, b_terminal_id)
    SELECT ${tenantId}, 'through', ${eqp.siteId}, ${equipmentId}, ta.id, tb.id
    FROM fibers f1
    JOIN terminals ta ON ta.fiber_id = f1.id AND ta.fiber_side = 'b'
    JOIN fibers f2 ON f2.span_id = ${secondId} AND f2.number = f1.number
    JOIN terminals tb ON tb.fiber_id = f2.id AND tb.fiber_side = 'a'
    WHERE f1.span_id = ${spanId}`);

  return { split: true, spanId: secondId };
}


