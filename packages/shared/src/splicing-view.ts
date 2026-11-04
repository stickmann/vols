import type { Color } from "./cable.js";
import type { ConnectionKind } from "./splicing.js";
import type { ObjectStatus, SiteKind } from "./network.js";

/*
 * Схема разварки корпуса в том виде, в каком её отдаёт API (/equipment/:id/splicing),
 * и общие функции подписи точек — одинаковые в вебе и в печатных документах.
 */

export interface FiberIn {
  terminalId: string;
  fiberId: string;
  number: number;
  module: number;
  position: number;
  condition: "ok" | "damaged" | "reserved";
  color: Color;
  moduleColor: Color;
}

export interface CableIn {
  spanId: string;
  cableId: string;
  name: string | null;
  typeName: string;
  /** a — пролёт начинается в этом корпусе (уходит), b — заканчивается (приходит). */
  side: "a" | "b";
  otherSiteName: string | null;
  otherSiteKind: SiteKind;
  fibers: FiberIn[];
}

export interface Port {
  terminalId: string;
  role: "in" | "out" | "adapter" | "pon";
  no: number;
  face: "rear" | "front" | null;
}

export interface Device {
  id: string;
  kind: string;
  name: string | null;
  modelName: string;
  insertionLossDb: number | null;
  ports: Port[] | null;
}

export interface Conn {
  id: string;
  kind: ConnectionKind;
  aTerminalId: string;
  bTerminalId: string;
  lossDb: number | null;
  trayNo: number | null;
  slotNo: number | null;
  notes: string | null;
}

export interface SplicingData {
  equipment: {
    id: string;
    kind: string;
    name: string | null;
    status: ObjectStatus;
    modelName: string;
    maxSplices: number | null;
    siteId: string;
    siteName: string | null;
    siteKind: SiteKind;
  };
  cables: CableIn[];
  devices: Device[];
  connections: Conn[];
  candidates: { spanId: string; name: string | null; typeName: string; mode: "end" | "transit" }[];
}

export const CONNECTION_KIND_LABELS: Record<string, string> = {
  fusion: "Сварка",
  mechanical: "Механический сплайс",
  patch: "Патч-корд",
  through: "Транзит",
};

/** Типовые потери, если не измерены. */
export const TYPICAL_CONNECTION_LOSS: Record<string, number> = { fusion: 0.05, mechanical: 0.3, patch: 0.3, through: 0 };

export interface TerminalInfo {
  id: string;
  /** Полная подпись: «К-1 · вол. 5 (Жёлтый)». */
  label: string;
  /** Короткая подпись для строки партнёра. */
  short: string;
  color: Color | null;
  group: string;
}

export const cableLabel = (c: Pick<CableIn, "name" | "typeName">) => c.name || c.typeName;
export const deviceLabel = (d: Device) =>
  d.name || (d.kind === "splitter" ? `Сплиттер ${d.modelName.replace(/^PLC\s*/, "")}` : d.modelName);

export function portLabel(d: Device, p: { role: string; no: number; face: string | null }) {
  if (p.role === "in") return `${deviceLabel(d)} вход ${p.no}`;
  if (p.role === "out") return `${deviceLabel(d)} выход ${p.no}`;
  if (p.role === "adapter") return `Порт ${p.no} ${p.face === "rear" ? "(сварка)" : "(патч)"}`;
  return `${deviceLabel(d)} PON ${p.no}`;
}

/** Справочник всех точек подключения корпуса: id → подпись, цвет, к чему относится. */
export function terminalIndex(data: SplicingData): Map<string, TerminalInfo> {
  const m = new Map<string, TerminalInfo>();
  // Один кабель, заведённый транзитом, виден дважды — различаем стороны.
  const perCable = new Map<string, number>();
  for (const c of data.cables) perCable.set(c.cableId, (perCable.get(c.cableId) ?? 0) + 1);
  for (const c of data.cables) {
    const name = (perCable.get(c.cableId) ?? 0) > 1 ? `${cableLabel(c)} (${c.side === "b" ? "приход" : "уход"})` : cableLabel(c);
    for (const f of c.fibers ?? []) {
      m.set(f.terminalId, {
        id: f.terminalId,
        label: `${name} · вол. ${f.number} (${f.color.name}${f.color.marks ? ` +${f.color.marks}` : ""})`,
        short: `${name} · ${f.number}`,
        color: f.color,
        group: c.spanId,
      });
    }
  }
  for (const d of data.devices) {
    for (const p of d.ports ?? []) {
      const label = portLabel(d, p);
      m.set(p.terminalId, { id: p.terminalId, label, short: label, color: null, group: d.id });
    }
  }
  return m;
}

