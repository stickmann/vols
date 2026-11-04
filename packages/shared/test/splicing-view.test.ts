import { describe, expect, it } from "vitest";
import { compressRanges, planPairs, sequences, splicingStats as stats, terminalIndex, type SplicingData } from "../src/index.js";

const color = (name: string) => ({ name, hex: "#000000", marks: 0 });
const fibers = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    terminalId: `${prefix}${i + 1}`,
    fiberId: `f${prefix}${i + 1}`,
    number: i + 1,
    module: 1,
    position: i + 1,
    condition: "ok" as const,
    color: color(`цвет ${i + 1}`),
    moduleColor: color("Красный"),
  }));

const data: SplicingData = {
  equipment: { id: "e", kind: "closure", name: "М-1", status: "built", modelName: "МТОК", maxSplices: 96, siteId: "s", siteName: "Оп. 2", siteKind: "pole" },
  cables: [
    { spanId: "in", cableId: "c1", name: "Магистраль", typeName: "ОКСН 1×8", side: "b", otherSiteName: "УС", otherSiteKind: "pop", fibers: fibers("i", 8) },
    { spanId: "out", cableId: "c2", name: null, typeName: "ОКСН 1×4", side: "a", otherSiteName: null, otherSiteKind: "pole", fibers: fibers("o", 4) },
  ],
  devices: [
    { id: "e", kind: "closure", name: "М-1", modelName: "МТОК", insertionLossDb: null, ports: null },
    {
      id: "sp",
      kind: "splitter",
      name: null,
      modelName: "PLC 1:4",
      insertionLossDb: 7.3,
      ports: [
        { terminalId: "spin", role: "in", no: 1, face: null },
        ...[1, 2, 3, 4].map((no) => ({ terminalId: `spo${no}`, role: "out" as const, no, face: null })),
      ],
    },
  ],
  connections: [
    { id: "x", kind: "fusion", aTerminalId: "i1", bTerminalId: "spin", lossDb: null, trayNo: 1, slotNo: 1, notes: null },
    { id: "y", kind: "through", aTerminalId: "i2", bTerminalId: "o2", lossDb: null, trayNo: null, slotNo: null, notes: null },
  ],
  candidates: [],
};

describe("модель разварки", () => {
  it("подписывает волокна и порты", () => {
    const idx = terminalIndex(data);
    expect(idx.get("i5")!.label).toBe("Магистраль · вол. 5 (цвет 5)");
    expect(idx.get("o1")!.short).toBe("ОКСН 1×4 · 1");
    expect(idx.get("spo3")!.label).toBe("Сплиттер 1:4 выход 3");
  });

  it("строит пары по порядку и отмечает занятые", () => {
    const seq = sequences(data);
    const outs = seq.find((s) => s.id === "out:sp")!;
    const dist = seq.find((s) => s.id === "cable:out")!;
    const busy = new Set(["i1", "spin", "i2", "o2"]);
    const pairs = planPairs(outs, 1, dist, 1, 10, busy);
    expect(pairs).toHaveLength(4); // упёрлись в длину кабеля
    expect(pairs.map((p) => [p.a.id, p.b.id, p.busy])).toEqual([
      ["spo1", "o1", false],
      ["spo2", "o2", true],
      ["spo3", "o3", false],
      ["spo4", "o4", false],
    ]);
  });

  it("считает сводку", () => {
    expect(stats(data)).toEqual({ splices: 1, patches: 0, through: 1, freeFibers: 9, totalFibers: 12 });
  });
});

describe("compressRanges", () => {
  it("сворачивает номера в диапазоны", () => expect(compressRanges([3, 1, 2, 5, 7, 8, 9])).toBe("1–3, 5, 7–9"));
});
