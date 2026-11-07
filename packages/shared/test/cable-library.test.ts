import { describe, expect, it } from "vitest";
import { cableLibrary, cableTypeInputSchema, flattenFibers, MANUFACTURERS, totalFibers } from "../src/index.js";

const byId = (id: string) => cableLibrary().find((i) => i.id === id)!;
const names = (xs: { name: string }[]) => xs.map((x) => x.name);

describe("библиотека марок кабелей", () => {
  it("каждая марка проходит ту же проверку, что и ручной ввод", () => {
    for (const item of cableLibrary()) {
      const r = cableTypeInputSchema.safeParse(item.input);
      expect(r.success, `${item.id}: ${r.success ? "" : r.error.message}`).toBe(true);
      expect(totalFibers(item.input.modules)).toBe(item.fibers);
      expect(flattenFibers(item.input.modules)).toHaveLength(item.fibers);
    }
  });

  it("id и названия уникальны", () => {
    const items = cableLibrary();
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(new Set(items.map((i) => i.name)).size).toBe(items.length);
  });

  it("Инкаб: синий основной, оранжевый направляющий, остальные натуральные; волокна по TIA-598", () => {
    const t = byId("incab:ДПТ:4x8");
    expect(t.name).toBe("ДПТ-П-32У (4х8)");
    expect(names(t.input.modules.map((m) => m.color))).toEqual(["Синий", "Оранжевый", "Натуральный", "Натуральный"]);
    expect(names(t.input.modules[0]!.fibers).slice(0, 3)).toEqual(["Синий", "Оранжевый", "Зелёный"]);
    // Два модуля — синий и натуральный, один — натуральный.
    expect(names(byId("incab:ДПТ:2x8").input.modules.map((m) => m.color))).toEqual(["Синий", "Натуральный"]);
    expect(byId("incab:ДПТ:1x8").input.modules[0]!.color.name).toBe("Натуральный");
  });

  it("волокна с 13-го — те же цвета с меткой", () => {
    const f = byId("incab:ДПТ:4x16").input.modules[0]!.fibers;
    expect(f[12]).toMatchObject({ name: "Синий", marks: 1 });
    expect(f[11]).toMatchObject({ name: "Бирюзовый", marks: 0 });
  });

  it("Сарансккабель-Оптика: жёлтый основной, красный направляющий", () => {
    expect(names(byId("sarko:ОКЛ:6x12").input.modules.map((m) => m.color)).slice(0, 3)).toEqual(["Жёлтый", "Красный", "Натуральный"]);
  });

  it("Москабель-Фуджикура: волокна начинаются с натурального и красного", () => {
    expect(names(byId("mkf:ОКСД:1x8").input.modules[0]!.fibers)).toEqual([
      "Натуральный", "Красный", "Синий", "Зелёный", "Жёлтый", "Фиолетовый", "Оранжевый", "Серый",
    ]);
  });

  it("у каждого производителя указан источник", () => {
    for (const m of MANUFACTURERS) expect(m.sources.length).toBeGreaterThan(0);
    for (const i of cableLibrary()) expect(i.input.notes!.length).toBeLessThanOrEqual(2000);
  });
});
