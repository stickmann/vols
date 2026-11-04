import { z } from "zod";
import { resolveColor, type FiberColor } from "./colors.js";

/**
 * Конструкция типа кабеля из справочника. Задаётся полностью вручную:
 * каждый модуль со своим цветом и числом волокон, каждое волокно со своим цветом.
 * Модуль без волокон — кордель-заполнитель.
 */

export const colorSchema = z.object({
  name: z.string().trim().min(1).max(40),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Цвет в формате #RRGGBB"),
  /** Кольцевая/штриховая маркировка поверх основного цвета, 0 — нет. */
  marks: z.number().int().min(0).max(4).default(0),
});
export type Color = z.infer<typeof colorSchema>;

export const cableModuleSchema = z.object({
  color: colorSchema,
  /** Цвета волокон по порядку; длина массива = число волокон в модуле. */
  fibers: z.array(colorSchema).max(48),
});
export type CableModule = z.infer<typeof cableModuleSchema>;

export const cableConstructionKinds = ["aerial", "duct", "ground", "indoor", "drop"] as const;

export const cableTypeInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    construction: z.enum(cableConstructionKinds),
    fiberStandard: z.string().trim().max(20).nullish(),
    attenuation1310DbKm: z.number().min(0).max(2).default(0.35),
    attenuation1550DbKm: z.number().min(0).max(2).default(0.22),
    outerDiameterMm: z.number().positive().max(100).nullish(),
    notes: z.string().max(2000).nullish(),
    modules: z.array(cableModuleSchema).min(1).max(48),
  })
  .refine((v) => v.modules.some((m) => m.fibers.length > 0), {
    message: "В кабеле должно быть хотя бы одно волокно",
    path: ["modules"],
  });
export type CableTypeInput = z.infer<typeof cableTypeInputSchema>;

/** Плоская раскладка волокон: сквозной номер, модуль, позиция в модуле, цвет. */
export interface CableFiberSpec {
  number: number;
  module: number;
  position: number;
  color: Color;
}

export function flattenFibers(modules: readonly CableModule[]): CableFiberSpec[] {
  const out: CableFiberSpec[] = [];
  let n = 0;
  modules.forEach((m, mi) => {
    m.fibers.forEach((color, fi) => {
      out.push({ number: ++n, module: mi + 1, position: fi + 1, color });
    });
  });
  return out;
}

export function totalFibers(modules: readonly CableModule[]): number {
  return modules.reduce((s, m) => s + m.fibers.length, 0);
}

/**
 * Заполнить конструкцию по шаблону: N одинаковых модулей по M волокон,
 * цвета берутся из цветовых схем. Результат можно править вручную.
 */
export function modulesFromTemplate(opts: {
  modulesCount: number;
  fibersPerModule: number;
  moduleColors: readonly FiberColor[];
  fiberColors: readonly FiberColor[];
}): CableModule[] {
  return Array.from({ length: opts.modulesCount }, (_, mi) => ({
    color: resolveColor(opts.moduleColors, mi + 1),
    fibers: Array.from({ length: opts.fibersPerModule }, (_, fi) => resolveColor(opts.fiberColors, fi + 1)),
  }));
}
