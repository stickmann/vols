import type { CableModule } from "./cable.js";
import type { CableTypeInput } from "./cable.js";
import { resolveColor, type FiberColor } from "./colors.js";
import { STANDARD_COLORS as C } from "./presets.js";

/**
 * Библиотека марок оптических кабелей по производителям — из открытых источников
 * (сайты производителей, спецификации, справочники). Оператор добавляет нужную марку
 * в свой справочник одним действием и при необходимости правит.
 *
 * Конструкция строится по правилу окраски производителя для типовой ёмкости
 * (модули × волокна). Производители меняют конструкцию и цвета по согласованию
 * с заказчиком, поэтому перед разваркой сверяйте с паспортом конкретного барабана.
 */

/** Ряд цветов волокон по ANSI/TIA-598 (ГОСТ Р 53246, прил. В). 13–24 — те же с чёрной меткой. */
export const TIA598_FIBER_COLORS: FiberColor[] = [
  C.blue, C.orange, C.green, C.brown, C.gray, C.white, C.red, C.black, C.yellow, C.violet, C.pink, C.aqua,
];

const N = C.natural;
const pad = (head: FiberColor[], count: number): FiberColor[] =>
  Array.from({ length: count }, (_, i) => head[i] ?? N);

/** Ряд цветов волокон Москабель-Фуджикура. */
const MKF_COLORS: FiberColor[] = [
  C.natural, C.red, C.blue, C.green, C.yellow, C.violet, C.orange, C.gray, C.skyBlue, C.black, C.brown, C.pink,
];

export interface ManufacturerProfile {
  key: string;
  name: string;
  /** Правило окраски модулей словами — показывается пользователю. */
  moduleRule: string;
  fiberRule: string;
  /** Цвета модулей для кабеля из `count` модулей. */
  moduleColors: (count: number) => FiberColor[];
  fiberColors: FiberColor[];
  /** Что подтверждено источником, а что принято по общей практике. */
  confidence: "source" | "partial";
  sources: { title: string; url: string }[];
}

export const MANUFACTURERS: ManufacturerProfile[] = [
  {
    key: "incab",
    name: "Инкаб",
    moduleRule: "Синий — основной, оранжевый — направляющий, остальные натуральные (счёт от оранжевого). Два модуля: синий и натуральный. Один модуль: натуральный.",
    fiberRule: "ANSI/TIA-598: синий, оранжевый, зелёный, коричневый, серый, белый, красный, чёрный, жёлтый, фиолетовый, розовый, бирюзовый; 13–24 — те же с чёрным кольцом.",
    moduleColors: (n) => (n === 1 ? [N] : n === 2 ? [C.blue, N] : pad([C.blue, C.orange], n)),
    fiberColors: TIA598_FIBER_COLORS,
    confidence: "source",
    sources: [
      { title: "Инкаб: расцветка оптических волокон", url: "https://incab.ru/useful-information/optic-cable-and-fiber/color/" },
      { title: "Инкаб: спецификация ДПС-П", url: "https://incab.ru/files/spec_dps-p-16_20kn.pdf" },
    ],
  },
  {
    key: "sarko",
    name: "Сарансккабель-Оптика",
    moduleRule: "Жёлтый — основной, красный — направляющий, остальные натуральные (счёт от красного). Кордели-заполнители чёрные.",
    fiberRule: "12 цветов, 13–24 — те же с чёрным кольцом. Порядок принят по ANSI/TIA-598 — сверьте с паспортом.",
    moduleColors: (n) => (n === 1 ? [N] : pad([C.yellow, C.red], n)),
    fiberColors: TIA598_FIBER_COLORS,
    confidence: "partial",
    sources: [
      { title: "Сарансккабель-Оптика: цветовая идентификация", url: "https://sarko.ru/tsvetovaya-identifikatsiya-opticheskih-volokon-i-moduley.html" },
      { title: "Сарансккабель-Оптика: кабель ОКЛ", url: "https://sarko.ru/kabel-okl.html" },
    ],
  },
  {
    key: "integra",
    name: "Интегра-Кабель",
    moduleRule: "Окрашены два модуля: красный — первый (основной), зелёный — направляющий, остальные натуральные (счёт от зелёного).",
    fiberRule: "Порядок принят по ANSI/TIA-598 — сверьте с паспортом.",
    moduleColors: (n) => (n === 1 ? [N] : pad([C.red, C.green], n)),
    fiberColors: TIA598_FIBER_COLORS,
    confidence: "partial",
    sources: [{ title: "Интегра Кабель: вопросы и ответы", url: "https://intg.ru/poleznaja/vopros-otvet/" }],
  },
  {
    key: "mkf",
    name: "Москабель-Фуджикура",
    moduleRule: "Цвета модулей в открытых источниках не найдены: приняты как у волокон — сверьте с паспортом.",
    fiberRule: "Натуральный, красный, синий, зелёный, жёлтый, фиолетовый, оранжевый, серый, голубой, чёрный, коричневый, розовый (первые восемь — по сайту производителя).",
    moduleColors: (n) => Array.from({ length: n }, (_, i) => MKF_COLORS[i % MKF_COLORS.length]!),
    fiberColors: MKF_COLORS,
    confidence: "partial",
    sources: [{ title: "Москабель-Фуджикура: цвет волокон", url: "https://mk-f.ru/info/cvet/" }],
  },
  {
    key: "tia",
    name: "Модули по TIA-598 (импорт, GYTA/ADSS)",
    moduleRule: "Все модули окрашены по ряду ANSI/TIA-598: синий, оранжевый, зелёный, коричневый, серый, белый…",
    fiberRule: "ANSI/TIA-598, 13–24 — с чёрной меткой.",
    moduleColors: (n) => Array.from({ length: n }, (_, i) => TIA598_FIBER_COLORS[i % 12]!),
    fiberColors: TIA598_FIBER_COLORS,
    confidence: "source",
    sources: [{ title: "Стандартизация маркировки оптических кабелей", url: "https://vols.expert/useful-information/markirovka-opticheskih-kabelej-rossii/" }],
  },
];


