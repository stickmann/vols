import type { CableModule, Color } from "@vols/shared";
import { ColorChip } from "../../components/ColorChip.js";
import { ColorPicker } from "../../components/ColorPicker.js";
import { Button, cx } from "../../components/ui/index.js";
import { colorLabel } from "../../lib/color.js";
import { MAX_FIBERS_PER_MODULE } from "./editor-state.js";

export interface ModuleCardProps {
  module: CableModule;
  index: number;
  total: number;
  /** Номер первого волокна модуля в сквозной нумерации. */
  firstFiber: number;
  palette: { name: string; hex: string }[];
  locked: boolean;
  selected: boolean;
  onSelect: () => void;
  onColor: (c: Color) => void;
  onFiberColor: (fiber: number, c: Color) => void;
  onFiberCount: (n: number) => void;
  onRecolorFibers: () => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

export function ModuleCard(p: ModuleCardProps) {
  const count = p.module.fibers.length;
  return (
    <section
      id={`module-${p.index}`}
      onFocusCapture={p.onSelect}
      onClick={p.onSelect}
      className={cx(
        "rounded-lg border bg-white p-3 transition-shadow",
        p.selected ? "border-brand-500 shadow-[0_0_0_3px_var(--color-brand-100)]" : "border-slate-200",
      )}
      aria-label={`Модуль ${p.index + 1}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="w-6 text-right text-sm font-semibold text-slate-500 tabular-nums">{p.index + 1}</span>
          <ColorPicker value={p.module.color} palette={p.palette} onChange={p.onColor}>
            <ColorChip color={p.module.color} size={28} />
          </ColorPicker>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{colorLabel(p.module.color)}</div>
            <div className="text-xs text-slate-500">
              {count === 0 ? "заполнитель (кордель)" : `волокна ${p.firstFiber}–${p.firstFiber + count - 1}`}
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <div className="flex items-center rounded-md border border-slate-300" title="Число волокон в модуле">
            <button
              type="button"
              className="h-8 w-8 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              disabled={p.locked || count === 0}
              onClick={() => p.onFiberCount(count - 1)}
              aria-label="Убрать волокно"
            >
              −
            </button>
            <input
              type="number"
              min={0}
              max={MAX_FIBERS_PER_MODULE}
              value={count}
              disabled={p.locked}
              onChange={(e) => p.onFiberCount(Number(e.target.value))}
              className="h-8 w-12 border-x border-slate-300 text-center text-sm tabular-nums disabled:bg-slate-50"
              aria-label="Волокон в модуле"
            />
            <button
              type="button"
              className="h-8 w-8 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              disabled={p.locked || count >= MAX_FIBERS_PER_MODULE}
              onClick={() => p.onFiberCount(count + 1)}
              aria-label="Добавить волокно"
            >
              +
            </button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => p.onMove(-1)} disabled={p.locked || p.index === 0} aria-label="Модуль выше" title="Выше">
            ↑
          </Button>
          <Button size="sm" variant="ghost" onClick={() => p.onMove(1)} disabled={p.locked || p.index === p.total - 1} aria-label="Модуль ниже" title="Ниже">
            ↓
          </Button>
          <Button size="sm" variant="ghost" onClick={p.onDuplicate} disabled={p.locked} title="Копировать модуль">
            ⧉
          </Button>
          <Button size="sm" variant="ghost" onClick={p.onRemove} disabled={p.locked || p.total <= 1} aria-label="Удалить модуль" title="Удалить модуль">
            ✕
          </Button>
        </div>
      </div>

      {count > 0 && (
        <div className="mt-3 flex flex-wrap items-start gap-1.5 pl-8">
          {p.module.fibers.map((f, j) => (
            <div key={j} className="flex w-7 flex-col items-center">
              <ColorPicker value={f} palette={p.palette} onChange={(c) => p.onFiberColor(j, c)}>
                <ColorChip color={f} size={24} title={`Волокно ${p.firstFiber + j} (${j + 1} в модуле): ${colorLabel(f)}`} />
              </ColorPicker>
              <span className="mt-0.5 text-[10px] leading-none text-slate-400 tabular-nums">{j + 1}</span>
            </div>
          ))}
          <button
            type="button"
            onClick={p.onRecolorFibers}
            className="ml-1 self-center text-xs text-brand-600 hover:underline"
            title="Раскрасить волокна модуля по выбранной схеме"
          >
            по схеме
          </button>
        </div>
      )}
    </section>
  );
}
