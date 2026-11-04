import type { CableInput, EquipmentInput, RouteInput, SiteInput } from "@vols/shared";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { lineString, point } from "../db/geo.js";
import { cableSlacks, cableSpans, cables, equipment, equipmentModels, routes, sites, spanRoutes } from "../db/schema/index.js";
import { HttpError } from "../errors.js";

type FeatureCollection = { type: "FeatureCollection"; features: unknown[] };

/**
 * Вся сеть оператора для карты: места, трассы и пролёты кабелей как GeoJSON.
 * У типичного оператора это сотни объектов, поэтому отдаём целиком.
 */
export async function loadNetwork(tx: Tx): Promise<{ sites: FeatureCollection; routes: FeatureCollection; cables: FeatureCollection }> {
  const [row] = await tx.execute<{ sites: FeatureCollection; routes: FeatureCollection; cables: FeatureCollection }>(sql`
    SELECT
      (SELECT jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(jsonb_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(s.geom, 7)::jsonb,
          'properties', jsonb_build_object(
            'id', s.id, 'kind', s.kind, 'name', s.name, 'status', s.status, 'address', s.address,
            'equipmentCount', (SELECT count(*) FROM equipment e WHERE e.site_id = s.id AND e.parent_id IS NULL)
          ))), '[]'::jsonb))
       FROM sites s) AS sites,

      (SELECT jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(jsonb_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(r.geom, 7)::jsonb,
          'properties', jsonb_build_object(
            'id', r.id, 'kind', r.kind, 'name', r.name, 'status', r.status,
            'lengthM', round(r.length_m::numeric, 1), 'fromSiteId', r.from_site_id, 'toSiteId', r.to_site_id,
            'cableCount', (SELECT count(DISTINCT sp.cable_id) FROM span_routes x JOIN cable_spans sp ON sp.id = x.span_id WHERE x.route_id = r.id)
          ))), '[]'::jsonb))
       FROM routes r) AS routes,

      (SELECT jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(jsonb_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(p.geom, 7)::jsonb,
          'properties', jsonb_build_object(
            'id', sp.id, 'cableId', c.id, 'name', c.name, 'status', c.status, 'typeName', t.name,
            'fiberCount', (SELECT count(*) FROM cable_type_fibers f WHERE f.cable_type_id = t.id),
            'lengthM', round((p.len + coalesce((SELECT sum(length_m) FROM cable_slacks k WHERE k.span_id = sp.id), 0))::numeric, 1)
          ))) FILTER (WHERE p.geom IS NOT NULL), '[]'::jsonb))
       FROM cable_spans sp
       JOIN cables c ON c.id = sp.cable_id
       JOIN cable_types t ON t.id = c.cable_type_id
       CROSS JOIN LATERAL (
         SELECT ST_LineMerge(ST_MakeLine(array_agg(
                  CASE WHEN x.reversed THEN ST_Reverse(rt.geom) ELSE rt.geom END ORDER BY x.seq))) AS geom,
                coalesce(sum(rt.length_m), 0) AS len
         FROM span_routes x JOIN routes rt ON rt.id = x.route_id
         WHERE x.span_id = sp.id
       ) p) AS cables
  `);
  return row!;
}

// ---------------------------------------------------------------- места

export async function createSite(tx: Tx, tenantId: string, v: SiteInput) {
  const [s] = await tx
    .insert(sites)
    .values({
      tenantId,
      kind: v.kind,
      name: v.name ?? null,
      geom: point(v.position),
      address: v.address ?? null,
      status: v.status,
      notes: v.notes ?? null,
    })
    .returning({ id: sites.id });
  return s!.id;
}

