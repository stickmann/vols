import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { equipment, equipmentModels, sites } from "../src/db/schema/index.js";
import { point } from "../src/db/geo.js";
import { appDb, builder, newTenant, ownerDb, withTenant } from "./helpers.js";
import { expectPgError } from "./pg-error.js";

const app = appDb();
const owner = ownerDb();
let tenantA: string;
let tenantB: string;
let siteA: string;

beforeAll(async () => {
  tenantA = await newTenant(app.db);
  tenantB = await newTenant(app.db);
  siteA = await withTenant(app.db, { tenantId: tenantA }, (tx) => builder(tx, tenantA).site([49.1, 55.8]));
});

afterAll(async () => {
  await app.close();
  await owner.close();
});

describe("изоляция операторов", () => {
  it("у каждой таблицы с tenant_id включён и принудителен RLS с политикой", async () => {
    const rows = await owner.db.execute<{ table_name: string; rls: boolean; forced: boolean; policies: number }>(sql`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = c.relname) AS policies
      FROM information_schema.columns col
      JOIN pg_class c ON c.relname = col.table_name AND c.relkind = 'r'
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = col.table_schema
      WHERE col.table_schema = 'public' AND col.column_name = 'tenant_id'
    `);
    expect(rows.length).toBeGreaterThan(10);
    const bad = rows.filter((r) => !r.rls || !r.forced || r.policies === 0).map((r) => r.table_name);
    expect(bad).toEqual([]);
  });

  it("оператор видит только свои данные, без контекста не видно ничего", async () => {
    const seenByA = await withTenant(app.db, { tenantId: tenantA }, (tx) => tx.select().from(sites));
    const seenByB = await withTenant(app.db, { tenantId: tenantB }, (tx) => tx.select().from(sites));
    const noCtx = await app.db.select().from(sites);
    expect(seenByA.map((s) => s.id)).toContain(siteA);
    expect(seenByB.map((s) => s.id)).not.toContain(siteA);
    expect(noCtx).toEqual([]);
  });

  it("нельзя записать строку от имени другого оператора", async () => {
    await expectPgError(
      withTenant(app.db, { tenantId: tenantB }, (tx) =>
        tx.insert(sites).values({ tenantId: tenantA, kind: "pole", geom: point([49, 55]) }),
      ),
      "42501",
    );
  });

  it("нельзя сослаться на объект другого оператора, даже зная его id", async () => {
    await expectPgError(
      withTenant(app.db, { tenantId: tenantB }, async (tx) => {
        const [m] = await tx.select().from(equipmentModels).where(sql`${equipmentModels.kind} = 'closure'`).limit(1);
        await tx.insert(equipment).values({ tenantId: tenantB, kind: "closure", modelId: m!.id, siteId: siteA });
      }),
      "23503",
    );
  });

  it("стартовые справочники созданы каждому оператору", async () => {
    const [counts] = await withTenant(app.db, { tenantId: tenantB }, (tx) =>
      tx.execute<{ types: number; models: number; schemes: number }>(sql`
        SELECT (SELECT count(*)::int FROM cable_types) AS types,
               (SELECT count(*)::int FROM equipment_models) AS models,
               (SELECT count(*)::int FROM color_schemes) AS schemes`),
    );
    expect(counts!.types).toBeGreaterThan(0);
    expect(counts!.models).toBeGreaterThan(0);
    expect(counts!.schemes).toBeGreaterThan(0);
  });
});
