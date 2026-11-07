/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL стиля MapLibre для подложки «Схема» (например, свои векторные тайлы OSM). */
  readonly VITE_MAP_STYLE?: string;
  /** Шаблон URL растровых тайлов спутниковой подложки: https://…/{z}/{x}/{y}. */
  readonly VITE_SATELLITE_TILES?: string;
  readonly VITE_SATELLITE_ATTRIBUTION?: string;
  /** Версия релиза, подставляется при сборке на сервере. */
  readonly VITE_APP_VERSION?: string;
}