export async function updateSite(tx: Tx, id: string, v: Partial<SiteInput>) {
  const res = await tx
    .update(sites)
    .set({
      ...(v.kind !== undefined && { kind: v.kind }),
      ...(v.name !== undefined && { name: v.name ?? null }),
      ...(v.address !== undefined && { address: v.address ?? null }),
      ...(v.status !== undefined && { status: v.status }),
      ...(v.notes !== undefined && { notes: v.notes ?? null }),
      ...(v.position && { geom: point(v.position) }),
    })
    .where(eq(sites.id, id))
    .returning({ id: sites.id });
  if (res.length === 0) throw new HttpError(404, "Место не найдено");
}

export async function deleteSite(tx: Tx, id: string) {
  const [u] = await tx.execute<{ routes: number; equipment: number; spans: number }>(sql`
    SELECT (SELECT count(*)::int FROM routes WHERE from_site_id = ${id} OR to_site_id = ${id}) AS routes,
           (SELECT count(*)::int FROM equipment WHERE site_id = ${id}) AS equipment,
           (SELECT count(*)::int FROM cable_spans WHERE from_site_id = ${id} OR to_site_id = ${id}) AS spans`);
  const parts = [
    u!.routes && `трасс: ${u!.routes}`,
    u!.equipment && `оборудования: ${u!.equipment}`,
    u!.spans && `концов кабелей: ${u!.spans}`,
  ].filter(Boolean);
  if (parts.length) throw new HttpError(409, `Место используется (${parts.join(", ")}). Сначала удалите связанные объекты.`);
  const res = await tx.delete(sites).where(eq(sites.id, id)).returning({ id: sites.id });
  if (res.length === 0) throw new HttpError(404, "Место не найдено");
}

export async function getSite(tx: Tx, id: string) {
  const [site] = await tx.execute<Record<string, unknown>>(sql`
    SELECT s.id, s.kind, s.name, s.address, s.status, s.notes,
           ST_X(s.geom) AS lng, ST_Y(s.geom) AS lat
    FROM sites s WHERE s.id = ${id}`);
  if (!site) throw new HttpError(404, "Место не найдено");

  const items = await tx.execute(sql`
    SELECT e.id, e.kind, e.name, e.status, e.parent_id AS "parentId", m.name AS "modelName", m.id AS "modelId",
           (SELECT count(*)::int FROM terminals t WHERE t.equipment_id = e.id AND t.kind = 'port') AS ports,
           -- Порты, от которых удобно трассировать: PON у OLT/ONU, абонентские (лицевые) у ящиков и кроссов.
           (SELECT coalesce(jsonb_agg(jsonb_build_object(
                     'terminalId', t.id, 'role', t.port_role, 'no', t.port_no, 'face', t.port_face,
                     'connected', EXISTS (SELECT 1 FROM connections cn WHERE t.id IN (cn.a_terminal_id, cn.b_terminal_id)))
                   ORDER BY t.port_no), '[]'::jsonb)
            FROM terminals t
            WHERE t.equipment_id = e.id AND (t.port_role = 'pon' OR t.port_face = 'front')) AS "tracePorts"
    FROM equipment e JOIN equipment_models m ON m.id = e.model_id
    WHERE e.site_id = ${id}
    ORDER BY e.parent_id NULLS FIRST, e.kind, e.name`);

  // Кабели, которые здесь заканчиваются (концы пролётов) и проходят мимо (по трассам через место).
  const cablesHere = await tx.execute(sql`
    SELECT DISTINCT ON (c.id) c.id, c.name, t.name AS "typeName",
           CASE WHEN sp.from_site_id = ${id} OR sp.to_site_id = ${id} THEN 'end' ELSE 'pass' END AS role
    FROM cable_spans sp
    JOIN cables c ON c.id = sp.cable_id
    JOIN cable_types t ON t.id = c.cable_type_id
    WHERE sp.from_site_id = ${id} OR sp.to_site_id = ${id}
       OR EXISTS (SELECT 1 FROM span_routes x JOIN routes r ON r.id = x.route_id
                  WHERE x.span_id = sp.id AND (r.from_site_id = ${id} OR r.to_site_id = ${id}))
    ORDER BY c.id, role`);

  return { ...site, equipment: items, cables: cablesHere };
}

