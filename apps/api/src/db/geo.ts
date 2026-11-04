import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export type LngLat = [lng: number, lat: number];

export const point = ([lng, lat]: LngLat): SQL => sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;

export const lineString = (coords: LngLat[]): SQL =>
  sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify({ type: "LineString", coordinates: coords })}), 4326)`;

/** Геометрия как GeoJSON-объект в выборке. */
export const asGeoJson = (col: AnyPgColumn): SQL<unknown> => sql`ST_AsGeoJSON(${col})::jsonb`;
