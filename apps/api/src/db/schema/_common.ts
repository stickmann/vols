import { sql } from "drizzle-orm";
import { customType, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Геометрия PostGIS в WGS84. В TS-коде значение — EWKB hex, как его отдаёт драйвер.
 * Читать удобнее через ST_AsGeoJSON, писать — через ST_GeomFromGeoJSON (см. src/db/geo.ts).
 */
export const pointGeom = customType<{ data: string; driverData: string }>({
  dataType: () => "geometry(Point,4326)",
});

export const lineGeom = customType<{ data: string; driverData: string }>({
  dataType: () => "geometry(LineString,4326)",
});

export const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);

export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