// ---------------------------------------------------------------- трассы

export async function createRoute(tx: Tx, tenantId: string, v: RouteInput) {
  if (v.fromSiteId === v.toSiteId) throw new HttpError(422, "Трасса должна соединять два разных места");
  const [r] = await tx
    .insert(routes)
    .values({
      tenantId,
      kind: v.kind,
      name: v.name ?? null,
      fromSiteId: v.fromSiteId,
      toSiteId: v.toSiteId,
      geom: lineString(v.coordinates),
      status: v.status,
      notes: v.notes ?? null,
    })
    .returning({ id: routes.id });
  return r!.id;
}

export async function updateRoute(tx: Tx, id: string, v: Partial<Omit<RouteInput, "fromSiteId" | "toSiteId">>) {
  const res = await tx
    .update(routes)
    .set({
      ...(v.kind !== undefined && { kind: v.kind }),
      ...(v.name !== undefined && { name: v.name ?? null }),
      ...(v.status !== undefined && { status: v.status }),
      ...(v.notes !== undefined && { notes: v.notes ?? null }),
      ...(v.coordinates && { geom: lineString(v.coordinates) }),
    })
    .where(eq(routes.id, id))
    .returning({ id: routes.id });
  if (res.length === 0) throw new HttpError(404, "Трасса не найдена");
}

export async function deleteRoute(tx: Tx, id: string) {
  const [u] = await tx.execute<{ n: number }>(sql`
    SELECT count(DISTINCT sp.cable_id)::int AS n FROM span_routes x JOIN cable_spans sp ON sp.id = x.span_id WHERE x.route_id = ${id}`);
  if (u!.n) throw new HttpError(409, `По трассе проложено кабелей: ${u!.n}. Сначала перенесите или удалите их.`);
  const res = await tx.delete(routes).where(eq(routes.id, id)).returning({ id: routes.id });
  if (res.length === 0) throw new HttpError(404, "Трасса не найдена");
}

export async function getRoute(tx: Tx, id: string) {
  const [r] = await tx.execute(sql`
    SELECT r.id, r.kind, r.name, r.status, r.notes, round(r.length_m::numeric, 1)::float AS "lengthM",
           r.from_site_id AS "fromSiteId", r.to_site_id AS "toSiteId",
           a.name AS "fromName", a.kind AS "fromKind", b.name AS "toName", b.kind AS "toKind",
           ST_AsGeoJSON(r.geom, 7)::jsonb AS geometry
    FROM routes r JOIN sites a ON a.id = r.from_site_id JOIN sites b ON b.id = r.to_site_id
    WHERE r.id = ${id}`);
  if (!r) throw new HttpError(404, "Трасса не найдена");
  const cablesOn = await tx.execute(sql`
    SELECT DISTINCT c.id, c.name, t.name AS "typeName"
    FROM span_routes x JOIN cable_spans sp ON sp.id = x.span_id
    JOIN cables c ON c.id = sp.cable_id JOIN cable_types t ON t.id = c.cable_type_id
    WHERE x.route_id = ${id}`);
  return { ...r, cables: cablesOn };
}

// ---------------------------------------------------------------- граф трасс

interface Edge {
  id: string;
  from: string;
  to: string;
  length: number;
}

async function loadEdges(tx: Tx): Promise<Edge[]> {
  const rows = await tx
    .select({ id: routes.id, from: routes.fromSiteId, to: routes.toSiteId, length: routes.lengthM })
    .from(routes);
  return rows;
}

