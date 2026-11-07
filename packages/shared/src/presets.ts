import { modulesFromTemplate, type CableModule } from "./cable.js";
import type { FiberColor } from "./colors.js";
import { PLC_SPLITTER_LOSS_DB } from "./optics.js";

/**
 * Стартовые справочники, которые копируются каждому новому оператору.
 * Оператор потом может править их у себя.
 */

/** Стандартная палитра цветов оптических модулей и волокон. */
export const STANDARD_COLORS = {
  red: { name: "Красный", hex: "#e02b2b" },
  green: { name: "Зелёный", hex: "#17a81a" },
  blue: { name: "Синий", hex: "#1f6fd0" },
  yellow: { name: "Жёлтый", hex: "#f2d024" },
  white: { name: "Белый", hex: "#f4f4f4" },
  gray: { name: "Серый", hex: "#9a9a9a" },
  brown: { name: "Коричневый", hex: "#8b5a2b" },
  violet: { name: "Фиолетовый", hex: "#8a3ffc" },
  orange: { name: "Оранжевый", hex: "#ff8c1a" },
  black: { name: "Чёрный", hex: "#303030" },
  pink: { name: "Розовый", hex: "#ff8fb1" },
  aqua: { name: "Бирюзовый", hex: "#30c7c7" },
  skyBlue: { name: "Голубой", hex: "#7cc4f0" },
  natural: { name: "Натуральный", hex: "#e8e0c8" },
} satisfies Record<string, FiberColor>;
const C = STANDARD_COLORS;

/** Фиксированный id демо-оператора: создаётся сидом, веб в режиме разработки работает от него. */
export const DEMO_TENANT_ID = "00000000-0000-4000-8000-00000000de00";

export interface ColorSchemePreset {
  key: string;
  name: string;
  colors: FiberColor[];
}

export const COLOR_SCHEME_PRESETS: ColorSchemePreset[] = [
  {
    key: "tia598",
    name: "TIA-598-C",
    colors: [C.blue, C.orange, C.green, C.brown, C.gray, C.white, C.red, C.black, C.yellow, C.violet, C.pink, C.aqua],
  },
  {
    key: "ru",
    name: "Отечественная (красный — направляющий)",
    colors: [C.red, C.green, C.blue, C.yellow, C.white, C.gray, C.brown, C.violet, C.orange, C.black, C.pink, C.aqua],
  },
  {
    key: "drop",
    name: "Дроп-кабель",
    colors: [C.blue, C.orange, C.green, C.brown],
  },
];

export interface CableTypePreset {
  name: string;
  construction: "aerial" | "duct" | "ground" | "indoor" | "drop";
  fiberStandard: string;
  /** Шаблон: одинаковые модули, цвета модулей и волокон — из одной схемы. */
  modulesCount: number;
  fibersPerModule: number;
  colorScheme: string;
}

const t = (
  name: string,
  construction: CableTypePreset["construction"],
  modulesCount: number,
  fibersPerModule: number,
  fiberStandard = "G.652D",
  colorScheme = "ru",
): CableTypePreset => ({ name, construction, modulesCount, fibersPerModule, fiberStandard, colorScheme });

export const CABLE_TYPE_PRESETS: CableTypePreset[] = [
  t("Дроп 1×4", "drop", 1, 4, "G.657A2", "drop"),
  t("ОКСН 1×8", "aerial", 1, 8, "G.657A1"),
  t("ОКСН 2×8 (16)", "aerial", 2, 8),
  t("ОКСН 4×8 (32)", "aerial", 4, 8),
  t("ОКСН 4×12 (48)", "aerial", 4, 12),
  t("ОКЛ 6×12 (72)", "duct", 6, 12),
  t("ОКЛ 12×12 (144)", "duct", 12, 12),
];

/** Конструкция пресета в виде, пригодном для справочника. */
export function presetModules(p: CableTypePreset): CableModule[] {
  const scheme = COLOR_SCHEME_PRESETS.find((s) => s.key === p.colorScheme);
  if (!scheme) throw new Error(`Нет цветовой схемы ${p.colorScheme}`);
  return modulesFromTemplate({
    modulesCount: p.modulesCount,
    fibersPerModule: p.fibersPerModule,
    moduleColors: scheme.colors,
    fiberColors: scheme.colors,
  });
}

export type EquipmentKind = "closure" | "terminal_box" | "odf" | "splitter" | "olt" | "onu";

export interface EquipmentModelPreset {
  kind: EquipmentKind;
  name: string;
  portCount?: number;
  maxSplices?: number;
  cableEntries?: number;
  splitterInputs?: number;
  splitterOutputs?: number;
  insertionLossDb?: number;
}

const splitter = (n: number): EquipmentModelPreset => ({
  kind: "splitter",
  name: `PLC 1:${n}`,
  splitterInputs: 1,
  splitterOutputs: n,
  insertionLossDb: PLC_SPLITTER_LOSS_DB[n],
});

export const EQUIPMENT_MODEL_PRESETS: EquipmentModelPreset[] = [
  { kind: "closure", name: "Муфта МТОК-Л6 (до 96 сварок)", maxSplices: 96, cableEntries: 6 },
  { kind: "closure", name: "Муфта МТОК-К6 (до 144 сварок)", maxSplices: 144, cableEntries: 6 },
  { kind: "terminal_box", name: "ОРК на 8 абонентов (SC/APC)", portCount: 8, maxSplices: 16, cableEntries: 2 },
  { kind: "terminal_box", name: "ОРК на 16 абонентов (SC/APC)", portCount: 16, maxSplices: 32, cableEntries: 4 },
  { kind: "odf", name: "Кросс ШКОС 1U, 24 порта", portCount: 24, maxSplices: 24 },
  { kind: "odf", name: "Кросс ШКОС 2U, 48 портов", portCount: 48, maxSplices: 48 },
  splitter(2),
  splitter(4),
  splitter(8),
  splitter(16),
  splitter(32),
  { kind: "olt", name: "OLT 8 PON", portCount: 8 },
  { kind: "olt", name: "OLT 16 PON", portCount: 16 },
  { kind: "onu", name: "ONU (1 PON)", portCount: 1 },
];
