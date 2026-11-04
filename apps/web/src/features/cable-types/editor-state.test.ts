import { COLOR_SCHEME_PRESETS } from "@vols/shared";
import { describe, expect, it } from "vitest";
import { describeConstruction, draftToInput, newDraft, reducer, type Draft } from "./editor-state.js";

const ru = COLOR_SCHEME_PRESETS.find((s) => s.key === "ru")!.colors;
const tia = COLOR_SCHEME_PRESETS.find((s) => s.key === "tia598")!.colors;
const yellow = { name: "Жёлтый", hex: "#f2d024", marks: 0 };

const base = (): Draft => newDraft(ru);

describe("редактор конструкции кабеля", () => {
  it("новый черновик — один модуль на 8 волокон", () => {
    const d = base();
    expect(d.modules).toHaveLength(1);
    expect(d.modules[0]!.fibers).toHaveLength(8);
  });

  it("шаблон пересобирает модули", () => {
    const d = reducer(base(), { type: "template", modulesCount: 4, fibersPerModule: 12, moduleColors: ru, fiberColors: tia });
    expect(d.modules).toHaveLength(4);
    expect(d.modules[1]!.color.name).toBe("Зелёный");
    expect(d.modules[0]!.fibers[0]!.name).toBe("Синий");
    expect(d.modules.every((m) => m.fibers.length === 12)).toBe(true);
  });

  it("добавленный модуль получает следующий цвет схемы", () => {
    const d = reducer(base(), { type: "addModule", fibers: 4, moduleColors: ru, fiberColors: ru });
    expect(d.modules[1]!.color.name).toBe("Зелёный");
    expect(d.modules[1]!.fibers).toHaveLength(4);
  });

  it("изменение числа волокон дописывает цвета по схеме и обрезает лишние", () => {
    let d = reducer(base(), { type: "fiberColor", module: 0, fiber: 0, color: yellow });
    d = reducer(d, { type: "fiberCount", index: 0, count: 14, fiberColors: ru });
    expect(d.modules[0]!.fibers).toHaveLength(14);
    expect(d.modules[0]!.fibers[0]).toEqual(yellow); // ручной цвет сохранился
    expect(d.modules[0]!.fibers[12]).toMatchObject({ name: "Красный", marks: 1 });
    d = reducer(d, { type: "fiberCount", index: 0, count: 0, fiberColors: ru });
    expect(d.modules[0]!.fibers).toHaveLength(0);
  });

  it("перемещение, копирование и удаление модулей", () => {
    let d = reducer(base(), { type: "addModule", fibers: 2, moduleColors: ru, fiberColors: ru });
    d = reducer(d, { type: "moveModule", index: 1, delta: -1 });
    expect(d.modules.map((m) => m.fibers.length)).toEqual([2, 8]);
    d = reducer(d, { type: "duplicateModule", index: 0 });
    expect(d.modules.map((m) => m.fibers.length)).toEqual([2, 2, 8]);
    d = reducer(d, { type: "removeModule", index: 2 });
    expect(d.modules.map((m) => m.fibers.length)).toEqual([2, 2]);
  });

  it("последний модуль удалить нельзя", () => {
    const d = base();
    expect(reducer(d, { type: "removeModule", index: 0 })).toBe(d);
  });

  it("в API уходят null вместо пустых строк", () => {
    const d = { ...base(), name: "  Кабель ", fiberStandard: "", notes: " " };
    expect(draftToInput(d)).toMatchObject({ name: "Кабель", fiberStandard: null, notes: null });
  });
});

describe("describeConstruction", () => {
  it("одинаковые модули", () => expect(describeConstruction([{ fiberCount: 8 }, { fiberCount: 8 }])).toBe("2×8"));
  it("разные модули и заполнитель", () =>
    expect(describeConstruction([{ fiberCount: 8 }, { fiberCount: 0 }, { fiberCount: 4 }])).toBe("8+4 + 1 заполнитель"));
});