/** Кратчайший путь по трассам между двумя местами (Дейкстра; граф оператора небольшой). */
export async function shortestPath(tx: Tx, fromSiteId: string, toSiteId: string) {
  const edges = await loadEdges(tx);
  const adj = new Map<string, { to: string; edge: Edge }[]>();
  for (const e of edges) {
    (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push({ to: e.to, edge: e });
    (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push({ to: e.from, edge: e });
  }
  const dist = new Map<string, number>([[fromSiteId, 0]]);
  const prev = new Map<string, { site: string; edge: Edge }>();
  const done = new Set<string>();
  const queue = new Set<string>([fromSiteId]);

  while (queue.size) {
    let cur: string | null = null;
    for (const s of queue) if (cur === null || dist.get(s)! < dist.get(cur)!) cur = s;
    queue.delete(cur!);
    if (cur === toSiteId) break;
    done.add(cur!);
    for (const { to, edge } of adj.get(cur!) ?? []) {
      if (done.has(to)) continue;
      const d = dist.get(cur!)! + edge.length;
      if (d < (dist.get(to) ?? Infinity)) {
        dist.set(to, d);
        prev.set(to, { site: cur!, edge });
        queue.add(to);
      }
    }
  }

  if (fromSiteId !== toSiteId && !prev.has(toSiteId)) return null;
  const siteIds = [toSiteId];
  const routeIds: string[] = [];
  for (let s = toSiteId; s !== fromSiteId; ) {
    const p = prev.get(s)!;
    routeIds.unshift(p.edge.id);
    siteIds.unshift(p.site);
    s = p.site;
  }
  return { siteIds, routeIds, lengthM: Math.round((dist.get(toSiteId) ?? 0) * 10) / 10 };
}

// ---------------------------------------------------------------- кабели

/**
 * Проложить кабель по последовательности мест. Между соседними местами берётся
 * трасса (кратчайшая, если их несколько). Кабель создаётся одним пролётом от
 * первого места до последнего; волокна и их концы создаёт БД.
 */
export async function createCable(tx: Tx, tenantId: string, v: CableInput) {
  const ids = v.siteIds;
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] === ids[i - 1]) throw new HttpError(422, "Соседние точки пути совпадают");
  }
  if (ids[0] === ids[ids.length - 1] && ids.length === 2) throw new HttpError(422, "Начало и конец кабеля совпадают");

  const edges = await loadEdges(tx);
  const steps = ids.slice(1).map((to, i) => {
    const from = ids[i]!;
    const candidates = edges
      .filter((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from))
      .sort((a, b) => a.length - b.length);
    const e = candidates[0];
    if (!e) throw new HttpError(422, `Между точками ${i + 1} и ${i + 2} пути нет трассы`);
    return { routeId: e.id, reversed: e.from !== from };
  });

  await checkEquipmentAt(tx, v.fromEquipmentId, ids[0]!, "начале");
  await checkEquipmentAt(tx, v.toEquipmentId, ids[ids.length - 1]!, "конце");

  const onPath = new Set(ids);
  for (const s of v.slacks) {
    if (!onPath.has(s.siteId)) throw new HttpError(422, "Запас можно указать только в месте на пути кабеля");
  }

  const [c] = await tx
    .insert(cables)
    .values({ tenantId, cableTypeId: v.cableTypeId, name: v.name ?? null, status: v.status, notes: v.notes ?? null })
    .returning({ id: cables.id });
  const [span] = await tx
    .insert(cableSpans)
    .values({
      tenantId,
      cableId: c!.id,
      seq: 1,
      fromSiteId: ids[0]!,
      toSiteId: ids[ids.length - 1]!,
      fromEquipmentId: v.fromEquipmentId ?? null,
      toEquipmentId: v.toEquipmentId ?? null,
    })
    .returning({ id: cableSpans.id });
  await tx.insert(spanRoutes).values(steps.map((s, i) => ({ tenantId, spanId: span!.id, seq: i + 1, ...s })));
  if (v.slacks.length) {
    await tx.insert(cableSlacks).values(v.slacks.map((s) => ({ tenantId, spanId: span!.id, siteId: s.siteId, lengthM: s.lengthM })));
  }
  return c!.id;
}

