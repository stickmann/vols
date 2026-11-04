import { describe, expect, it } from "vitest";
import { assessBudget, connectionLoss, fiberAttenuation, splitterLoss } from "../src/index.js";

describe("оптический бюджет", () => {
  it("затухание волокна по длинам волн", () => {
    expect(fiberAttenuation(0.35, 0.22)).toEqual({ 1310: 0.35, 1490: 0.246, 1550: 0.22 });
  });
  it("потери соединений: измеренные важнее типовых", () => {
    expect(connectionLoss("fusion", null)).toBe(0.05);
    expect(connectionLoss("fusion", 0.02)).toBe(0.02);
    expect(connectionLoss("through", null)).toBe(0);
  });
  it("потери сплиттера: по выходу, номинал, типовое", () => {
    expect(splitterLoss(2, null, [1.5, 7.2], 2)).toBe(7.2);
    expect(splitterLoss(8, 10.2, null, 3)).toBe(10.2);
    expect(splitterLoss(32, null, null, 1)).toBe(17.1);
  });
  it("оценка по классу B+", () => {
    expect(assessBudget(20, "B+")).toMatchObject({ status: "ok", margin: 8 });
    expect(assessBudget(26, "B+").status).toBe("low_margin");
    expect(assessBudget(29, "B+").status).toBe("over");
    expect(assessBudget(8, "B+").status).toBe("under");
  });
});