type Construction = CableTypeInput["construction"];

interface Family {
  manufacturer: string;
  /** Обозначение марки у производителя. */
  mark: string;
  construction: Construction;
  description: string;
  name: (fibers: number, modules: number, perModule: number) => string;
  /** Типовые конструкции: [модулей, волокон в модуле]. */
  layouts: [number, number][];
  fiberStandard?: string;
}

// Типовые конструкции многомодульных кабелей: модули по 4, 8, 12, 16 и 24 волокна.
const LOOSE: [number, number][] = [
  [1, 4], [1, 8], [1, 12], [2, 4], [2, 8], [4, 4], [4, 8], [4, 12], [4, 16], [6, 8], [6, 12], [8, 12], [12, 12],
];
const LOOSE_BIG: [number, number][] = [[4, 24], [12, 16], [12, 24]];

const incabName = (mark: string) => (n: number, m: number, f: number) => `${mark}-П-${n}У (${m}х${f})`;
const plainName = (mark: string) => (n: number, m: number, f: number) => `${mark}-${n} (${m}×${f})`;

const FAMILIES: Family[] = [
  { manufacturer: "incab", mark: "ДПТ", construction: "aerial", description: "самонесущий диэлектрический", name: incabName("ДПТ"), layouts: [...LOOSE, ...LOOSE_BIG] },
  { manufacturer: "incab", mark: "ДПТс", construction: "aerial", description: "самонесущий для городских сетей", name: incabName("ДПТс"), layouts: LOOSE },
  { manufacturer: "incab", mark: "ДПС", construction: "ground", description: "бронированный стальной проволокой, в грунт", name: incabName("ДПС"), layouts: [...LOOSE, ...LOOSE_BIG] },
  { manufacturer: "sarko", mark: "ОКК", construction: "aerial", description: "самонесущий диэлектрический", name: plainName("ОКК"), layouts: LOOSE },
  { manufacturer: "sarko", mark: "ОКЛ", construction: "duct", description: "с бронёй из гофрированной ленты, в канализацию", name: plainName("ОКЛ"), layouts: [...LOOSE, ...LOOSE_BIG] },
  { manufacturer: "sarko", mark: "ОКБ", construction: "ground", description: "бронированный проволокой, в грунт", name: plainName("ОКБ"), layouts: LOOSE },
  { manufacturer: "integra", mark: "Самонесущий", construction: "aerial", description: "самонесущий", name: (n, m, f) => `Интегра самонесущий ${n} (${m}×${f})`, layouts: LOOSE },
  { manufacturer: "integra", mark: "Канализационный", construction: "duct", description: "в канализацию", name: (n, m, f) => `Интегра канализационный ${n} (${m}×${f})`, layouts: LOOSE },
  { manufacturer: "mkf", mark: "ОКСД", construction: "aerial", description: "самонесущий диэлектрический", name: plainName("ОКСД"), layouts: LOOSE },
  { manufacturer: "mkf", mark: "ОКЛ", construction: "duct", description: "с бронёй из ламинированной ленты", name: plainName("МКФ ОКЛ"), layouts: LOOSE },
  { manufacturer: "tia", mark: "ADSS", construction: "aerial", description: "самонесущий диэлектрический", name: plainName("ADSS"), layouts: LOOSE },
  { manufacturer: "tia", mark: "GYTA", construction: "duct", description: "модульный с алюминиевой лентой", name: plainName("GYTA"), layouts: LOOSE },
];

