import type { Color } from "@vols/shared";
import type { CableIn, Conn, Device, SplicingData } from "./api.js";

export const KIND_LABELS: Record<string, string> = {
  fusion: "Сварка",
  mechanical: "Механический сплайс",
  patch: "Патч-корд",
  through: "Транзит",
};

/** Типовые потери, если не измерены. */
export const TYPICAL_LOSS: Record<string, number> = { fusion: 0.05, mechanical: 0.3, patch: 0.3, through: 0 };

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
export function stats(data: SplicingData) {
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
