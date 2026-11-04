// Модель разварки живёт в @vols/shared: её же используют печатные документы на сервере.
export {
  CONNECTION_KIND_LABELS as KIND_LABELS,
  TYPICAL_CONNECTION_LOSS as TYPICAL_LOSS,
  cableLabel,
  connectionByTerminal,
  deviceLabel,
  partnerOf,
  planPairs,
  portLabel,
  sequences,
  splicingStats as stats,
  terminalIndex,
} from "@vols/shared";
export type { PlannedPair, Sequence, TerminalInfo } from "@vols/shared";
