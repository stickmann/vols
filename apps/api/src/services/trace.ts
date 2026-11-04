import {
  connectionLoss,
  fiberAttenuation,
  round3,
  splitterLoss,
  zeroLoss,
  type Color,
  type LossByWavelength,
  type TraceEnd,
  type TraceNode,
  type TraceResult,
  type TraceVia,
} from "@vols/shared";
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { HttpError } from "../errors.js";

type TermRow = {
  id: string;
  kind: "fiber_end" | "port";
  siteId: string;
  siteName: string | null;
  equipmentId: string | null;
  equipmentName: string | null;
  equipmentKind: string | null;
  modelName: string | null;
  splitterOutputs: number | null;
  insertionLossDb: number | null;
  outputLossesDb: number[] | null;
  fiberId: string | null;
  fiberSide: "a" | "b" | null;
  portRole: "in" | "out" | "adapter" | "pon" | null;
  portNo: number | null;
  portFace: "rear" | "front" | null;
};

type FiberRow = {
  id: string;
  spanId: string;
  number: number;
  cableName: string;
  color: Color;
  lengthM: number;
  a1310: number;
  a1550: number;
};

interface Graph {
  terms: Map<string, TermRow>;
  conns: Map<string, { id: string; kind: string; other: string; lossDb: number | null }>;
  fibers: Map<string, FiberRow>;
  fiberEnds: Map<string, { a?: string; b?: string }>;
  /** equipmentId → порты по роли. */
  splitterPorts: Map<string, { ins: string[]; outs: string[] }>;
  /** `${equipmentId}:${portNo}` → { rear, front }. */
  adapters: Map<string, { rear?: string; front?: string }>;
}

/** Весь граф связности оператора. Сотни муфт — это десятки тысяч точек, грузим целиком. */
async function loadGraph(tx: Tx): Promise<Graph> {
  const terms = await tx.execute<TermRow>(sql`
    SELECT t.id, t.kind, t.site_id AS "siteId", s.name AS "siteName",
           t.equipment_id AS "equipmentId", e.name AS "equipmentName", e.kind AS "equipmentKind",
           m.name AS "modelName", m.splitter_outputs AS "splitterOutputs",
           m.insertion_loss_db::float AS "insertionLossDb", m.output_losses_db AS "outputLossesDb",
           t.fiber_id AS "fiberId", t.fiber_side AS "fiberSide",
           t.port_role AS "portRole", t.port_no AS "portNo", t.port_face AS "portFace"
    FROM terminals t
    JOIN sites s ON s.id = t.site_id
    LEFT JOIN equipment e ON e.id = t.equipment_id
    LEFT JOIN equipment_models m ON m.id = e.model_id`);

  const conns = await tx.execute<{ id: string; kind: string; a: string; b: string; lossDb: number | null }>(sql`
    SELECT id, kind, a_terminal_id AS a, b_terminal_id AS b, loss_db::float AS "lossDb" FROM connections`);

  const fibers = await tx.execute<FiberRow>(sql`
    SELECT f.id, f.span_id AS "spanId", f.number, coalesce(c.name, ct.name) AS "cableName",
           jsonb_build_object('name', tf.color_name, 'hex', tf.color_hex, 'marks', tf.color_marks) AS color,
           coalesce(sp.measured_length_m::float,
             coalesce((SELECT sum(r.length_m) FROM span_routes x JOIN routes r ON r.id = x.route_id WHERE x.span_id = sp.id), 0)
             + coalesce((SELECT sum(k.length_m)::float FROM cable_slacks k WHERE k.span_id = sp.id), 0)) AS "lengthM",
           ct.attenuation_1310_db_km::float AS a1310, ct.attenuation_1550_db_km::float AS a1550
    FROM fibers f
    JOIN cable_spans sp ON sp.id = f.span_id
    JOIN cables c ON c.id = sp.cable_id
    JOIN cable_types ct ON ct.id = c.cable_type_id
    JOIN cable_type_fibers tf ON tf.cable_type_id = ct.id AND tf.number = f.number`);

  const g: Graph = {
    terms: new Map(terms.map((t) => [t.id, t])),
    conns: new Map(),
    fibers: new Map(fibers.map((f) => [f.id, f])),
    fiberEnds: new Map(),
    splitterPorts: new Map(),
    adapters: new Map(),
  };
  for (const c of conns) {
    g.conns.set(c.a, { id: c.id, kind: c.kind, other: c.b, lossDb: c.lossDb });
    g.conns.set(c.b, { id: c.id, kind: c.kind, other: c.a, lossDb: c.lossDb });
  }
  for (const t of terms) {
    if (t.kind === "fiber_end" && t.fiberId) {
      const e = g.fiberEnds.get(t.fiberId) ?? {};
      e[t.fiberSide!] = t.id;
      g.fiberEnds.set(t.fiberId, e);
    } else if (t.portRole === "in" || t.portRole === "out") {
      const p = g.splitterPorts.get(t.equipmentId!) ?? { ins: [], outs: [] };
      (t.portRole === "in" ? p.ins : p.outs).push(t.id);
      g.splitterPorts.set(t.equipmentId!, p);
    } else if (t.portRole === "adapter") {
      const k = `${t.equipmentId}:${t.portNo}`;
      const a = g.adapters.get(k) ?? {};
      a[t.portFace!] = t.id;
      g.adapters.set(k, a);
    }
  }
  return g;
}

