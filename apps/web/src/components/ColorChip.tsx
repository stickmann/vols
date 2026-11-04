import { contrastOn, colorLabel } from "../lib/color.js";

/**
 * Кружок цвета волокна/модуля. Маркировка (кольца/штрихи) — поперечные полосы.
 */
export function ColorChip({
  color,
  size = 18,
  title,
  selected,
}: {
  color: { name: string; hex: string; marks?: number };
  size?: number;
  title?: string;
  selected?: boolean;
}) {
  const marks = color.marks ?? 0;
  const ink = contrastOn(color.hex);
  const r = size / 2;
  const step = size / (marks + 1);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={title ?? colorLabel({ name: color.name, marks })}
      className="shrink-0"
    >
      <title>{title ?? colorLabel({ name: color.name, marks })}</title>
      <circle cx={r} cy={r} r={r - 1} fill={color.hex} stroke={selected ? "#1f66db" : "#94a3b8"} strokeWidth={selected ? 2 : 1} />
      {Array.from({ length: marks }, (_, i) => {
        const x = step * (i + 1);
        return <line key={i} x1={x} y1={size * 0.2} x2={x} y2={size * 0.8} stroke={ink} strokeWidth={Math.max(1.5, size / 10)} />;
      })}
    </svg>
  );
}
