import type { CableTypeInput } from "@vols/shared";

export const CONSTRUCTION_LABELS: Record<CableTypeInput["construction"], string> = {
  aerial: "Подвесной",
  duct: "В канализацию",
  ground: "В грунт",
  indoor: "Внутриобъектовый",
  drop: "Дроп",
};

export const FIBER_STANDARDS = ["G.652D", "G.655", "G.657A1", "G.657A2", "G.657B3"];
