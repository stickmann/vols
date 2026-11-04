import { describe, expect, it } from "vitest";
import {
  CABLE_TYPE_PRESETS,
  COLOR_SCHEME_PRESETS,
  cableTypeInputSchema,
  flattenFibers,
  presetModules,
  resolveColor,
  totalFibers,
} from "../src/index.js";

const ru = COLOR_SCHEME_PRESETS.find((s) => s.key === "ru")!.colors;
const red = { name: "Красный", hex: "#e02b2b", marks: 0 };
const blue = { name: "Синий", hex: "#1f6fd0", marks: 0 };

describe("resolveColor", () => {
  it("берёт цвет по позиции", () => {
    expect(resolveColor(ru, 1)).toMatchObject({ name: "Красный", marks: 0 });
    expect(resolveColor(ru, 12)).toMatchObject({ name: "Бирюзовый", marks: 0 });
  });

  it("после конца схемы повторяет цвета с маркировкой", () => {
    expect(resolveColor(ru, 13)).toMatchObject({ name: "Красный", marks: 1 });
    expect(resolveColor(ru, 25)).toMatchObject({ name: "Красный", marks: 2 });
  });
});

describe("конструкция кабеля", () => {
  it("модули с разным числом волокон и заполнитель нумеруются сквозно", () => {
    const modules = [
      { color: red, fibers: [red, blue] },
      { color: blue, fibers: [] }, // кордель
      { color: red, fibers: [blue, red, blue] },
    ];
    const flat = flattenFibers(modules);
    expect(totalFibers(modules)).toBe(5);
    expect(flat.map((f) => [f.number, f.module, f.position])).toEqual([
      [1, 1, 1],
      [2, 1, 2],
      [3, 3, 1],
      [4, 3, 2],
      [5, 3, 3],
    ]);
  });

  it("пресет 4×8 даёт 32 волокна с цветами отечественной схемы", () => {
    const modules = presetModules(CABLE_TYPE_PRESETS.find((p) => p.name === "ОКСН 4×8 (32)")!);
    expect(modules).toHaveLength(4);
    expect(totalFibers(modules)).toBe(32);
    expect(modules[1]!.color.name).toBe("Зелёный");
    expect(modules[0]!.fibers[2]!.name).toBe("Синий");
  });

  it("валидация отклоняет кабель без волокон и неверный цвет", () => {
    const base = { name: "X", construction: "aerial" as const };
    expect(cableTypeInputSchema.safeParse({ ...base, modules: [{ color: red, fibers: [] }] }).success).toBe(false);
    expect(
      cableTypeInputSchema.safeParse({ ...base, modules: [{ color: { name: "?", hex: "red" }, fibers: [red] }] }).success,
    ).toBe(false);
    expect(cableTypeInputSchema.safeParse({ ...base, modules: [{ color: red, fibers: [blue] }] }).success).toBe(true);
  });
});
