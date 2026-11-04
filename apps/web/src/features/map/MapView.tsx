import type { LngLat } from "@vols/shared";
import type { FeatureCollection, Geometry, LineString, Point } from "geojson";
import {
  GeoJSONSource,
  LngLatBounds,
  Map as MlMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type MapMouseEvent,
  type MapTouchEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef } from "react";
import {
  CABLE_COLOR,
  ROUTE_KIND_COLORS,
  SELECT_COLOR,
  SITE_KIND_STYLE,
  type Basemap,
} from "./style.js";
import type { CableSpanProps, Network, RouteProps, SiteProps } from "./types.js";

export interface MapHit {
  lngLat: LngLat;
  point: { x: number; y: number };
  sites: SiteProps[];
  routes: RouteProps[];
  cables: CableSpanProps[];
}

export interface LayerVisibility {
  sites: boolean;
  routes: boolean;
  cables: boolean;
}

export interface MapViewProps {
  network: Network | undefined;
  basemap: Basemap;
  layers: LayerVisibility;
  selectedSiteId: string | null;
  /** Линии, подсвеченные как выбранные: трасса, пролёты кабеля, путь прокладки. */
  highlight: FeatureCollection<Geometry>;
  /** Черновик: рисуемая трасса, точки пути и т.п. */
  draft: FeatureCollection<Geometry>;
  cursor: string;
  /** Место, которое можно перетаскивать мышью/пальцем. */
  draggableSiteId: string | null;
  /** Красная метка (например, место по рефлектометру). */
  marker: LngLat | null;
  /** Переместить карту к точке; меняйте объект, чтобы повторить. */
  focus: { at: LngLat } | null;
  onClick: (hit: MapHit) => void;
  onHover: (hit: MapHit | null) => void;
  onSiteDragEnd: (siteId: string, to: LngLat) => void;
}

// Vite при предсборке зависимостей теряет относительный путь к воркеру — задаём явно.
setWorkerUrl(workerUrl);

const EMPTY: FeatureCollection<Geometry> = { type: "FeatureCollection", features: [] };
const VIEW_KEY = "vols.mapView";

const match = <T extends string>(prop: string, values: Record<T, string | number>, fallback: string | number) =>
  ["match", ["get", prop], ...Object.entries(values).flat(), fallback] as unknown as ExpressionSpecification;

const routeColor = match("kind", ROUTE_KIND_COLORS, "#475569");
const siteColor = match(
  "kind",
  Object.fromEntries(Object.entries(SITE_KIND_STYLE).map(([k, v]) => [k, v.color])) as Record<string, string>,
  "#475569",
);
const siteRadius = match(
  "kind",
  Object.fromEntries(Object.entries(SITE_KIND_STYLE).map(([k, v]) => [k, v.radius])) as Record<string, number>,
  5,
);

/** Добавить наши источники и слои поверх подложки (после каждой смены стиля). */
function addNetworkLayers(map: MlMap) {
  const src = (id: string) => map.addSource(id, { type: "geojson", data: EMPTY, promoteId: "id" });
  src("routes");
  src("cables");
  src("sites");
  src("highlight");
  src("draft");
  src("marker");

  map.addLayer({
    id: "cables-halo",
    type: "line",
    source: "cables",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": CABLE_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 4, 18, 9], "line-opacity": 0.55 },
  });
  map.addLayer({
    id: "routes-built",
    type: "line",
    source: "routes",
    filter: ["!=", ["get", "status"], "planned"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": routeColor,
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 18, 3.5],
      "line-opacity": ["case", ["==", ["get", "status"], "decommissioned"], 0.4, 1],
    },
  });
  map.addLayer({
    id: "routes-planned",
    type: "line",
    source: "routes",
    filter: ["==", ["get", "status"], "planned"],
    paint: {
      "line-color": routeColor,
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 18, 3.5],
      "line-dasharray": [2, 1.5],
    },
  });
  // Широкие прозрачные линии — чтобы по линиям было легко попасть пальцем.
  map.addLayer({ id: "routes-hit", type: "line", source: "routes", paint: { "line-color": "#000", "line-opacity": 0, "line-width": 16 } });
  map.addLayer({ id: "cables-hit", type: "line", source: "cables", paint: { "line-color": "#000", "line-opacity": 0, "line-width": 16 } });

  map.addLayer({
    id: "highlight-line",
    type: "line",
    source: "highlight",
    filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": SELECT_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 4, 18, 8], "line-opacity": 0.8 },
  });

  map.addLayer({
    id: "draft-line",
    type: "line",
    source: "draft",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": SELECT_COLOR, "line-width": 3, "line-dasharray": [1.5, 1] },
  });

  map.addLayer({
    id: "sites-circle",
    type: "circle",
    source: "sites",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, ["*", siteRadius, 0.6], 17, siteRadius, 20, ["*", siteRadius, 1.5]],
      "circle-color": [
        "case",
        ["==", ["get", "status"], "planned"],
        "#ffffff",
        ["==", ["get", "status"], "decommissioned"],
        "#cbd5e1",
        siteColor,
      ],
      "circle-stroke-color": ["case", ["==", ["get", "status"], "planned"], siteColor, "#ffffff"],
      "circle-stroke-width": ["case", ["==", ["get", "status"], "planned"], 2, 1.5],
    },
  });
  map.addLayer({
    id: "sites-equipment",
    type: "circle",
    source: "sites",
    filter: [">", ["get", "equipmentCount"], 0],
    paint: { "circle-radius": 2.2, "circle-color": "#facc15", "circle-stroke-color": "#713f12", "circle-stroke-width": 0.8 },
  });
  map.addLayer({
    id: "sites-selected",
    type: "circle",
    source: "sites",
    filter: ["==", ["get", "id"], ""],
    paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": SELECT_COLOR, "circle-stroke-width": 3 },
  });
  map.addLayer({
    id: "marker",
    type: "circle",
    source: "marker",
    paint: { "circle-radius": 9, "circle-color": "#dc2626", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 },
  });
  map.addLayer({
    id: "draft-points",
    type: "circle",
    source: "draft",
    filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-color": SELECT_COLOR, "circle-stroke-width": 2.5 },
  });
}

