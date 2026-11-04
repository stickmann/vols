import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createDb, withTenant, type Db, type Tx } from "../src/db/client.js";
import { lineString, point, type LngLat } from "../src/db/geo.js";
import { cableSpans, cableTypes, cables, equipment, equipmentModels, fibers, routes, sites, terminals } from "../src/db/schema/index.js";
import { provisionTenant } from "../src/services/tenants.js";

export function testUrls() {
  const dbName = process.env.TEST_DB_NAME ?? "vols_test";
  const host = process.env.TEST_DB_HOST ?? "localhost:5432";
  return {
    dbName,
    admin: process.env.TEST_ADMIN_URL ?? `postgres://vols:vols@${host}/postgres`,
    owner: `postgres://vols:vols@${host}/${dbName}`,
    app: `postgres://vols_app:${process.env.VOLS_APP_PASSWORD ?? "vols_app"}@${host}/${dbName}`,
  };
}

export function appDb() {
  return createDb(testUrls().app, { max: 4 });
}

export function ownerDb() {
  return createDb(testUrls().owner, { max: 2 });
}

export async function newTenant(db: Db) {
  const slug = `t-${randomUUID().slice(0, 8)}`;
  return provisionTenant(db, { name: slug, slug });
}

/** Набор коротких хелперов для построения сети в тестах. */
export function builder(tx: Tx, tenantId: string) {
  return {
    site: async (at: LngLat, kind: (typeof sites.$inferInsert)["kind"] = "pole") => {
      const [s] = await tx.insert(sites).values({ tenantId, kind, geom: point(at) }).returning({ id: sites.id });
      return s!.id;
    },
    route: async (from: string, to: string, coords: LngLat[]) => {
      const [r] = await tx
        .insert(routes)
        .values({ tenantId, kind: "aerial", fromSiteId: from, toSiteId: to, geom: lineString(coords) })
        .returning({ id: routes.id, lengthM: routes.lengthM });
      return r!;
    },
    equipment: async (kind: (typeof equipment.$inferInsert)["kind"], modelName: string, siteId: string, parentId?: string) => {
      const [m] = await tx
        .select({ id: equipmentModels.id })
        .from(equipmentModels)
        .where(and(eq(equipmentModels.kind, kind), eq(equipmentModels.name, modelName)));
      const [e] = await tx
        .insert(equipment)
        .values({ tenantId, kind, modelId: m!.id, siteId, parentId })
        .returning({ id: equipment.id });
      return e!.id;
    },
    cable: async (typeName: string) => {
      const [t] = await tx.select({ id: cableTypes.id }).from(cableTypes).where(eq(cableTypes.name, typeName));
      const [c] = await tx.insert(cables).values({ tenantId, cableTypeId: t!.id }).returning({ id: cables.id });
      return c!.id;
    },
    span: async (v: { cableId: string; seq?: number; from: string; to: string; fromEq?: string; toEq?: string }) => {
      const [s] = await tx
        .insert(cableSpans)
        .values({
          tenantId,
          cableId: v.cableId,
          seq: v.seq ?? 1,
          fromSiteId: v.from,
          toSiteId: v.to,
          fromEquipmentId: v.fromEq,
          toEquipmentId: v.toEq,
        })
        .returning({ id: cableSpans.id });
      return s!.id;
    },
    fiberEnd: async (spanId: string, number: number, side: "a" | "b") => {
      const [t] = await tx
        .select({ id: terminals.id })
        .from(terminals)
        .innerJoin(fibers, eq(fibers.id, terminals.fiberId))
        .where(and(eq(fibers.spanId, spanId), eq(fibers.number, number), eq(terminals.fiberSide, side)));
      return t!.id;
    },
    port: async (equipmentId: string, role: "in" | "out" | "adapter" | "pon", no: number, face?: "rear" | "front") => {
      const [t] = await tx
        .select({ id: terminals.id })
        .from(terminals)
        .where(
          and(
            eq(terminals.equipmentId, equipmentId),
            eq(terminals.portRole, role),
            eq(terminals.portNo, no),
            face ? eq(terminals.portFace, face) : sql`${terminals.portFace} IS NULL`,
          ),
        );
      return t!.id;
    },
  };
}

export { withTenant };