/** Для каждой точки — её соединение (каждая точка участвует максимум в одном). */
export function connectionByTerminal(conns: Conn[]): Map<string, Conn> {
  const m = new Map<string, Conn>();
  for (const c of conns) {
    m.set(c.aTerminalId, c);
    m.set(c.bTerminalId, c);
  }
  return m;
}

export const partnerOf = (c: Conn, terminalId: string) => (c.aTerminalId === terminalId ? c.bTerminalId : c.aTerminalId);

/** Последовательности точек, которые можно сваривать «по порядку». */
export interface Sequence {
  id: string;
  label: string;
  terminals: { id: string; n: number; label: string }[];
}

export function sequences(data: SplicingData): Sequence[] {
  const out: Sequence[] = [];
  for (const c of data.cables) {
    out.push({
      id: `cable:${c.spanId}`,
      label: `${cableLabel(c)} (${c.side === "b" ? "приходит" : "уходит"})`,
      terminals: (c.fibers ?? []).map((f) => ({ id: f.terminalId, n: f.number, label: `вол. ${f.number}` })),
    });
  }
  for (const d of data.devices) {
    const ports = d.ports ?? [];
    if (d.kind === "splitter") {
      const outs = ports.filter((p) => p.role === "out");
      out.push({ id: `out:${d.id}`, label: `${deviceLabel(d)} — выходы`, terminals: outs.map((p) => ({ id: p.terminalId, n: p.no, label: `выход ${p.no}` })) });
    }
    const rear = ports.filter((p) => p.face === "rear");
    if (rear.length) {
      out.push({ id: `rear:${d.id}`, label: `${deviceLabel(d)} — порты (сварка)`, terminals: rear.map((p) => ({ id: p.terminalId, n: p.no, label: `порт ${p.no}` })) });
    }
  }
  return out;
}

export interface PlannedPair {
  a: { id: string; label: string };
  b: { id: string; label: string };
  busy: boolean;
}

/** Пары для сварки по порядку: from[start..] ↔ to[start..], count штук. */
export function planPairs(from: Sequence, fromStart: number, to: Sequence, toStart: number, count: number, busy: Set<string>): PlannedPair[] {
  const fi = from.terminals.findIndex((t) => t.n === fromStart);
  const ti = to.terminals.findIndex((t) => t.n === toStart);
  if (fi < 0 || ti < 0 || count < 1) return [];
  const n = Math.min(count, from.terminals.length - fi, to.terminals.length - ti);
  return Array.from({ length: n }, (_, i) => {
    const a = from.terminals[fi + i]!;
    const b = to.terminals[ti + i]!;
    return { a, b, busy: busy.has(a.id) || busy.has(b.id) || a.id === b.id };
  });
}

/** Сводка по корпусу для шапки. */
export function splicingStats(data: SplicingData) {
  const kinds = data.connections.reduce<Record<string, number>>((acc, c) => ((acc[c.kind] = (acc[c.kind] ?? 0) + 1), acc), {});
  const used = connectionByTerminal(data.connections);
  const fibers = data.cables.flatMap((c) => c.fibers ?? []);
  return {
    splices: (kinds.fusion ?? 0) + (kinds.mechanical ?? 0),
    patches: kinds.patch ?? 0,
    through: kinds.through ?? 0,
    freeFibers: fibers.filter((f) => !used.has(f.terminalId)).length,
    totalFibers: fibers.length,
  };
}

/** «1–8, 11, 13–16» из списка номеров. */
export function compressRanges(nums: number[]): string {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j]! + 1) j++;
    out.push(i === j ? `${s[i]}` : `${s[i]}–${s[j]}`);
    i = j + 1;
  }
  return out.join(", ");
}
