import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { HttpError } from "../errors.js";

/**
 * Удаление объектов вместе со всем, что от них зависит, и «последствия» — что именно
 * будет удалено или изменено. Интерфейс показывает последствия и просит подтверждения,
 * затем вызывает удаление с force=true. Без force прежние проверки остаются в силе.
 */

export interface Impact {
  title: string;
  /** Что будет удалено (красным) и что изменится (обычным текстом). */
  effects: { kind: "delete" | "change"; text: string }[];
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const names = (xs: (string | null)[], max = 5) => {
  const list = xs.map((x) => x || "без названия");
  return list.length > max ? `${list.slice(0, max).join(", ")} и ещё ${list.length - max}` : list.join(", ");
};

// ---------------------------------------------------------------- оборудование

/** Оборудование и всё вложенное в него (сплиттеры в муфте и т.п.). */
const tree = (id: string) => sql`
  WITH RECURSIVE tree AS (
    SELECT id FROM equipment WHERE id = ${id}
    UNION ALL SELECT e.id FROM equipment e JOIN tree ON e.parent_id = tree.id
  )`;

/** Соединения корпуса: записанные на него или касающиеся его портов и заведённых волокон. */
const treeConnections = (id: string, where: SQL = sql`true`) => sql`
  ${tree(id)}
  SELECT cn.id, cn.kind FROM connections cn
  WHERE (cn.equipment_id IN (SELECT id FROM tree)
     OR cn.a_terminal_id IN (SELECT t.id FROM terminals t WHERE t.equipment_id IN (SELECT id FROM tree))
     OR cn.b_terminal_id IN (SELECT t.id FROM terminals t WHERE t.equipment_id IN (SELECT id FROM tree)))
    AND ${where}`;

type SpanEnd = {
  spanId: string;
  cableId: string;
  cableName: string | null;
  seq: number;
  end: "from" | "to";
};

/** Пары пролётов одного кабеля, разрезанного в корпусе (транзит): первый входит, второй выходит. */
async function splitPairs(tx: Tx, equipmentId: string) {
  return tx.execute<{ a: string; b: string; cableName: string | null }>(sql`
    SELECT sa.id AS a, sb.id AS b, c.name AS "cableName"
    FROM cable_spans sa
    JOIN cable_spans sb ON sb.cable_id = sa.cable_id AND sb.seq = sa.seq + 1 AND sb.from_equipment_id = ${equipmentId}
    JOIN cables c ON c.id = sa.cable_id
    WHERE sa.to_equipment_id = ${equipmentId}
    ORDER BY c.name, sa.seq`);
}

async function spanEnds(tx: Tx, equipmentId: string) {
  return tx.execute<SpanEnd>(sql`
    ${tree(equipmentId)}
    SELECT sp.id AS "spanId", sp.cable_id AS "cableId", c.name AS "cableName", sp.seq,
           CASE WHEN sp.from_equipment_id IN (SELECT id FROM tree) THEN 'from' ELSE 'to' END AS end
    FROM cable_spans sp JOIN cables c ON c.id = sp.cable_id
    WHERE sp.from_equipment_id IN (SELECT id FROM tree) OR sp.to_equipment_id IN (SELECT id FROM tree)`);
}

export async function equipmentImpact(tx: Tx, id: string): Promise<Impact> {
  const [eq] = await tx.execute<{ name: string | null; kind: string; modelName: string }>(sql`
    SELECT e.name, e.kind, m.name AS "modelName" FROM equipment e JOIN equipment_models m ON m.id = e.model_id WHERE e.id = ${id}`);
  if (!eq) throw new HttpError(404, "Оборудование не найдено");
  const children = await tx.execute<{ name: string | null; modelName: string }>(sql`
    ${tree(id)} SELECT e.name, m.name AS "modelName" FROM equipment e JOIN equipment_models m ON m.id = e.model_id
    WHERE e.id IN (SELECT id FROM tree) AND e.id <> ${id}`);
  const conns = await tx.execute<{ id: string; kind: string }>(treeConnections(id));
  const pairs = await splitPairs(tx, id);
  const inPairs = new Set(pairs.flatMap((p) => [p.a, p.b]));
  const ends = (await spanEnds(tx, id)).filter((s) => !inPairs.has(s.spanId));

  const splices = conns.filter((c) => c.kind !== "through").length;
  const effects: Impact["effects"] = [];
  if (children.length) effects.push({ kind: "delete", text: `Вложенное оборудование: ${names(children.map((c) => c.name || c.modelName))}` });
  if (splices) effects.push({ kind: "delete", text: `${splices} ${plural(splices, "соединение", "соединения", "соединений")} (сварки, патч-корды)` });
  if (pairs.length)
    effects.push({
      kind: "change",
      text: `Транзитные кабели снова пройдут сквозь место без разреза: ${names(pairs.map((p) => p.cableName))}`,
    });
  if (ends.length)
    effects.push({ kind: "change", text: `Кабели будут отсоединены, но останутся на карте: ${names([...new Set(ends.map((e) => e.cableName))])}` });
  return { title: eq.name || eq.modelName, effects };
}

/**
 * Склеить два соседних пролёта кабеля, разрезанного в корпусе, обратно в один —
 * обратное заведению транзитного кабеля. Соединения на месте разреза удаляются,
 * соединения дальнего конца второго пролёта переезжают на первый.
 */
export async function mergeSpans(tx: Tx, aId: string, bId: string) {
  const [a] = await tx.execute<{ seq: number; cableId: string; measured: number | null }>(sql`
    SELECT seq, cable_id AS "cableId", measured_length_m::float AS measured FROM cable_spans WHERE id = ${aId}`);
  const [b] = await tx.execute<{ seq: number; toSiteId: string; toEquipmentId: string | null; measured: number | null; endMark: number | null }>(sql`
    SELECT seq, to_site_id AS "toSiteId", to_equipment_id AS "toEquipmentId",
           measured_length_m::float AS measured, end_mark_m::float AS "endMark"
    FROM cable_spans WHERE id = ${bId}`);
  if (!a || !b || b.seq !== a.seq + 1) throw new HttpError(422, "Пролёты не соседние");

  // 1. Соединения в месте разреза (транзит и сварки на этих концах).
  await tx.execute(sql`
    DELETE FROM connections cn USING terminals t, fibers f
    WHERE t.id IN (cn.a_terminal_id, cn.b_terminal_id) AND f.id = t.fiber_id
      AND ((f.span_id = ${aId} AND t.fiber_side = 'b') OR (f.span_id = ${bId} AND t.fiber_side = 'a'))`);

  // 2. Первый пролёт теперь доходит до конца второго (концы волокон переезжают триггером).
  await tx.execute(sql`
    UPDATE cable_spans SET to_site_id = ${b.toSiteId}, to_equipment_id = ${b.toEquipmentId},
      measured_length_m = ${a.measured != null && b.measured != null ? a.measured + b.measured : null},
      end_mark_m = ${b.endMark}
    WHERE id = ${aId}`);

  // 3. Соединения дальнего конца — на концы волокон первого пролёта.
  for (const col of ["a_terminal_id", "b_terminal_id"] as const) {
    await tx.execute(sql`
      UPDATE connections cn SET ${sql.raw(col)} = new_t.id
      FROM fibers fb
      JOIN terminals old_t ON old_t.fiber_id = fb.id AND old_t.fiber_side = 'b'
      JOIN fibers fa ON fa.span_id = ${aId} AND fa.number = fb.number
      JOIN terminals new_t ON new_t.fiber_id = fa.id AND new_t.fiber_side = 'b'
      WHERE fb.span_id = ${bId} AND cn.${sql.raw(col)} = old_t.id`);
  }

  // 4. Участки трассы и запасы второго пролёта.
  await tx.execute(sql`
    UPDATE span_routes SET span_id = ${aId},
      seq = seq + (SELECT coalesce(max(seq), 0) FROM span_routes WHERE span_id = ${aId})
    WHERE span_id = ${bId}`);
  await tx.execute(sql`UPDATE cable_slacks SET span_id = ${aId} WHERE span_id = ${bId}`);

  // 5. Второй пролёт больше не нужен; номера следующих сдвигаются (в два шага из-за уникальности).
  await tx.execute(sql`DELETE FROM cable_spans WHERE id = ${bId}`);
  await tx.execute(sql`UPDATE cable_spans SET seq = seq + 100000 WHERE cable_id = ${a.cableId} AND seq > ${b.seq}`);
  await tx.execute(sql`UPDATE cable_spans SET seq = seq - 100001 WHERE cable_id = ${a.cableId} AND seq > 100000`);
}

/** Удалить оборудование со всем содержимым: соединения, вложенное, транзит склеивается, концы отсоединяются. */
export async function removeEquipment(tx: Tx, id: string) {
  const [eq] = await tx.execute<{ id: string }>(sql`SELECT id FROM equipment WHERE id = ${id}`);
  if (!eq) throw new HttpError(404, "Оборудование не найдено");
  await tx.execute(sql`DELETE FROM connections WHERE id IN (SELECT id FROM (${treeConnections(id)}) x)`);
  // Склеиваем по одной паре: после склейки номера пролётов сдвигаются.
  for (;;) {
    const [p] = await splitPairs(tx, id);
    if (!p) break;
    await mergeSpans(tx, p.a, p.b);
  }
  await tx.execute(sql`
    ${tree(id)}
    UPDATE cable_spans SET
      from_equipment_id = CASE WHEN from_equipment_id IN (SELECT id FROM tree) THEN NULL ELSE from_equipment_id END,
      to_equipment_id = CASE WHEN to_equipment_id IN (SELECT id FROM tree) THEN NULL ELSE to_equipment_id END
    WHERE from_equipment_id IN (SELECT id FROM tree) OR to_equipment_id IN (SELECT id FROM tree)`);
  await tx.execute(sql`DELETE FROM equipment WHERE id = ${id}`);
}

/**
 * Очистить разварку корпуса: удалить сварки, механические соединения и патч-корды.
 * Если restoreThrough, разрезанные волокна транзитных кабелей снова проходят транзитом.
 */
export async function clearSplicing(tx: Tx, tenantId: string, id: string, restoreThrough: boolean) {
  const [eq] = await tx.execute<{ siteId: string; kind: string }>(sql`SELECT site_id AS "siteId", kind FROM equipment WHERE id = ${id}`);
  if (!eq) throw new HttpError(404, "Оборудование не найдено");
  const deleted = await tx.execute<{ id: string }>(sql`
    DELETE FROM connections WHERE id IN (SELECT id FROM (${treeConnections(id, sql`cn.kind <> 'through'`)}) x) RETURNING id`);
  let restored = 0;
  if (restoreThrough) {
    for (const p of await splitPairs(tx, id)) {
      const r = await tx.execute<{ id: string }>(sql`
        INSERT INTO connections (tenant_id, kind, site_id, equipment_id, a_terminal_id, b_terminal_id)
        SELECT ${tenantId}, 'through', ${eq.siteId}, ${id}, ta.id, tb.id
        FROM fibers fa
        JOIN terminals ta ON ta.fiber_id = fa.id AND ta.fiber_side = 'b'
        JOIN fibers fb ON fb.span_id = ${p.b} AND fb.number = fa.number
        JOIN terminals tb ON tb.fiber_id = fb.id AND tb.fiber_side = 'a'
        WHERE fa.span_id = ${p.a}
          AND NOT EXISTS (SELECT 1 FROM connections c WHERE ta.id IN (c.a_terminal_id, c.b_terminal_id) OR tb.id IN (c.a_terminal_id, c.b_terminal_id))
        RETURNING id`);
      restored += r.length;
    }
  }
  return { deleted: deleted.length, restored };
}

/**
 * Вывести кабель из корпуса. С force — вместе с соединениями на его волокнах.
 * Транзитный кабель (разрезанный в корпусе) склеивается обратно в один пролёт.
 */
export async function leaveCable(tx: Tx, equipmentId: string, spanId: string, force: boolean) {
  const [span] = await tx.execute<{ cableId: string; seq: number; fromEq: string | null; toEq: string | null }>(sql`
    SELECT cable_id AS "cableId", seq, from_equipment_id AS "fromEq", to_equipment_id AS "toEq" FROM cable_spans WHERE id = ${spanId}`);
  if (!span) throw new HttpError(404, "Пролёт кабеля не найден");
  const end = span.fromEq === equipmentId ? "from" : span.toEq === equipmentId ? "to" : null;
  if (!end) throw new HttpError(422, "Кабель не заведён в этот корпус");

  // Парный пролёт, если кабель в этом корпусе разрезан (транзит).
  const [pair] = await tx.execute<{ id: string }>(sql`
    SELECT id FROM cable_spans
    WHERE cable_id = ${span.cableId}
      AND ${end === "to" ? sql`seq = ${span.seq + 1} AND from_equipment_id = ${equipmentId}` : sql`seq = ${span.seq - 1} AND to_equipment_id = ${equipmentId}`}`);
  const ends = sql`(
    (f.span_id = ${spanId} AND t.fiber_side = ${end === "from" ? "a" : "b"}::fiber_side)
    ${pair ? sql`OR (f.span_id = ${pair.id} AND t.fiber_side = ${end === "from" ? "b" : "a"}::fiber_side)` : sql``})`;
  const [u] = await tx.execute<{ n: number }>(sql`
    SELECT count(DISTINCT cn.id)::int AS n FROM connections cn
    JOIN terminals t ON t.id IN (cn.a_terminal_id, cn.b_terminal_id) JOIN fibers f ON f.id = t.fiber_id
    WHERE ${ends} AND cn.kind <> 'through'`);
  if (u!.n && !force)
    throw new HttpError(409, `На волокнах кабеля в этом корпусе есть соединения: ${u!.n}. Удалите их или подтвердите вывод вместе с ними.`);

  if (pair) {
    const [a, b] = end === "to" ? [spanId, pair.id] : [pair.id, spanId];
    await mergeSpans(tx, a, b);
    return { merged: true };
  }
  await tx.execute(sql`
    DELETE FROM connections cn USING terminals t, fibers f
    WHERE t.id IN (cn.a_terminal_id, cn.b_terminal_id) AND f.id = t.fiber_id AND ${ends}`);
  await tx.execute(sql`
    UPDATE cable_spans SET ${end === "from" ? sql`from_equipment_id = NULL` : sql`to_equipment_id = NULL`} WHERE id = ${spanId}`);
  return { merged: false };
}

// ---------------------------------------------------------------- кабели, трассы, места

async function cablesImpact(tx: Tx, cableIds: string[]) {
  if (!cableIds.length) return { names: [] as (string | null)[], splices: 0 };
  const ids = sql`ARRAY[${sql.join(cableIds.map((c) => sql`${c}`), sql`, `)}]::uuid[]`;
  const [r] = await tx.execute<{ names: (string | null)[]; splices: number }>(sql`
    SELECT array_agg(DISTINCT coalesce(c.name, ct.name)) AS names,
      (SELECT count(DISTINCT cn.id)::int FROM connections cn
         JOIN terminals t ON t.id IN (cn.a_terminal_id, cn.b_terminal_id) JOIN fibers f ON f.id = t.fiber_id
         JOIN cable_spans sp ON sp.id = f.span_id
        WHERE sp.cable_id = ANY(${ids}) AND cn.kind <> 'through') AS splices
    FROM cables c JOIN cable_types ct ON ct.id = c.cable_type_id WHERE c.id = ANY(${ids})`);
  return r!;
}

const cableEffects = (c: { names: (string | null)[]; splices: number }): Impact["effects"] => [
  ...(c.names.length ? [{ kind: "delete" as const, text: `Кабели целиком: ${names(c.names)}` }] : []),
  ...(c.splices ? [{ kind: "delete" as const, text: `${c.splices} ${plural(c.splices, "соединение", "соединения", "соединений")} на их волокнах` }] : []),
];

export async function cableImpact(tx: Tx, id: string): Promise<Impact> {
  const [c] = await tx.execute<{ name: string }>(sql`
    SELECT coalesce(c.name, ct.name) AS name FROM cables c JOIN cable_types ct ON ct.id = c.cable_type_id WHERE c.id = ${id}`);
  if (!c) throw new HttpError(404, "Кабель не найден");
  const { splices } = await cablesImpact(tx, [id]);
  return {
    title: c.name,
    effects: [
      { kind: "delete", text: "Кабель со всеми пролётами, волокнами и запасами" },
      ...(splices ? [{ kind: "delete" as const, text: `${splices} ${plural(splices, "соединение", "соединения", "соединений")} на его волокнах` }] : []),
    ],
  };
}

export async function removeCable(tx: Tx, id: string) {
  // Пролёты, волокна, концы, соединения, запасы и участки трассы удаляются каскадом.
  const res = await tx.execute<{ id: string }>(sql`DELETE FROM cables WHERE id = ${id} RETURNING id`);
  if (res.length === 0) throw new HttpError(404, "Кабель не найден");
}

async function cablesOnRoutes(tx: Tx, routeFilter: SQL) {
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT DISTINCT sp.cable_id AS id FROM span_routes x JOIN cable_spans sp ON sp.id = x.span_id
    JOIN routes r ON r.id = x.route_id WHERE ${routeFilter}`);
  return rows.map((r) => r.id);
}

export async function routeImpact(tx: Tx, id: string): Promise<Impact> {
  const [r] = await tx.execute<{ name: string | null; a: string | null; b: string | null }>(sql`
    SELECT r.name, a.name AS a, b.name AS b FROM routes r JOIN sites a ON a.id = r.from_site_id JOIN sites b ON b.id = r.to_site_id WHERE r.id = ${id}`);
  if (!r) throw new HttpError(404, "Трасса не найдена");
  const cables = await cablesImpact(tx, await cablesOnRoutes(tx, sql`r.id = ${id}`));
  return { title: r.name || `${r.a ?? "…"} — ${r.b ?? "…"}`, effects: [{ kind: "delete", text: "Участок трассы" }, ...cableEffects(cables)] };
}

export async function removeRoute(tx: Tx, id: string) {
  const ids = await cablesOnRoutes(tx, sql`r.id = ${id}`);
  for (const c of ids) await removeCable(tx, c);
  const res = await tx.execute<{ id: string }>(sql`DELETE FROM routes WHERE id = ${id} RETURNING id`);
  if (res.length === 0) throw new HttpError(404, "Трасса не найдена");
}

/** Кабели, затронутые удалением места: заканчиваются в нём или проходят по трассам через него. */
async function cablesAtSite(tx: Tx, siteId: string) {
  const ends = await tx.execute<{ id: string }>(sql`
    SELECT DISTINCT cable_id AS id FROM cable_spans WHERE from_site_id = ${siteId} OR to_site_id = ${siteId}`);
  const passing = await cablesOnRoutes(tx, sql`r.from_site_id = ${siteId} OR r.to_site_id = ${siteId}`);
  return [...new Set([...ends.map((e) => e.id), ...passing])];
}

export async function siteImpact(tx: Tx, id: string): Promise<Impact> {
  const [s] = await tx.execute<{ name: string | null }>(sql`SELECT name FROM sites WHERE id = ${id}`);
  if (!s) throw new HttpError(404, "Место не найдено");
  const eq = await tx.execute<{ name: string | null; modelName: string }>(sql`
    SELECT e.name, m.name AS "modelName" FROM equipment e JOIN equipment_models m ON m.id = e.model_id
    WHERE e.site_id = ${id} AND e.parent_id IS NULL`);
  const [routes] = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM routes WHERE from_site_id = ${id} OR to_site_id = ${id}`);
  const cables = await cablesImpact(tx, await cablesAtSite(tx, id));
  const [conns] = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM connections WHERE site_id = ${id} AND kind <> 'through'`);
  const effects: Impact["effects"] = [{ kind: "delete", text: "Место на карте" }];
  if (eq.length) effects.push({ kind: "delete", text: `Оборудование: ${names(eq.map((e) => e.name || e.modelName))}` });
  if (conns!.n) effects.push({ kind: "delete", text: `${conns!.n} ${plural(conns!.n, "соединение", "соединения", "соединений")} в этом месте` });
  if (routes!.n) effects.push({ kind: "delete", text: `${routes!.n} ${plural(routes!.n, "участок", "участка", "участков")} трассы от этого места` });
  effects.push(...cableEffects(cables));
  return { title: s.name || "Место без названия", effects };
}

export async function removeSite(tx: Tx, id: string) {
  const [s] = await tx.execute<{ id: string }>(sql`SELECT id FROM sites WHERE id = ${id}`);
  if (!s) throw new HttpError(404, "Место не найдено");
  for (const c of await cablesAtSite(tx, id)) await removeCable(tx, c);
  // Оборудование с вложенным, его порты и соединения — каскадом.
  await tx.execute(sql`DELETE FROM connections WHERE site_id = ${id}`);
  await tx.execute(sql`DELETE FROM equipment WHERE site_id = ${id} AND parent_id IS NULL`);
  await tx.execute(sql`DELETE FROM routes WHERE from_site_id = ${id} OR to_site_id = ${id}`);
  await tx.execute(sql`DELETE FROM sites WHERE id = ${id}`);
}
