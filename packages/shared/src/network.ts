import { z } from "zod";

export const siteKinds = ["pop", "pole", "manhole", "cabinet", "building", "entrance", "point"] as const;
export const routeKinds = ["aerial", "duct", "ground", "facade", "indoor"] as const;
export const objectStatuses = ["planned", "built", "decommissioned"] as const;
export const equipmentKinds = ["closure", "terminal_box", "odf", "splitter", "olt", "onu"] as const;

export type SiteKind = (typeof siteKinds)[number];
export type RouteKind = (typeof routeKinds)[number];
export type ObjectStatus = (typeof objectStatuses)[number];

export const lngLatSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export type LngLat = z.infer<typeof lngLatSchema>;

const optText = (max: number) => z.string().trim().max(max).nullish();

export const siteInputSchema = z.object({
  kind: z.enum(siteKinds),
  name: optText(120),
  position: lngLatSchema,
  address: optText(300),
  status: z.enum(objectStatuses).default("planned"),
  notes: optText(2000),
});
export type SiteInput = z.infer<typeof siteInputSchema>;
export const sitePatchSchema = siteInputSchema.partial();

export const routeInputSchema = z.object({
  kind: z.enum(routeKinds),
  name: optText(120),
  fromSiteId: z.uuid(),
  toSiteId: z.uuid(),
  /** Полная линия от места до места; концы всё равно притягиваются к местам. */
  coordinates: z.array(lngLatSchema).min(2).max(2000),
  status: z.enum(objectStatuses).default("planned"),
  notes: optText(2000),
});
export type RouteInput = z.infer<typeof routeInputSchema>;
export const routePatchSchema = routeInputSchema.omit({ fromSiteId: true, toSiteId: true }).partial();

export const equipmentInputSchema = z.object({
  siteId: z.uuid(),
  modelId: z.uuid(),
  parentId: z.uuid().nullish(),
  name: optText(120),
  status: z.enum(objectStatuses).default("planned"),
  notes: optText(2000),
});
export type EquipmentInput = z.infer<typeof equipmentInputSchema>;
export const equipmentPatchSchema = equipmentInputSchema.pick({ name: true, status: true, notes: true }).partial();

export const cableInputSchema = z.object({
  cableTypeId: z.uuid(),
  name: optText(120),
  status: z.enum(objectStatuses).default("planned"),
  /** Места по порядку прокладки; между соседними должна быть трасса. */
  siteIds: z.array(z.uuid()).min(2).max(1000),
  fromEquipmentId: z.uuid().nullish(),
  toEquipmentId: z.uuid().nullish(),
  /** Запасы кабеля в местах по пути, м. */
  slacks: z.array(z.object({ siteId: z.uuid(), lengthM: z.number().positive().max(5000) })).max(1000).default([]),
  notes: optText(2000),
});
export type CableInput = z.infer<typeof cableInputSchema>;
export const cablePatchSchema = z
  .object({
    name: optText(120),
    status: z.enum(objectStatuses),
    notes: optText(2000),
    fromEquipmentId: z.uuid().nullable(),
    toEquipmentId: z.uuid().nullable(),
  })
  .partial();

export const pathRequestSchema = z.object({ fromSiteId: z.uuid(), toSiteId: z.uuid() });
