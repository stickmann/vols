import {
  modulesFromTemplate,
  resolveColor,
  type CableModule,
  type CableTypeInput,
  type Color,
  type FiberColor,
} from "@vols/shared";

/** Черновик типа кабеля в редакторе: строки вместо null, чтобы удобно связывать с полями. */
export interface Draft {
  name: string;
  construction: CableTypeInput["construction"];
  fiberStandard: string;
  attenuation1310DbKm: number;
  attenuation1550DbKm: number;
  outerDiameterMm: number | null;
  notes: string;
  modules: CableModule[];
}

export const MAX_FIBERS_PER_MODULE = 48;
export const MAX_MODULES = 48;

export function newDraft(scheme: readonly FiberColor[]): Draft {
  return {
    name: "",
    construction: "aerial",
    fiberStandard: "G.652D",
    attenuation1310DbKm: 0.35,
    attenuation1550DbKm: 0.22,
    outerDiameterMm: null,
    notes: "",
    modules: modulesFromTemplate({ modulesCount: 1, fibersPerModule: 8, moduleColors: scheme, fiberColors: scheme }),
  };
}

export function draftFromInput(v: CableTypeInput): Draft {
  return {
    name: v.name,
    construction: v.construction,
    fiberStandard: v.fiberStandard ?? "",
    attenuation1310DbKm: v.attenuation1310DbKm,
    attenuation1550DbKm: v.attenuation1550DbKm,
    outerDiameterMm: v.outerDiameterMm ?? null,
    notes: v.notes ?? "",
    modules: structuredClone(v.modules),
  };
}

export function draftToInput(d: Draft): CableTypeInput {
  return {
    name: d.name.trim(),
    construction: d.construction,
    fiberStandard: d.fiberStandard.trim() || null,
    attenuation1310DbKm: d.attenuation1310DbKm,
    attenuation1550DbKm: d.attenuation1550DbKm,
    outerDiameterMm: d.outerDiameterMm,
    notes: d.notes.trim() || null,
    modules: d.modules,
  };
}

type Fields = Omit<Draft, "modules">;

export type Action =
  | { type: "reset"; draft: Draft }
  | { [K in keyof Fields]: { type: "field"; key: K; value: Fields[K] } }[keyof Fields]
  | { type: "template"; modulesCount: number; fibersPerModule: number; moduleColors: readonly FiberColor[]; fiberColors: readonly FiberColor[] }
  | { type: "addModule"; fibers: number; moduleColors: readonly FiberColor[]; fiberColors: readonly FiberColor[] }
  | { type: "removeModule"; index: number }
  | { type: "duplicateModule"; index: number }
  | { type: "moveModule"; index: number; delta: -1 | 1 }
  | { type: "moduleColor"; index: number; color: Color }
  | { type: "fiberCount"; index: number; count: number; fiberColors: readonly FiberColor[] }
  | { type: "fiberColor"; module: number; fiber: number; color: Color }
  | { type: "recolorFibers"; index: number; fiberColors: readonly FiberColor[] }
  | { type: "recolorModules"; moduleColors: readonly FiberColor[] };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

function updateModule(d: Draft, index: number, fn: (m: CableModule) => CableModule): Draft {
  if (!d.modules[index]) return d;
  return { ...d, modules: d.modules.map((m, i) => (i === index ? fn(m) : m)) };
}

export function reducer(d: Draft, a: Action): Draft {
  switch (a.type) {
    case "reset":
      return a.draft;
    case "field":
      return { ...d, [a.key]: a.value };
    case "template":
      return {
        ...d,
        modules: modulesFromTemplate({
          modulesCount: clamp(a.modulesCount, 1, MAX_MODULES),
          fibersPerModule: clamp(a.fibersPerModule, 0, MAX_FIBERS_PER_MODULE),
          moduleColors: a.moduleColors,
          fiberColors: a.fiberColors,
        }),
      };
    case "addModule": {
      if (d.modules.length >= MAX_MODULES) return d;
      const count = clamp(a.fibers, 0, MAX_FIBERS_PER_MODULE);
      return {
        ...d,
        modules: [
          ...d.modules,
          {
            color: resolveColor(a.moduleColors, d.modules.length + 1),
            fibers: Array.from({ length: count }, (_, i) => resolveColor(a.fiberColors, i + 1)),
          },
        ],
      };
    }
    case "removeModule":
      if (d.modules.length <= 1) return d;
      return { ...d, modules: d.modules.filter((_, i) => i !== a.index) };
    case "duplicateModule": {
      const m = d.modules[a.index];
      if (!m || d.modules.length >= MAX_MODULES) return d;
      const modules = [...d.modules];
      modules.splice(a.index + 1, 0, structuredClone(m));
      return { ...d, modules };
    }
    case "moveModule": {
      const j = a.index + a.delta;
      if (j < 0 || j >= d.modules.length || !d.modules[a.index]) return d;
      const modules = [...d.modules];
      [modules[a.index], modules[j]] = [modules[j]!, modules[a.index]!];
      return { ...d, modules };
    }
    case "moduleColor":
      return updateModule(d, a.index, (m) => ({ ...m, color: a.color }));
    case "fiberCount":
      return updateModule(d, a.index, (m) => {
        const n = clamp(a.count, 0, MAX_FIBERS_PER_MODULE);
        if (n <= m.fibers.length) return { ...m, fibers: m.fibers.slice(0, n) };
        const extra = Array.from({ length: n - m.fibers.length }, (_, i) => resolveColor(a.fiberColors, m.fibers.length + i + 1));
        return { ...m, fibers: [...m.fibers, ...extra] };
      });
    case "fiberColor":
      return updateModule(d, a.module, (m) =>
        m.fibers[a.fiber] ? { ...m, fibers: m.fibers.map((f, i) => (i === a.fiber ? a.color : f)) } : m,
      );
    case "recolorFibers":
      return updateModule(d, a.index, (m) => ({
        ...m,
        fibers: m.fibers.map((_, i) => resolveColor(a.fiberColors, i + 1)),
      }));
    case "recolorModules":
      return { ...d, modules: d.modules.map((m, i) => ({ ...m, color: resolveColor(a.moduleColors, i + 1) })) };
  }
}

/** Конструкция одной строкой: «4×8», «8+8+4», «2×12 + 1 заполнитель». */
export function describeConstruction(modules: readonly { fiberCount?: number; fibers?: unknown[] }[]): string {
  const counts = modules.map((m) => m.fiberCount ?? m.fibers?.length ?? 0);
  const real = counts.filter((c) => c > 0);
  const fillers = counts.length - real.length;
  if (real.length === 0) return "нет волокон";
  const body = real.every((c) => c === real[0]) ? `${real.length}×${real[0]}` : real.join("+");
  return fillers ? `${body} + ${fillers} ${fillers === 1 ? "заполнитель" : fillers < 5 ? "заполнителя" : "заполнителей"}` : body;
}

export function isStructureEqual(a: readonly CableModule[], b: readonly CableModule[]): boolean {
  return a.length === b.length && a.every((m, i) => m.fibers.length === b[i]!.fibers.length);
}
