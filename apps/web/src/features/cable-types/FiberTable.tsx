import { flattenFibers, type CableModule } from "@vols/shared";
import { ColorChip } from "../../components/ColorChip.js";
import { colorLabel } from "../../lib/color.js";

/** Сквозная раскладка: № волокна → модуль, позиция, цвета. */
export function FiberTable({ modules }: { modules: CableModule[] }) {
  const rows = flattenFibers(modules);
  return (
    <div className="max-h-96 overflow-auto rounded-md border border-slate-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-2 py-1.5 font-medium">№</th>
            <th className="px-2 py-1.5 font-medium">Модуль</th>
            <th className="px-2 py-1.5 font-medium">Волокно</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const m = modules[f.module - 1]!;
            return (
              <tr key={f.number} className="border-t border-slate-100">
                <td className="px-2 py-1 font-medium tabular-nums">{f.number}</td>
                <td className="px-2 py-1">
                  <span className="flex items-center gap-1.5">
                    <ColorChip color={m.color} size={14} />
                    <span className="tabular-nums">{f.module}</span>
                    <span className="truncate text-slate-500">{colorLabel(m.color)}</span>
                  </span>
                </td>
                <td className="px-2 py-1">
                  <span className="flex items-center gap-1.5">
                    <ColorChip color={f.color} size={14} />
                    <span className="tabular-nums">{f.position}</span>
                    <span className="truncate text-slate-500">{colorLabel(f.color)}</span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