const markerFc = (p: LngLat | null): FeatureCollection<Geometry> =>
  p ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } }] } : EMPTY;

function setData(map: MlMap, id: string, data: FeatureCollection<Geometry>) {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
}

function loadView(): { center: [number, number]; zoom: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null");
    return v && Array.isArray(v.center) ? v : null;
  } catch {
    return null;
  }
}

export function MapView(props: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const fitted = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const dragging = useRef<{ id: string; moved: boolean; at: LngLat } | null>(null);

  // Создание карты.
  useEffect(() => {
    const saved = loadView();
    const map = new MlMap({
      container: container.current!,
      style: latest.current.basemap.style,
      center: saved?.center ?? [37.6176, 55.7558],
      zoom: saved?.zoom ?? 11,
      attributionControl: { compact: true },
    });
    if (saved) fitted.current = true;
    mapRef.current = map;
    // Для автотестов в режиме разработки: перевод координат в пиксели и т.п.
    if (import.meta.env.DEV) (window as unknown as { __volsMap?: MlMap }).__volsMap = map;
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("style.load", () => {
      addNetworkLayers(map);
      ready.current = true;
      syncAll(map);
    });

    const hitAt = (e: MapMouseEvent | MapTouchEvent): MapHit => {
      const p = e.point;
      const box: [[number, number], [number, number]] = [
        [p.x - 6, p.y - 6],
        [p.x + 6, p.y + 6],
      ];
      const layers = ["sites-circle", "routes-hit", "cables-hit"].filter((l) => map.getLayer(l));
      const feats = layers.length ? map.queryRenderedFeatures(box, { layers }) : [];
      const uniq = <T extends { id: string }>(arr: T[]) => [...new Map(arr.map((x) => [x.id, x])).values()];
      const vis = latest.current.layers;
      return {
        lngLat: [e.lngLat.lng, e.lngLat.lat],
        point: { x: p.x, y: p.y },
        sites: vis.sites ? uniq(feats.filter((f) => f.layer.id === "sites-circle").map((f) => f.properties as SiteProps)) : [],
        routes: vis.routes ? uniq(feats.filter((f) => f.layer.id === "routes-hit").map((f) => f.properties as RouteProps)) : [],
        cables: vis.cables ? uniq(feats.filter((f) => f.layer.id === "cables-hit").map((f) => f.properties as CableSpanProps)) : [],
      };
    };

    map.on("click", (e) => {
      if (dragging.current?.moved) return;
      latest.current.onClick(hitAt(e));
    });
    map.on("mousemove", (e) => {
      if (dragging.current) return;
      latest.current.onHover(hitAt(e));
    });
    map.on("mouseout", () => latest.current.onHover(null));
    map.on("moveend", () => {
      try {
        const c = map.getCenter();
        localStorage.setItem(VIEW_KEY, JSON.stringify({ center: [c.lng, c.lat], zoom: map.getZoom() }));
      } catch {
        /* хранилище недоступно */
      }
    });

    // Перетаскивание выбранного места.
    const startDrag = (e: MapMouseEvent | MapTouchEvent) => {
      const id = latest.current.draggableSiteId;
      if (!id) return;
      const f = map.queryRenderedFeatures(e.point, { layers: ["sites-circle"] }).find((x) => x.properties.id === id);
      if (!f) return;
      if ("originalEvent" in e && "touches" in e.originalEvent && e.originalEvent.touches.length > 1) return;
      e.preventDefault();
      dragging.current = { id, moved: false, at: [e.lngLat.lng, e.lngLat.lat] };
      map.getCanvas().style.cursor = "grabbing";
    };
    const moveDrag = (e: MapMouseEvent | MapTouchEvent) => {
      const d = dragging.current;
      if (!d) return;
      d.moved = true;
      d.at = [e.lngLat.lng, e.lngLat.lat];
      previewMove(map, d.id, d.at);
    };
    const endDrag = () => {
      const d = dragging.current;
      if (!d) return;
      map.getCanvas().style.cursor = "";
      if (d.moved) latest.current.onSiteDragEnd(d.id, d.at);
      // Сбрасываем после click, который придёт следом за mouseup.
      setTimeout(() => (dragging.current = null), 0);
    };
    map.on("mousedown", "sites-circle", startDrag);
    map.on("touchstart", "sites-circle", startDrag);
    map.on("mousemove", moveDrag);
    map.on("touchmove", moveDrag);
    map.on("mouseup", endDrag);
    map.on("touchend", endDrag);

    return () => {
      ready.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /** Пока тянем место — двигаем его и концы примыкающих трасс прямо в источниках. */
  function previewMove(map: MlMap, id: string, at: LngLat) {
    const net = latest.current.network;
    if (!net) return;
    setData(map, "sites", {
      ...net.sites,
      features: net.sites.features.map((f) =>
        f.properties.id === id ? { ...f, geometry: { type: "Point", coordinates: at } as Point } : f,
      ),
    });
    setData(map, "routes", {
      ...net.routes,
      features: net.routes.features.map((f) => {
        const c = f.geometry.coordinates;
        if (f.properties.fromSiteId === id) return { ...f, geometry: { type: "LineString", coordinates: [at, ...c.slice(1)] } as LineString };
        if (f.properties.toSiteId === id) return { ...f, geometry: { type: "LineString", coordinates: [...c.slice(0, -1), at] } as LineString };
        return f;
      }),
    });
  }

  function syncAll(map: MlMap) {
    const p = latest.current;
    if (p.network) {
      setData(map, "sites", p.network.sites);
      setData(map, "routes", p.network.routes);
      setData(map, "cables", p.network.cables);
    }
    setData(map, "highlight", p.highlight);
    setData(map, "draft", p.draft);
    setData(map, "marker", markerFc(p.marker));
    map.setFilter("sites-selected", ["==", ["get", "id"], p.selectedSiteId ?? ""]);
    const vis = (v: boolean) => (v ? "visible" : "none");
    for (const l of ["sites-circle", "sites-equipment", "sites-selected"]) map.setLayoutProperty(l, "visibility", vis(p.layers.sites));
    for (const l of ["routes-built", "routes-planned", "routes-hit"]) map.setLayoutProperty(l, "visibility", vis(p.layers.routes));
    for (const l of ["cables-halo", "cables-hit"]) map.setLayoutProperty(l, "visibility", vis(p.layers.cables));
  }

  // Смена подложки: стиль заменяется, наши слои добавятся заново в style.load.
  const basemapId = useRef(props.basemap.id);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || basemapId.current === props.basemap.id) return;
    basemapId.current = props.basemap.id;
    ready.current = false;
    map.setStyle(props.basemap.style);
  }, [props.basemap]);

  // Данные и оформление — каждое обновляется только при своём изменении.
  const whenReady = (fn: (map: MlMap) => void) => {
    const map = mapRef.current;
    if (map && ready.current) fn(map);
  };
  useEffect(
    () =>
      whenReady((map) => {
        if (!props.network) return;
        setData(map, "sites", props.network.sites);
        setData(map, "routes", props.network.routes);
        setData(map, "cables", props.network.cables);
      }),
    [props.network],
  );
  useEffect(() => whenReady((map) => setData(map, "highlight", props.highlight)), [props.highlight]);
  useEffect(() => whenReady((map) => setData(map, "draft", props.draft)), [props.draft]);
  useEffect(() => whenReady((map) => setData(map, "marker", markerFc(props.marker))), [props.marker]);
  useEffect(() => {
    if (props.focus) mapRef.current?.flyTo({ center: props.focus.at, zoom: Math.max(mapRef.current.getZoom(), 17) });
  }, [props.focus]);
  useEffect(
    () => whenReady((map) => map.setFilter("sites-selected", ["==", ["get", "id"], props.selectedSiteId ?? ""])),
    [props.selectedSiteId],
  );
  useEffect(() => whenReady(syncAll), [props.layers]);

  // Первый показ: вписать сеть в экран.
  useEffect(() => {
    const map = mapRef.current;
    const net = props.network;
    if (!map || fitted.current || !net) return;
    const b = new LngLatBounds();
    for (const f of net.sites.features) b.extend(f.geometry.coordinates as [number, number]);
    for (const f of net.routes.features) for (const c of f.geometry.coordinates) b.extend(c as [number, number]);
    if (!b.isEmpty()) {
      map.fitBounds(b, { padding: 80, maxZoom: 17, duration: 0 });
      fitted.current = true;
    }
  }, [props.network]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = props.cursor;
  }, [props.cursor]);

  // MapLibre ставит контейнеру position: relative, поэтому позиционируем обёртку.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" data-testid="map" />
    </div>
  );
}