async function checkEquipmentAt(tx: Tx, equipmentId: string | null | undefined, siteId: string, where: string) {
  if (!equipmentId) return;
  const [e] = await tx.select({ siteId: equipment.siteId }).from(equipment).where(eq(equipment.id, equipmentId));
  if (!e) throw new HttpError(422, `Оборудование в ${where} кабеля не найдено`);
  if (e.siteId !== siteId) throw new HttpError(422, `Оборудование в ${where} кабеля стоит в другом месте`);
}

async function cableConnections(tx: Tx, cableId: string): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM connections cn
    JOIN terminals t ON t.id IN (cn.a_terminal_id, cn.b_terminal_id)
    JOIN fibers f ON f.id = t.fiber_id
    JOIN cable_spans sp ON sp.id = f.span_id
    WHERE sp.cable_id = ${cableId} AND cn.kind <> 'through'`);
  return r!.n;
}

export async function getCable(tx: Tx, id: string) {
  const [c] = await tx.execute<Record<string, unknown>>(sql`
    SELECT c.id, c.name, c.status, c.notes, t.id AS "cableTypeId", t.name AS "typeName",
           (SELECT count(*)::int FROM cable_type_fibers f WHERE f.cable_type_id = t.id) AS "fiberCount"
    FROM cables c JOIN cable_types t ON t.id = c.cable_type_id WHERE c.id = ${id}`);
  if (!c) throw new HttpError(404, "Кабель не найден");

  const spans = await tx.execute<Record<string, unknown>>(sql`
    SELECT sp.id, sp.seq,
           sp.from_site_id AS "fromSiteId", a.name AS "fromSiteName", a.kind AS "fromSiteKind",
           sp.to_site_id AS "toSiteId", b.name AS "toSiteName", b.kind AS "toSiteKind",
           sp.from_equipment_id AS "fromEquipmentId", ea.name AS "fromEquipmentName",
           sp.to_equipment_id AS "toEquipmentId", eb.name AS "toEquipmentName",
           round(coalesce((SELECT sum(r.length_m) FROM span_routes x JOIN routes r ON r.id = x.route_id WHERE x.span_id = sp.id), 0)::numeric, 1)::float AS "routeLengthM",
           coalesce((SELECT sum(length_m) FROM cable_slacks k WHERE k.span_id = sp.id), 0)::float AS "slackM",
           (SELECT coalesce(jsonb_agg(x.route_id ORDER BY x.seq), '[]') FROM span_routes x WHERE x.span_id = sp.id) AS "routeIds"
    FROM cable_spans sp
    JOIN sites a ON a.id = sp.from_site_id JOIN sites b ON b.id = sp.to_site_id
    LEFT JOIN equipment ea ON ea.id = sp.from_equipment_id
    LEFT JOIN equipment eb ON eb.id = sp.to_equipment_id
    WHERE sp.cable_id = ${id} ORDER BY sp.seq`);

  return { ...c, spans, connections: await cableConnections(tx, id) };
}

export async function updateCable(
  tx: Tx,
  id: string,
  v: { name?: string | null; status?: CableInput["status"]; notes?: string | null; fromEquipmentId?: string | null; toEquipmentId?: string | null },
) {
  const res = await tx
    .update(cables)
    .set({
      ...(v.name !== undefined && { name: v.name ?? null }),
      ...(v.status !== undefined && { status: v.status }),
      ...(v.notes !== undefined && { notes: v.notes ?? null }),
    })
    .where(eq(cables.id, id))
    .returning({ id: cables.id });
  if (res.length === 0) throw new HttpError(404, "Кабель не найден");

  if (v.fromEquipmentId !== undefined || v.toEquipmentId !== undefined) {
    const spans = await tx.select().from(cableSpans).where(eq(cableSpans.cableId, id)).orderBy(cableSpans.seq);
    const first = spans[0];
    const last = spans[spans.length - 1];
    if (first && v.fromEquipmentId !== undefined) {
      await checkEquipmentAt(tx, v.fromEquipmentId, first.fromSiteId, "начале");
      await tx.update(cableSpans).set({ fromEquipmentId: v.fromEquipmentId }).where(eq(cableSpans.id, first.id));
    }
    if (last && v.toEquipmentId !== undefined) {
      await checkEquipmentAt(tx, v.toEquipmentId, last.toSiteId, "конце");
      await tx.update(cableSpans).set({ toEquipmentId: v.toEquipmentId }).where(eq(cableSpans.id, last.id));
    }
  }
}

export async function deleteCable(tx: Tx, id: string) {
  const n = await cableConnections(tx, id);
  if (n) throw new HttpError(409, `У кабеля есть сварки и подключения: ${n}. Сначала разварите его.`);
  const res = await tx.delete(cables).where(eq(cables.id, id)).returning({ id: cables.id });
  if (res.length === 0) throw new HttpError(404, "Кабель не найден");
}

// ---------------------------------------------------------------- оборудование

const CONTAINERS = new Set(["closure", "terminal_box", "odf"]);

export async function createEquipment(tx: Tx, tenantId: string, v: EquipmentInput) {
  const [m] = await tx.select({ kind: equipmentModels.kind }).from(equipmentModels).where(eq(equipmentModels.id, v.modelId));
  if (!m) throw new HttpError(422, "Модель оборудования не найдена");
  if (v.parentId) {
    const [p] = await tx.select({ kind: equipment.kind, siteId: equipment.siteId }).from(equipment).where(eq(equipment.id, v.parentId));
    if (!p) throw new HttpError(422, "Корпус не найден");
    if (!CONTAINERS.has(p.kind)) throw new HttpError(422, "Вложить оборудование можно только в муфту, ящик или кросс");
    if (p.siteId !== v.siteId) throw new HttpError(422, "Корпус стоит в другом месте");
  }
  const [e] = await tx
    .insert(equipment)
    .values({
      tenantId,
      kind: m.kind,
      modelId: v.modelId,
      siteId: v.siteId,
      parentId: v.parentId ?? null,
      name: v.name ?? null,
      status: v.status,
      notes: v.notes ?? null,
    })
    .returning({ id: equipment.id });
  return e!.id;
}

export async function updateEquipment(tx: Tx, id: string, v: { name?: string | null; status?: EquipmentInput["status"]; notes?: string | null }) {
  const res = await tx
    .update(equipment)
    .set({
      ...(v.name !== undefined && { name: v.name ?? null }),
      ...(v.status !== undefined && { status: v.status }),
      ...(v.notes !== undefined && { notes: v.notes ?? null }),
    })
    .where(eq(equipment.id, id))
    .returning({ id: equipment.id });
  if (res.length === 0) throw new HttpError(404, "Оборудование не найдено");
}

export async function deleteEquipment(tx: Tx, id: string) {
  const [u] = await tx.execute<{ spans: number; conns: number }>(sql`
    WITH RECURSIVE tree AS (
      SELECT id FROM equipment WHERE id = ${id}
      UNION ALL SELECT e.id FROM equipment e JOIN tree ON e.parent_id = tree.id
    )
    SELECT (SELECT count(*)::int FROM cable_spans WHERE from_equipment_id IN (SELECT id FROM tree) OR to_equipment_id IN (SELECT id FROM tree)) AS spans,
           (SELECT count(*)::int FROM connections cn
             WHERE cn.equipment_id IN (SELECT id FROM tree)
                OR EXISTS (SELECT 1 FROM terminals t WHERE t.id IN (cn.a_terminal_id, cn.b_terminal_id) AND t.equipment_id IN (SELECT id FROM tree))) AS conns`);
  if (u!.spans) throw new HttpError(409, `В оборудование заведены кабели: ${u!.spans}. Сначала отсоедините их.`);
  if (u!.conns) throw new HttpError(409, `В оборудовании есть соединения: ${u!.conns}. Сначала удалите их.`);
  const res = await tx.delete(equipment).where(eq(equipment.id, id)).returning({ id: equipment.id });
  if (res.length === 0) throw new HttpError(404, "Оборудование не найдено");
}

