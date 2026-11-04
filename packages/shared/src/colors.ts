/** Цвет в схеме маркировки модулей/волокон. */
export interface FiberColor {
  name: string;
  hex: string;
}

/** Цвет конкретного волокна/модуля с учётом кольцевой маркировки при номере > размера схемы. */
export interface ResolvedColor extends FiberColor {
  /** 0 — без маркировки, 1 — одно кольцо/штрих, 2 — два и т.д. */
  marks: number;
}

/**
 * Цвет по позиции (с 1). Если позиций больше, чем цветов в схеме,
 * цвета повторяются с добавлением маркировки: 13-е волокно в 12-цветной
 * схеме — первый цвет с одной меткой.
 */
export function resolveColor(scheme: readonly FiberColor[], position: number): ResolvedColor {
  if (scheme.length === 0) throw new Error("Пустая цветовая схема");
  if (!Number.isInteger(position) || position < 1) throw new Error(`Некорректная позиция: ${position}`);
  const idx = (position - 1) % scheme.length;
  const base = scheme[idx]!;
  return { ...base, marks: Math.floor((position - 1) / scheme.length) };
}
