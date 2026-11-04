/**
 * Типовые значения для расчёта оптического бюджета, если в справочнике
 * или в измерениях нет точных данных. Значения в дБ.
 */
export const DEFAULT_LOSS_DB = {
  fusionSplice: 0.05,
  mechanicalSplice: 0.3,
  connector: 0.3,
  /** На километр, по длинам волн. */
  fiberPerKm: { 1310: 0.35, 1490: 0.25, 1550: 0.22 },
} as const;

/** Типовые потери PLC-сплиттеров 1:N (с учётом коннекторов не считая). */
export const PLC_SPLITTER_LOSS_DB: Readonly<Record<number, number>> = {
  2: 3.7,
  4: 7.3,
  8: 10.5,
  16: 13.7,
  32: 17.1,
  64: 20.5,
};

/** Бюджеты классов оптики GPON (ITU-T G.984.2), дБ: минимальное и максимальное затухание. */
export const GPON_CLASS_BUDGET_DB = {
  "B+": { min: 13, max: 28 },
  "C+": { min: 17, max: 32 },
  "C++": { min: 19, max: 35 },
} as const;
