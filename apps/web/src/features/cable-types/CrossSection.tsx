import type { CableModule } from "@vols/shared";

interface Pt {
  x: number;
  y: number;
}

const ring = (n: number, radius: number, c: Pt, phase = -Math.PI / 2): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const a = phase + (2 * Math.PI * i) / n;
    return { x: c.x + radius * Math.cos(a), y: c.y + radius * Math.sin(a) };
  });

/** Раскладка модулей в сечении: один — по центру, несколько — по кругу вокруг ЦСЭ. */
function moduleLayout(n: number, inner: number) {
  if (n === 1) return { centers: [{ x: 100, y: 100 }], r: inner * 0.62, core: 0 };
  const s = Math.sin(Math.PI / n) * 0.94;
  const r = (inner * s) / (1 + s);
  const ringR = inner - r;
  return { centers: ring(n, ringR, { x: 100, y: 100 }), r, core: Math.min(Math.max(0, ringR - r - 3), r * 0.55) };
}

/** Раскладка волокон в модуле: до 12 — одно кольцо, больше — два. */
function fiberLayout(k: number, c: Pt, rm: number) {
  if (k === 0) return { pts: [] as Pt[], r: 0 };
  if (k === 1) return { pts: [c], r: rm * 0.35 };
  if (k <= 12) {
    const rr = rm * 0.56;
    return { pts: ring(k, rr, c), r: Math.min(rr * Math.sin(Math.PI / k) * 0.85, rm * 0.3) };
  }
  const innerN = Math.max(3, Math.floor(k / 3));
  const outerN = k - innerN;
  const ro = rm * 0.68;
  const ri = rm * 0.32;
  const r = Math.min(ro * Math.sin(Math.PI / outerN) * 0.85, ri * Math.sin(Math.PI / innerN) * 0.9, rm * 0.2);
  return { pts: [...ring(outerN, ro, c), ...ring(innerN, ri, c)], r };
}

/**
 * Условное сечение кабеля: модули своих цветов, внутри — волокна.
 * Клик по модулю выделяет его в списке.
 */
export function CrossSection({
  modules,
  selected,
  onSelect,
}: {
  modules: CableModule[];
  selected?: number | null;
  onSelect?: (index: number) => void;
}) {
  const outer = 94;
  const { centers, r: rm, core } = moduleLayout(Math.max(1, modules.length), outer - 8);

  return (
    <svg viewBox="0 0 200 200" className="h-auto w-full max-w-[220px] sm:max-w-[300px]" role="img" aria-label="Сечение кабеля">
      <circle cx={100} cy={100} r={outer} fill="#1f2937" />
      <circle cx={100} cy={100} r={outer - 5} fill="#f1f5f9" />
      {core > 2 && <circle cx={100} cy={100} r={core} fill="#94a3b8" stroke="#64748b" />}
      {modules.map((m, i) => {
        const c = centers[i]!;
        const isFiller = m.fibers.length === 0;
        const { pts, r: rf } = fiberLayout(m.fibers.length, c, rm);
        const isSel = selected === i;
        return (
          <g
            key={i}
            onClick={() => onSelect?.(i)}
            className={onSelect ? "cursor-pointer" : undefined}
            role={onSelect ? "button" : undefined}
            aria-label={`Модуль ${i + 1}: ${m.color.name}, волокон ${m.fibers.length}`}
          >
            <title>{`Модуль ${i + 1}: ${m.color.name}${isFiller ? " (заполнитель)" : `, волокон: ${m.fibers.length}`}`}</title>
            {isSel && <circle cx={c.x} cy={c.y} r={rm + 3.5} fill="none" stroke="#1f66db" strokeWidth={2.5} />}
            <circle
              cx={c.x}
              cy={c.y}
              r={rm}
              fill={isFiller ? m.color.hex : "#ffffff"}
              stroke={m.color.hex}
              strokeWidth={isFiller ? 1 : Math.max(2, rm * 0.16)}
            />
            {isFiller && <circle cx={c.x} cy={c.y} r={rm} fill="none" stroke="#64748b" strokeWidth={0.75} />}
            {pts.map((p, j) => (
              <circle key={j} cx={p.x} cy={p.y} r={rf} fill={m.fibers[j]!.hex} stroke="#475569" strokeWidth={0.6} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
