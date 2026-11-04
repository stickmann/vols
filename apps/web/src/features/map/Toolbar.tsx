import { routeKinds, siteKinds, type RouteKind, type SiteKind } from "@vols/shared";
import { useCableTypes } from "../../api/catalog.js";
import { Button, Select, cx } from "../../components/ui/index.js";
import { ROUTE_KIND_LABELS, SITE_KIND_LABELS } from "./style.js";
import type { Mode } from "./types.js";

const MODES = [
  { kind: "select", label: "Выбор", key: "V" },
  { kind: "addSite", label: "Место", key: "P" },
  { kind: "drawRoute", label: "Трасса", key: "R" },
  { kind: "layCable", label: "Кабель", key: "C" },
] as const;

export function initialMode(kind: Mode["kind"], prev: Mode): Mode {
  const routeKind: RouteKind = "routeKind" in prev ? prev.routeKind : "aerial";
  switch (kind) {
    case "select":
      return { kind: "select" };
    case "addSite":
      return { kind: "addSite", siteKind: "pole", chain: true, routeKind, lastSiteId: null, lastSitePos: null };
    case "drawRoute":
      return { kind: "drawRoute", routeKind, fromSiteId: null, fromPos: null, vertices: [] };
    case "layCable":
      return { kind: "layCable", cableTypeId: prev.kind === "layCable" ? prev.cableTypeId : null, siteIds: [], routeIds: [], history: [] };
  }
}

export function Toolbar({
  mode,
  setMode,
  layLengthM,
  onFinishCable,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  layLengthM: number;
  onFinishCable: () => void;
}) {
  const types = useCableTypes();

  return (
    <div className="pointer-events-auto flex max-w-[calc(100vw-2rem)] flex-col items-start gap-2">
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm" role="toolbar" aria-label="Режим">
        {MODES.map((m) => (
          <button
            key={m.kind}
            type="button"
            onClick={() => setMode(initialMode(m.kind, mode))}
            aria-pressed={mode.kind === m.kind}
            title={`${m.label} (${m.key})`}
            className={cx(
              "rounded-md px-2.5 py-1.5 text-sm font-medium sm:px-3",
              mode.kind === m.kind ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode.kind === "addSite" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <Select
            value={mode.siteKind}
            onChange={(e) => setMode({ ...mode, siteKind: e.target.value as SiteKind })}
            className="h-8 w-auto!"
            aria-label="Вид места"
          >
            {siteKinds.map((k) => (
              <option key={k} value={k}>
                {SITE_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={mode.chain} onChange={(e) => setMode({ ...mode, chain: e.target.checked, lastSiteId: null, lastSitePos: null })} />
            соединять трассой
          </label>
          {mode.chain && (
            <RouteKindSelect value={mode.routeKind} onChange={(routeKind) => setMode({ ...mode, routeKind })} />
          )}
        </div>
      )}

      {mode.kind === "drawRoute" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <RouteKindSelect value={mode.routeKind} onChange={(routeKind) => setMode({ ...mode, routeKind })} />
          {mode.fromSiteId && (
            <Button size="sm" variant="ghost" onClick={() => setMode({ ...mode, fromSiteId: null, fromPos: null, vertices: [] })}>
              Прервать
            </Button>
          )}
        </div>
      )}

      {mode.kind === "layCable" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <Select
            value={mode.cableTypeId ?? ""}
            onChange={(e) => setMode({ ...mode, cableTypeId: e.target.value || null })}
            className="h-8 w-auto! max-w-56"
            aria-label="Тип кабеля"
          >
            <option value="">— тип кабеля —</option>
            {types.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          {mode.siteIds.length > 0 && (
            <span className="text-sm text-slate-600 tabular-nums">
              {mode.siteIds.length} точ. · {Math.round(layLengthM)} м
            </span>
          )}
          {mode.siteIds.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setMode({ ...mode, siteIds: [], routeIds: [], history: [] })}>
              Сбросить
            </Button>
          )}
          <Button size="sm" variant="primary" disabled={mode.siteIds.length < 2 || !mode.cableTypeId} onClick={onFinishCable}>
            Готово
          </Button>
        </div>
      )}
    </div>
  );
}

function RouteKindSelect({ value, onChange }: { value: RouteKind; onChange: (k: RouteKind) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as RouteKind)} className="h-8 w-auto!" aria-label="Вид трассы">
      {routeKinds.map((k) => (
        <option key={k} value={k}>
          {ROUTE_KIND_LABELS[k]}
        </option>
      ))}
    </Select>
  );
}

export function modeHint(mode: Mode): string {
  switch (mode.kind) {
    case "select":
      return "Кликните объект, чтобы открыть его. Выбранное место можно перетащить.";
    case "addSite":
      return mode.chain
        ? mode.lastSiteId
          ? "Кликайте дальше — новые места соединятся трассой. Клик по существующему месту продолжит цепочку от него. Esc — завершить цепочку."
          : "Кликните на карте, чтобы поставить место, или по существующему месту, чтобы начать цепочку от него."
        : "Кликните на карте, чтобы поставить место.";
    case "drawRoute":
      return mode.fromSiteId
        ? "Кликайте, чтобы добавить изгибы, и кликните по месту, чтобы закончить участок. Backspace — убрать изгиб, Esc — прервать."
        : "Кликните по месту, от которого начинается трасса.";
    case "layCable":
      if (!mode.cableTypeId) return "Выберите тип кабеля.";
      return mode.siteIds.length
        ? "Кликайте по местам — путь строится по трассам автоматически. Backspace — шаг назад, Enter — готово."
        : "Кликните по месту, где начинается кабель.";
  }
}
