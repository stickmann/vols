import { useCan } from "../auth/api.js";
import type { LngLat } from "@vols/shared";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useSearchParams } from "react-router";
import { useCableTypes } from "../../api/catalog.js";
import { Alert, cx } from "../../components/ui/index.js";
import { findPath, useCreateRoute, useCreateSite, useNetwork, useUpdateSite } from "./api.js";
import { LayCableDialog } from "./LayCableDialog.js";
import { MapView, type LayerVisibility, type MapHit } from "./MapView.js";
import { CablePanel, RoutePanel, SitePanel } from "./panels/Panels.js";
import { TracePanel, type TraceView } from "./panels/TracePanel.js";
import { basemaps, ROUTE_KIND_LABELS, SITE_KIND_LABELS } from "./style.js";
import { initialMode, modeHint, Toolbar } from "./Toolbar.js";
import type { Mode, Network, Selection } from "./types.js";

const EMPTY: FeatureCollection<Geometry> = {
  type: "FeatureCollection",
  features: [],
};
const fc = (features: Feature<Geometry>[]): FeatureCollection<Geometry> => ({
  type: "FeatureCollection",
  features,
});

type Candidate = { type: "route" | "cable"; id: string; label: string };

export function MapPage() {
  const canEdit = useCan("designer");
  const net = useNetwork();
  const cableTypes = useCableTypes();
  const createSite = useCreateSite();
  const updateSite = useUpdateSite();
  const createRoute = useCreateRoute();

  const allBasemaps = useMemo(basemaps, []);
  const [basemapId, setBasemapId] = useState(allBasemaps[0]!.id);
  const basemap = allBasemaps.find((b) => b.id === basemapId) ?? allBasemaps[0]!;
  const [layers, setLayers] = useState<LayerVisibility>({
    sites: true,
    routes: true,
    cables: true,
  });
  const [mode, setModeRaw] = useState<Mode>({ kind: "select" });
  // Актуальный режим для обработчиков, которые ждут ответа сервера.
  const modeRef = useRef(mode);
  const setMode = useCallback((m: Mode) => {
    if (modeRef.current.kind !== m.kind && m.kind !== "select") setSelection(null);
    modeRef.current = m;
    setModeRaw(m);
  }, []);
  // Клики обрабатываются строго по очереди: следующий видит результат предыдущего.
  const clickQueue = useRef<Promise<void>>(Promise.resolve());
  // ?site=<id> — открыть карту с выбранным местом (например, при возврате из разварки).
  const [search] = useSearchParams();
  const [selection, setSelection] = useState<Selection>(() => {
    const site = search.get("site");
    const trace = search.get("trace");
    return trace ? { type: "trace", id: trace } : site ? { type: "site", id: site } : null;
  });
  const [traceView, setTraceView] = useState<TraceView | null>(null);
  const [focus, setFocus] = useState<{ at: LngLat } | null>(null);
  const [chooser, setChooser] = useState<{
    x: number;
    y: number;
    items: Candidate[];
  } | null>(null);
  const [cursorAt, setCursorAt] = useState<LngLat | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [layDialog, setLayDialog] = useState(false);
  const tooltip = useRef<TooltipHandle>(null);

  const sitePos = useMemo(() => {
    const m = new Map<string, LngLat>();
    for (const f of net.data?.sites.features ?? []) m.set(f.properties.id, f.geometry.coordinates as LngLat);
    return m;
  }, [net.data]);

  const flash = useCallback((text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage((m) => (m === text ? null : m)), 4000);
  }, []);
  const fail = useCallback((e: unknown) => flash(e instanceof Error ? e.message : String(e)), [flash]);

  // ------------------------------------------------------------ клики по карте

  const onClick = (hit: MapHit) => {
    clickQueue.current = clickQueue.current.then(() => handleClick(hit)).catch(fail);
  };

  const handleClick = async (hit: MapHit) => {
    setChooser(null);
    tooltip.current?.show(null, undefined);
    const mode = modeRef.current;
    const site = hit.sites[0];
    const posOf = (id: string) => sitePos.get(id) ?? (site?.id === id ? hit.lngLat : undefined);

    if (mode.kind === "select") {
      if (site) return setSelection({ type: "site", id: site.id });
      const items: Candidate[] = [
        ...hit.routes.map((r) => ({
          type: "route" as const,
          id: r.id,
          label: `Трасса: ${r.name || ROUTE_KIND_LABELS[r.kind]} · ${Math.round(r.lengthM)} м`,
        })),
        ...uniqueBy(hit.cables, (c) => c.cableId).map((c) => ({
          type: "cable" as const,
          id: c.cableId,
          label: `Кабель: ${c.name || c.typeName}`,
        })),
      ];
      if (items.length === 0) return setSelection(null);
      if (items.length === 1) return setSelection({ type: items[0]!.type, id: items[0]!.id });
      return setChooser({ x: hit.point.x, y: hit.point.y, items });
    }

    if (mode.kind === "addSite") {
      // В режимах рисования панель не открываем: она сужает карту и мешает ставить точки подряд.
      if (site)
        return setMode({
          ...mode,
          lastSiteId: mode.chain ? site.id : null,
          lastSitePos: mode.chain ? (posOf(site.id) ?? null) : null,
        });
      try {
        const { id } = await createSite.mutateAsync({
          kind: mode.siteKind,
          position: hit.lngLat,
          status: "planned",
        });
        const prev = mode.lastSitePos;
        if (mode.chain && mode.lastSiteId && prev) {
          await createRoute.mutateAsync({
            kind: mode.routeKind,
            fromSiteId: mode.lastSiteId,
            toSiteId: id,
            coordinates: [prev, hit.lngLat],
            status: "planned",
          });
        }
        setMode({
          ...mode,
          lastSiteId: mode.chain ? id : null,
          lastSitePos: mode.chain ? hit.lngLat : null,
        });
      } catch (e) {
        fail(e);
      }
      return;
    }

    if (mode.kind === "drawRoute") {
      if (!mode.fromSiteId) {
        if (!site) return flash("Трасса начинается от места — кликните по точке на карте.");
        return setMode({
          ...mode,
          fromSiteId: site.id,
          fromPos: posOf(site.id) ?? hit.lngLat,
          vertices: [],
        });
      }
      if (site) {
        if (site.id === mode.fromSiteId) return flash("Трасса должна закончиться в другом месте.");
        try {
          await createRoute.mutateAsync({
            kind: mode.routeKind,
            fromSiteId: mode.fromSiteId,
            toSiteId: site.id,
            coordinates: [mode.fromPos ?? sitePos.get(mode.fromSiteId)!, ...mode.vertices, posOf(site.id) ?? hit.lngLat],
            status: "planned",
          });
          // Продолжаем рисовать от конечного места.
          setMode({
            ...mode,
            fromSiteId: site.id,
            fromPos: posOf(site.id) ?? hit.lngLat,
            vertices: [],
          });
        } catch (e) {
          fail(e);
        }
        return;
      }
      return setMode({ ...mode, vertices: [...mode.vertices, hit.lngLat] });
    }

    if (mode.kind === "layCable") {
      if (!mode.cableTypeId) return flash("Сначала выберите тип кабеля на панели слева сверху.");
      if (!site) return flash("Кабель прокладывается от места к месту — кликните по точке.");
      const last = mode.siteIds[mode.siteIds.length - 1];
      if (!last)
        return setMode({
          ...mode,
          siteIds: [site.id],
          history: [{ sites: 0, routes: 0 }],
        });
      if (last === site.id) return;
      try {
        const path = await findPath(last, site.id);
        setMode({
          ...mode,
          siteIds: [...mode.siteIds, ...path.siteIds.slice(1)],
          routeIds: [...mode.routeIds, ...path.routeIds],
          history: [...mode.history, { sites: mode.siteIds.length, routes: mode.routeIds.length }],
        });
      } catch (e) {
        fail(e);
      }
    }
  };

  // ------------------------------------------------------------ клавиатура

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], dialog")) return;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") {
        setChooser(null);
        if (mode.kind === "drawRoute" && mode.fromSiteId)
          return setMode({
            ...mode,
            fromSiteId: null,
            fromPos: null,
            vertices: [],
          });
        if (mode.kind === "addSite" && mode.lastSiteId) return setMode({ ...mode, lastSiteId: null, lastSitePos: null });
        if (mode.kind === "layCable" && mode.siteIds.length) return setMode({ ...mode, siteIds: [], routeIds: [], history: [] });
        if (mode.kind !== "select") return setMode({ kind: "select" });
        return setSelection(null);
      }
      if (e.key === "Backspace" || ((e.ctrlKey || e.metaKey) && k === "z")) {
        if (mode.kind === "drawRoute" && mode.vertices.length) {
          e.preventDefault();
          return setMode({ ...mode, vertices: mode.vertices.slice(0, -1) });
        }
        if (mode.kind === "layCable" && mode.history.length) {
          e.preventDefault();
          const h = mode.history[mode.history.length - 1]!;
          return setMode({
            ...mode,
            siteIds: h.sites === 0 ? [] : mode.siteIds.slice(0, h.sites),
            routeIds: mode.routeIds.slice(0, h.routes),
            history: mode.history.slice(0, -1),
          });
        }
      }
      if (e.key === "Enter" && mode.kind === "layCable" && mode.siteIds.length >= 2 && mode.cableTypeId)
        return setLayDialog(true);
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const byKey: Record<string, Mode["kind"]> = {
        v: "select",
        p: "addSite",
        r: "drawRoute",
        c: "layCable",
      };
      if (byKey[k] && byKey[k] !== mode.kind) setMode(initialMode(byKey[k], mode));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  // ------------------------------------------------------------ подсветка и черновик

  const routeById = useMemo(() => new Map((net.data?.routes.features ?? []).map((f) => [f.properties.id, f])), [net.data]);

  const highlight = useMemo(() => {
    const n = net.data;
    if (!n) return EMPTY;
    if (mode.kind === "layCable") return fc(mode.routeIds.map((id) => routeById.get(id)).filter(Boolean) as Feature<Geometry>[]);
    if (selection?.type === "route") return fc(n.routes.features.filter((f) => f.properties.id === selection.id));
    if (selection?.type === "cable") return fc(n.cables.features.filter((f) => f.properties.cableId === selection.id));
    if (selection?.type === "trace" && traceView)
      return fc(n.cables.features.filter((f) => traceView.spanIds.has(f.properties.id)));
    return EMPTY;
  }, [net.data, selection, mode, routeById, traceView]);

  const draft = useMemo(() => {
    const pts = (ids: string[]) =>
      ids
        .map((id) => sitePos.get(id))
        .filter(Boolean)
        .map(
          (c) =>
            ({
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: c },
            }) as Feature<Geometry>,
        );
    if (mode.kind === "drawRoute" && mode.fromSiteId) {
      const start = mode.fromPos ?? sitePos.get(mode.fromSiteId);
      if (!start) return EMPTY;
      const coords = [start, ...mode.vertices, ...(cursorAt ? [cursorAt] : [])];
      return fc([
        ...(coords.length > 1
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: coords },
              } as Feature<Geometry>,
            ]
          : []),
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: start },
        } as Feature<Geometry>,
        ...mode.vertices.map(
          (c) =>
            ({
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: c },
            }) as Feature<Geometry>,
        ),
      ]);
    }
    if (mode.kind === "addSite" && mode.chain && mode.lastSiteId) {
      const start = mode.lastSitePos;
      if (!start) return EMPTY;
      return fc([
        ...(cursorAt
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: [start, cursorAt],
                },
              } as Feature<Geometry>,
            ]
          : []),
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: start },
        } as Feature<Geometry>,
      ]);
    }
    if (mode.kind === "layCable") return fc(pts(mode.siteIds));
    if (selection?.type === "trace" && traceView) return fc(pts([...new Set(traceView.endSiteIds)]));
    return EMPTY;
  }, [mode, sitePos, cursorAt, selection, traceView]);

  const layLength =
    mode.kind === "layCable" ? mode.routeIds.reduce((s, id) => s + (routeById.get(id)?.properties.lengthM ?? 0), 0) : 0;
  const wantsRubberBand =
    (mode.kind === "drawRoute" && !!mode.fromSiteId) || (mode.kind === "addSite" && mode.chain && !!mode.lastSiteId);

  const onHover = (hit: MapHit | null) => {
    tooltip.current?.show(hit, net.data);
    if (wantsRubberBand) setCursorAt(hit?.lngLat ?? null);
  };

  const cursor =
    mode.kind === "select"
      ? ""
      : mode.kind === "addSite"
        ? "crosshair"
        : mode.kind === "drawRoute" && mode.fromSiteId
          ? "crosshair"
          : "pointer";

  const closePanel = () => setSelection(null);
  const typeName = cableTypes.data?.find((t) => mode.kind === "layCable" && t.id === mode.cableTypeId)?.name ?? "";
  const empty = net.data && net.data.sites.features.length === 0;

  return (
    <div className="relative flex h-full flex-col md:flex-row">
      <div className="relative min-h-0 flex-1">
        <MapView
          network={net.data}
          basemap={basemap}
          layers={layers}
          selectedSiteId={selection?.type === "site" ? selection.id : null}
          highlight={highlight}
          draft={draft}
          cursor={cursor}
          draggableSiteId={canEdit && mode.kind === "select" && selection?.type === "site" ? selection.id : null}
          marker={selection?.type === "trace" ? (traceView?.marker ?? null) : null}
          focus={focus}
          onClick={onClick}
          onHover={onHover}
          onSiteDragEnd={(id, to) => updateSite.mutate({ id, position: to }, { onError: fail })}
        />

        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-3">
          {canEdit ? (
            <Toolbar mode={mode} setMode={setMode} layLengthM={layLength} onFinishCable={() => setLayDialog(true)} />
          ) : (
            <div />
          )}
          <LayersControl
            layers={layers}
            setLayers={setLayers}
            basemaps={allBasemaps}
            basemapId={basemapId}
            setBasemapId={setBasemapId}
          />
        </div>

        <div className="pointer-events-none absolute bottom-10 left-3 right-14 flex flex-col items-center gap-2 md:right-16 md:left-16">
          {message && (
            <div className="pointer-events-auto max-w-md" role="status">
              <Alert tone="warning">{message}</Alert>
            </div>
          )}
          {net.isError && (
            <div className="pointer-events-auto max-w-md">
              <Alert>Не удалось загрузить сеть: {net.error.message}</Alert>
            </div>
          )}
          {empty && mode.kind === "select" && (
            <div className="pointer-events-auto max-w-md">
              <Alert tone="info">Сеть пуста. Выберите режим «Место» и кликните по карте, чтобы поставить первую точку.</Alert>
            </div>
          )}
          <div className="max-w-xl rounded-2xl bg-slate-900/80 px-3 py-1.5 text-center text-[11px] text-white shadow sm:px-4 sm:text-xs">
            {modeHint(mode)}
          </div>
        </div>

        {chooser && (
          <div
            className="absolute z-10 w-72 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            style={{
              left: Math.min(chooser.x + 8, window.innerWidth - 300),
              top: chooser.y + 8,
            }}
            role="menu"
            aria-label="Что выбрать"
          >
            {chooser.items.map((c) => (
              <button
                key={c.type + c.id}
                role="menuitem"
                className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-slate-100"
                onClick={() => {
                  setSelection({ type: c.type, id: c.id });
                  setChooser(null);
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        <Tooltip ref={tooltip} />
      </div>

      {selection && (
        <aside
          className="z-10 max-h-[55vh] shrink-0 border-t border-slate-200 bg-white md:max-h-none md:w-96 md:border-t-0 md:border-l"
          aria-label="Свойства объекта"
        >
          {selection.type === "site" && (
            <SitePanel key={selection.id} id={selection.id} onClose={closePanel} onSelect={setSelection} />
          )}
          {selection.type === "route" && (
            <RoutePanel key={selection.id} id={selection.id} onClose={closePanel} onSelect={setSelection} />
          )}
          {selection.type === "cable" && (
            <CablePanel key={selection.id} id={selection.id} onClose={closePanel} onSelect={setSelection} />
          )}
          {selection.type === "trace" && (
            <TracePanel
              key={selection.id}
              terminalId={selection.id}
              onClose={() => (closePanel(), setTraceView(null))}
              onView={setTraceView}
              onFocus={(at) => setFocus({ at })}
            />
          )}
        </aside>
      )}

      {mode.kind === "layCable" && mode.cableTypeId && (
        <LayCableDialog
          open={layDialog}
          onClose={() => setLayDialog(false)}
          cableTypeId={mode.cableTypeId}
          typeName={typeName}
          siteIds={mode.siteIds}
          lengthM={layLength}
          onCreated={(id) => {
            setLayDialog(false);
            setMode({ kind: "select" });
            setSelection({ type: "cable", id });
          }}
        />
      )}
    </div>
  );
}

function uniqueBy<T>(arr: T[], key: (x: T) => string): T[] {
  return [...new Map(arr.map((x) => [key(x), x])).values()];
}

function LayersControl({
  layers,
  setLayers,
  basemaps: list,
  basemapId,
  setBasemapId,
}: {
  layers: LayerVisibility;
  setLayers: (l: LayerVisibility) => void;
  basemaps: { id: string; label: string }[];
  basemapId: string;
  setBasemapId: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pointer-events-auto relative">
      <button
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-slate-50"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        Слои
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 space-y-3 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg">
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-500 uppercase">Подложка</div>
            {list.map((b) => (
              <label key={b.id} className="flex items-center gap-2 py-0.5">
                <input type="radio" name="basemap" checked={b.id === basemapId} onChange={() => setBasemapId(b.id)} />
                {b.label}
              </label>
            ))}
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-500 uppercase">Объекты</div>
            {(
              [
                ["sites", "Места"],
                ["routes", "Трассы"],
                ["cables", "Кабели"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ подсказка при наведении

interface TooltipHandle {
  show: (hit: MapHit | null, net: Network | undefined) => void;
}

/** Подсказка живёт своим состоянием, чтобы движение мыши не перерисовывало страницу. */
function Tooltip({ ref }: { ref: RefObject<TooltipHandle | null> }) {
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    text: string;
    sub?: string;
  } | null>(null);
  ref.current = {
    show: (hit) => {
      if (!hit) return setTip(null);
      const s = hit.sites[0];
      const r = hit.routes[0];
      const c = hit.cables[0];
      if (s)
        return setTip({
          x: hit.point.x,
          y: hit.point.y,
          text: s.name || SITE_KIND_LABELS[s.kind],
          sub: s.name ? SITE_KIND_LABELS[s.kind] : undefined,
        });
      if (r || c) {
        const parts = [
          r && `${ROUTE_KIND_LABELS[r.kind]} · ${Math.round(r.lengthM)} м`,
          ...uniqueBy(hit.cables, (x) => x.cableId).map((x) => `${x.name || x.typeName} (${x.fiberCount} вол.)`),
        ].filter(Boolean) as string[];
        return setTip({
          x: hit.point.x,
          y: hit.point.y,
          text: parts[0]!,
          sub: parts.slice(1).join(", ") || undefined,
        });
      }
      setTip(null);
    },
  };
  if (!tip) return null;
  return (
    <div
      className={cx("pointer-events-none absolute z-10 max-w-64 rounded-md bg-slate-900/90 px-2 py-1 text-xs text-white shadow")}
      style={{ left: tip.x + 14, top: tip.y + 14 }}
    >
      <div className="font-medium">{tip.text}</div>
      {tip.sub && <div className="text-slate-300">{tip.sub}</div>}
    </div>
  );
}