function label(g: Graph, t: TermRow): string {
  if (t.kind === "fiber_end") {
    const f = g.fibers.get(t.fiberId!);
    return `${f?.cableName ?? "Кабель"} · вол. ${f?.number ?? "?"}`;
  }
  const dev = t.equipmentName || t.modelName || "Оборудование";
  if (t.portRole === "in") return `${dev} · вход ${t.portNo}`;
  if (t.portRole === "out") return `${dev} · выход ${t.portNo}`;
  if (t.portRole === "adapter") return `${dev} · порт ${t.portNo} (${t.portFace === "rear" ? "сварка" : "патч"})`;
  return `${dev} · PON ${t.portNo}`;
}

interface Edge {
  to: string;
  via: TraceVia;
  connectionKind?: string;
  loss: LossByWavelength;
  lengthM: number;
  spanId?: string;
}

const flat = (db: number): LossByWavelength => ({ 1310: db, 1490: db, 1550: db });

/** Соседи точки с учётом того, откуда в неё пришли (сплиттер — направленный элемент). */
function edges(g: Graph, id: string, cameVia: TraceVia): Edge[] {
  const t = g.terms.get(id)!;
  const out: Edge[] = [];

  const c = g.conns.get(id);
  if (c && cameVia !== "connection") {
    out.push({ to: c.other, via: "connection", connectionKind: c.kind, loss: flat(connectionLoss(c.kind, c.lossDb)), lengthM: 0 });
  }

  if (t.kind === "fiber_end" && cameVia !== "fiber") {
    const f = g.fibers.get(t.fiberId!);
    const ends = g.fiberEnds.get(t.fiberId!);
    const other = t.fiberSide === "a" ? ends?.b : ends?.a;
    if (f && other) {
      const att = fiberAttenuation(f.a1310, f.a1550);
      const km = f.lengthM / 1000;
      out.push({
        to: other,
        via: "fiber",
        loss: { 1310: att[1310] * km, 1490: att[1490] * km, 1550: att[1550] * km },
        lengthM: f.lengthM,
        spanId: f.spanId,
      });
    }
  }

  if ((t.portRole === "in" || t.portRole === "out") && cameVia !== "splitter") {
    const p = g.splitterPorts.get(t.equipmentId!);
    const n = t.splitterOutputs ?? p?.outs.length ?? 1;
    if (t.portRole === "in") {
      // со входа сигнал расходится на все выходы
      for (const o of p?.outs ?? []) {
        const no = g.terms.get(o)!.portNo!;
        out.push({ to: o, via: "splitter", loss: flat(splitterLoss(n, t.insertionLossDb, t.outputLossesDb, no)), lengthM: 0 });
      }
    } else {
      for (const i of p?.ins ?? []) {
        out.push({ to: i, via: "splitter", loss: flat(splitterLoss(n, t.insertionLossDb, t.outputLossesDb, t.portNo!)), lengthM: 0 });
      }
    }
  }

  if (t.portRole === "adapter" && cameVia !== "adapter") {
    const a = g.adapters.get(`${t.equipmentId}:${t.portNo}`);
    const other = t.portFace === "rear" ? a?.front : a?.rear;
    if (other) out.push({ to: other, via: "adapter", loss: zeroLoss(), lengthM: 0 });
  }
  return out;
}

function endKind(t: TermRow): TraceEnd {
  if (t.portRole === "pon") return t.equipmentKind === "onu" ? "onu" : "olt";
  if (t.portFace === "front") return "subscriber_port";
  if (t.portRole === "out") return "free_splitter_output";
  if (t.kind === "fiber_end") return "open_fiber";
  return "free_port";
}

const MAX_NODES = 20000;

