import type { ObjectStatus, RouteKind, SiteKind } from "@vols/shared";
import type { StyleSpecification } from "maplibre-gl";

export const SITE_KIND_LABELS: Record<SiteKind, string> = {
  pop: "Узел связи",
  pole: "Опора",
  manhole: "Колодец",
  cabinet: "Шкаф",
  building: "Здание",
  entrance: "Подъезд / ввод",
  point: "Точка",
};

export const SITE_KIND_STYLE: Record<SiteKind, { color: string; radius: number }> = {
  pop: { color: "#7c3aed", radius: 9 },
  pole: { color: "#334155", radius: 5 },
  manhole: { color: "#0e7490", radius: 6 },
  cabinet: { color: "#b45309", radius: 7 },
  building: { color: "#be123c", radius: 7 },
  entrance: { color: "#db2777", radius: 5 },
  point: { color: "#64748b", radius: 4 },
};

export const ROUTE_KIND_LABELS: Record<RouteKind, string> = {
  aerial: "Подвес",
  duct: "Канализация",
  ground: "В грунте",
  facade: "По фасаду",
  indoor: "Внутри здания",
};

export const ROUTE_KIND_COLORS: Record<RouteKind, string> = {
  aerial: "#0f766e",
  duct: "#9a3412",
  ground: "#854d0e",
  facade: "#4338ca",
  indoor: "#6b7280",
};

export const STATUS_LABELS: Record<ObjectStatus, string> = {
  planned: "Проект",
  built: "Построено",
  decommissioned: "Выведено",
};

export const EQUIPMENT_KIND_LABELS: Record<string, string> = {
  closure: "Муфта",
  terminal_box: "Абонентский ящик",
  odf: "Кросс",
  splitter: "Сплиттер",
  olt: "OLT",
  onu: "ONU",
};

export const CABLE_COLOR = "#ea580c";
export const SELECT_COLOR = "#2563eb";

export interface Basemap {
  id: string;
  label: string;
  style: StyleSpecification | string;
}

const rasterStyle = (tiles: string[], attribution: string, maxzoom = 19): StyleSpecification => ({
  version: 8,
  sources: { base: { type: "raster", tiles, tileSize: 256, attribution, maxzoom } },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#eef1f4" } },
    { id: "base", type: "raster", source: "base" },
  ],
});

/**
 * Подложки. В проде — свои векторные тайлы (VITE_MAP_STYLE: URL стиля MapLibre,
 * например PMTiles-выгрузка OSM). По умолчанию для разработки — растровые тайлы OSM:
 * их правила не допускают нагрузку от коммерческого сервиса.
 * Спутник подключается, только если задан VITE_SATELLITE_TILES (шаблон {z}/{x}/{y}) с лицензией.
 */
export function basemaps(): Basemap[] {
  const env = import.meta.env;
  const list: Basemap[] = [
    {
      id: "scheme",
      label: "Схема",
      style:
        (env.VITE_MAP_STYLE as string | undefined) ||
        rasterStyle(["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], "© участники OpenStreetMap"),
    },
  ];
  const sat = env.VITE_SATELLITE_TILES as string | undefined;
  if (sat) {
    list.push({
      id: "satellite",
      label: "Спутник",
      style: rasterStyle([sat], (env.VITE_SATELLITE_ATTRIBUTION as string | undefined) ?? ""),
    });
  }
  list.push({
    id: "none",
    label: "Без подложки",
    style: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#f8fafc" } }] },
  });
  return list;
}
