import type { Color } from "./cable.js";
import { DEFAULT_LOSS_DB, GPON_CLASS_BUDGET_DB, PLC_SPLITTER_LOSS_DB } from "./optics.js";

export const WAVELENGTHS = [1310, 1490, 1550] as const;
export type Wavelength = (typeof WAVELENGTHS)[number];
export type LossByWavelength = Record<Wavelength, number>;

export type TraceVia = "start" | "connection" | "fiber" | "splitter" | "adapter";

/** Чем заканчивается ветка трассы. */
export type TraceEnd =
  | "olt" // PON-порт OLT
  | "onu" // ONU абонента
  | "subscriber_port" // свободный абонентский порт ящика/кросса (лицевая сторона)
  | "free_splitter_output" // свободный выход сплиттера
  | "open_fiber" // конец волокна без соединения (не разварен / обрыв)
  | "free_port"; // прочий свободный порт

export const TRACE_END_LABELS: Record<TraceEnd, string> = {
  olt: "PON-порт OLT",
  onu: "ONU",
  subscriber_port: "Абонентский порт",
  free_splitter_output: "Свободный выход сплиттера",
  open_fiber: "Конец волокна не разварен",
  free_port: "Свободный порт",
};

export interface TraceNode {
  i: number;
  parent: number | null;
  terminalId: string;
  kind: "fiber_end" | "port";
  /** Как пришли в эту точку из родительской. */
  via: TraceVia;
  connectionKind?: string;
  label: string;
  siteId: string;
  siteName: string | null;
  equipmentId: string | null;
  equipmentName: string | null;
  equipmentKind: string | null;
  spanId?: string;
  cableName?: string;
  fiberNumber?: number;
  color?: Color;
  stepLoss: LossByWavelength;
  loss: LossByWavelength;
  stepLengthM: number;
  distanceM: number;
  end?: TraceEnd;
}

export interface TraceResult {
  start: { terminalId: string; label: string };
  nodes: TraceNode[];
  /** Индексы конечных точек. */
  leaves: number[];
  /** Пролёты на пути: id → номера волокон. */
  spans: { spanId: string; fibers: number[] }[];
}

export const zeroLoss = (): LossByWavelength => ({ 1310: 0, 1490: 0, 1550: 0 });

/** Километрическое затухание волокна для длин волн; для 1490 нм — интерполяция между 1310 и 1550. */
export function fiberAttenuation(a1310: number, a1550: number): LossByWavelength {
  return { 1310: a1310, 1490: round3(a1550 + (a1310 - a1550) * 0.2), 1550: a1550 };
}

export function connectionLoss(kind: string, measured: number | null): number {
  if (measured != null) return measured;
  switch (kind) {
    case "fusion":
      return DEFAULT_LOSS_DB.fusionSplice;
    case "mechanical":
      return DEFAULT_LOSS_DB.mechanicalSplice;
    case "patch":
      return DEFAULT_LOSS_DB.connector;
    default:
      return 0;
  }
}

/** Потери сплиттера на выход: по каждому выходу (FBT), номинал модели или типовое значение PLC 1:N. */
export function splitterLoss(outputs: number, nominal: number | null, perOutput: number[] | null, outputNo: number): number {
  const specific = perOutput?.[outputNo - 1];
  if (specific != null) return specific;
  if (nominal != null) return nominal;
  return PLC_SPLITTER_LOSS_DB[outputs] ?? 10 * Math.log10(outputs) + 1;
}

export type GponClass = keyof typeof GPON_CLASS_BUDGET_DB;
export type BudgetStatus = "ok" | "low_margin" | "over" | "under";

/** Оценка затухания линии по классу оптики: запас до максимума, риск перегрузки при малом затухании. */
export function assessBudget(lossDb: number, cls: GponClass, safetyMarginDb = 3) {
  const b = GPON_CLASS_BUDGET_DB[cls];
  const margin = round3(b.max - lossDb);
  let status: BudgetStatus = "ok";
  if (lossDb > b.max) status = "over";
  else if (margin < safetyMarginDb) status = "low_margin";
  else if (lossDb < b.min) status = "under";
  return { margin, status, min: b.min, max: b.max };
}

export const round3 = (x: number) => Math.round(x * 1000) / 1000;