/** Трассировка от точки во все стороны: дерево путей с накопленными потерями и длиной. */
export async function trace(tx: Tx, startId: string): Promise<TraceResult> {
  const g = await loadGraph(tx);
  const start = g.terms.get(startId);
  if (!start) throw new HttpError(404, "Точка подключения не найдена");

  const nodes: TraceNode[] = [];
  const visited = new Set<string>([startId]);
  const queue: { id: string; parent: number | null; edge: Edge | null }[] = [{ id: startId, parent: null, edge: null }];
  const spanFibers = new Map<string, Set<number>>();

  while (queue.length) {
    const { id, parent, edge } = queue.shift()!;
    const t = g.terms.get(id)!;
    const prev = parent === null ? null : nodes[parent]!;
    const step = edge?.loss ?? zeroLoss();
    const fiber = t.fiberId ? g.fibers.get(t.fiberId) : undefined;
    const node: TraceNode = {
      i: nodes.length,
      parent,
      terminalId: id,
      kind: t.kind,
      via: edge?.via ?? "start",
      connectionKind: edge?.connectionKind,
      label: label(g, t),
      siteId: t.siteId,
      siteName: t.siteName,
      equipmentId: t.equipmentId,
      equipmentName: t.equipmentName,
      equipmentKind: t.equipmentKind,
      spanId: fiber?.spanId,
      cableName: fiber?.cableName,
      fiberNumber: fiber?.number,
      color: fiber?.color,
      stepLoss: { 1310: round3(step[1310]), 1490: round3(step[1490]), 1550: round3(step[1550]) },
      loss: {
        1310: round3((prev?.loss[1310] ?? 0) + step[1310]),
        1490: round3((prev?.loss[1490] ?? 0) + step[1490]),
        1550: round3((prev?.loss[1550] ?? 0) + step[1550]),
      },
      stepLengthM: Math.round((edge?.lengthM ?? 0) * 10) / 10,
      distanceM: Math.round(((prev?.distanceM ?? 0) + (edge?.lengthM ?? 0)) * 10) / 10,
    };
    nodes.push(node);
    if (edge?.spanId && fiber) (spanFibers.get(edge.spanId) ?? spanFibers.set(edge.spanId, new Set()).get(edge.spanId)!).add(fiber.number);
    if (nodes.length > MAX_NODES) throw new HttpError(422, "Трасса слишком большая");

    const next = edges(g, id, node.via).filter((e) => !visited.has(e.to));
    for (const e of next) visited.add(e.to);
    if (next.length === 0 && parent !== null) node.end = endKind(t);
    for (const e of next) queue.push({ id: e.to, parent: node.i, edge: e });
  }

  // Старт без соседей — тоже «конец», чтобы было что показать.
  if (nodes.length === 1) nodes[0]!.end = endKind(start);

  return {
    start: { terminalId: startId, label: nodes[0]!.label },
    nodes,
    leaves: nodes.filter((n) => n.end).map((n) => n.i),
    spans: [...spanFibers.entries()].map(([spanId, f]) => ({ spanId, fibers: [...f].sort((a, b) => a - b) })),
  };
}

// ---------------------------------------------------------------- рефлектометр

interface Segment {
  kind: "slack" | "route";
  lengthM: number;
  siteId?: string;
  routeId?: string;
  reversed?: boolean;
}

/**
 * Место по расстоянию с рефлектометра: идём по пути от точки подключения прибора
 * до выбранной конечной точки, внутри пролёта — по участкам трассы и запасам.
 */