export interface CableLibraryItem {
  id: string;
  manufacturer: string;
  manufacturerKey: string;
  mark: string;
  description: string;
  name: string;
  fibers: number;
  layout: string;
  confidence: ManufacturerProfile["confidence"];
  input: CableTypeInput;
}

function modulesFor(p: ManufacturerProfile, count: number, perModule: number): CableModule[] {
  const mc = p.moduleColors(count);
  return mc.map((c) => ({
    color: { ...c, marks: 0 },
    fibers: Array.from({ length: perModule }, (_, i) => resolveColor(p.fiberColors, i + 1)),
  }));
}

function notesFor(p: ManufacturerProfile, f: Family): string {
  return [
    `${p.name}, ${f.mark} — ${f.description}. Типовая конструкция из библиотеки марок.`,
    `Модули: ${p.moduleRule}`,
    `Волокна: ${p.fiberRule}`,
    "Производитель может изменить конструкцию и цвета по заказу — сверьте с паспортом барабана.",
    `Источник: ${p.sources.map((s) => s.url).join(", ")}`,
  ].join("\n");
}

/** Абонентские дроп-кабели FTTH: плоские, 1–4 волокна G.657A2. */
const DROPS: CableLibraryItem[] = [1, 2, 4].map((n) => ({
  id: `drop:ftth:${n}`,
  manufacturer: "Абонентские FTTH",
  manufacturerKey: "drop",
  mark: "FTTH дроп",
  description: "плоский абонентский, G.657A2",
  name: `FTTH дроп плоский ${n}×G.657A2`,
  fibers: n,
  layout: `1×${n}`,
  confidence: "partial",
  input: {
    name: `FTTH дроп плоский ${n}×G.657A2`,
    construction: "drop",
    fiberStandard: "G.657A2",
    attenuation1310DbKm: 0.35,
    attenuation1550DbKm: 0.22,
    notes: "Плоский абонентский кабель (фигура «8» или без несущего), волокна G.657A2. Цвета волокон приняты по ANSI/TIA-598 — сверьте с паспортом.",
    modules: [{ color: { ...N, marks: 0 }, fibers: Array.from({ length: n }, (_, i) => resolveColor(TIA598_FIBER_COLORS, i + 1)) }],
  },
}));

let cache: CableLibraryItem[] | null = null;

/** Все марки библиотеки (строятся один раз). */
export function cableLibrary(): CableLibraryItem[] {
  if (cache) return cache;
  const items: CableLibraryItem[] = [];
  for (const f of FAMILIES) {
    const p = MANUFACTURERS.find((m) => m.key === f.manufacturer)!;
    for (const [m, per] of f.layouts) {
      const n = m * per;
      const name = f.name(n, m, per);
      items.push({
        id: `${p.key}:${f.mark}:${m}x${per}`,
        manufacturer: p.name,
        manufacturerKey: p.key,
        mark: f.mark,
        description: f.description,
        name,
        fibers: n,
        layout: `${m}×${per}`,
        confidence: p.confidence,
        input: {
          name,
          construction: f.construction,
          fiberStandard: f.fiberStandard ?? "G.652D",
          attenuation1310DbKm: 0.35,
          attenuation1550DbKm: 0.22,
          notes: notesFor(p, f),
          modules: modulesFor(p, m, per),
        },
      });
    }
  }
  cache = [...items, ...DROPS];
  return cache;
}