export async function locate(tx: Tx, startId: string, leafTerminalId: string, distanceM: number) {
  const t = await trace(tx, startId);
  const leaf = t.nodes.find((n) => n.terminalId === leafTerminalId);
  if (!leaf) throw new HttpError(422, "Конечная точка не лежит на трассе");
  const path: TraceNode[] = [];
  for (let n: TraceNode | undefined = leaf; n; n = n.parent === null ? undefined : t.nodes[n.parent]) path.unshift(n);

  const total = leaf.distanceM;
  if (distanceM > total) {
    return { beyond: true, totalM: total, description: `Расстояние больше длины трассы (${Math.round(total)} м) — событие за конечной точкой.` };
  }

  // Шаг по волокну, внутри которого лежит точка.
  const step = path.find((n) => n.via === "fiber" && n.distanceM >= distanceM && n.distanceM - n.stepLengthM <= distanceM);
  if (!step || !step.spanId) {
    const at = path.find((n) => n.distanceM >= distanceM) ?? leaf;
    return { beyond: false, totalM: total, siteId: at.siteId, description: `В месте «${at.siteName ?? "…"}» (${at.label}).` };
  }
  const prev = t.nodes[step.parent!]!;
  // Направление по пролёту: пришли в конец b — шли от a к b.
  const [fiberEnd] = await tx.execute<{ side: "a" | "b" }>(sql`SELECT fiber_side AS side FROM terminals WHERE id = ${step.terminalId}`);
  const forward = fiberEnd?.side === "b";
  let offset = distanceM - prev.distanceM;

  const [span] = await tx.execute<{ fromSiteId: string; toSiteId: string; measured: number | null }>(sql`
    SELECT from_site_id AS "fromSiteId", to_site_id AS "toSiteId", measured_length_m::float AS measured FROM cable_spans WHERE id = ${step.spanId}`);
  const legs = await tx.execute<{ routeId: string; reversed: boolean; lengthM: number; fromSiteId: string; toSiteId: string }>(sql`
    SELECT x.route_id AS "routeId", x.reversed, r.length_m AS "lengthM", r.from_site_id AS "fromSiteId", r.to_site_id AS "toSiteId"
    FROM span_routes x JOIN routes r ON r.id = x.route_id WHERE x.span_id = ${step.spanId} ORDER BY x.seq`);
  const slacks = await tx.execute<{ siteId: string; lengthM: number }>(sql`
    SELECT site_id AS "siteId", sum(length_m)::float AS "lengthM" FROM cable_slacks WHERE span_id = ${step.spanId} GROUP BY site_id`);
  const slackAt = new Map(slacks.map((s) => [s.siteId, s.lengthM]));

  // Участки пролёта от a к b: запас в месте, затем трасса до следующего места.
  const segs: Segment[] = [];
  let site = span!.fromSiteId;
  for (const l of legs) {
    if (slackAt.has(site)) segs.push({ kind: "slack", lengthM: slackAt.get(site)!, siteId: site });
    segs.push({ kind: "route", lengthM: l.lengthM, routeId: l.routeId, reversed: l.reversed });
    site = l.reversed ? l.fromSiteId : l.toSiteId;
  }
  if (slackAt.has(site)) segs.push({ kind: "slack", lengthM: slackAt.get(site)!, siteId: site });
  if (!forward) segs.reverse();

  const sum = segs.reduce((s, x) => s + x.lengthM, 0);
  const scale = span!.measured && sum > 0 ? span!.measured / sum : 1;
  for (const s of segs) {
    const len = s.lengthM * scale;
    if (offset <= len || s === segs[segs.length - 1]) {
      if (s.kind === "slack") {
        const [p] = await tx.execute<{ name: string | null; lng: number; lat: number }>(sql`
          SELECT name, ST_X(geom) AS lng, ST_Y(geom) AS lat FROM sites WHERE id = ${s.siteId}`);
        return {
          beyond: false,
          totalM: total,
          siteId: s.siteId,
          position: [p!.lng, p!.lat] as [number, number],
          description: `В запасе кабеля «${step.cableName}» в месте «${p!.name ?? "…"}» (${Math.round(offset)} из ${Math.round(len)} м запаса).`,
        };
      }
      // Доля вдоль участка трассы с учётом направления движения.
      const along = Math.min(1, Math.max(0, offset / len));
      const dirForward = forward !== !!s.reversed;
      const fraction = dirForward ? along : 1 - along;
      const [p] = await tx.execute<{ lng: number; lat: number; a: string | null; b: string | null }>(sql`
        SELECT ST_X(pt) AS lng, ST_Y(pt) AS lat, sa.name AS a, sb.name AS b
        FROM routes r
        CROSS JOIN LATERAL (SELECT ST_LineInterpolatePoint(r.geom, ${fraction}) AS pt) x
        JOIN sites sa ON sa.id = r.from_site_id JOIN sites sb ON sb.id = r.to_site_id
        WHERE r.id = ${s.routeId}`);
      const fromName = dirForward ? p!.a : p!.b;
      const toName = dirForward ? p!.b : p!.a;
      return {
        beyond: false,
        totalM: total,
        routeId: s.routeId,
        position: [p!.lng, p!.lat] as [number, number],
        description: `Кабель «${step.cableName}», волокно ${step.fiberNumber}: на трассе «${fromName ?? "…"}» → «${toName ?? "…"}», ${Math.round(offset)} м от «${fromName ?? "…"}».`,
      };
    }
    offset -= len;
  }
  return { beyond: false, totalM: total, description: "Не удалось определить место" };
}
