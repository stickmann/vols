import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/services/auth/crypto.js";
import { appDb, newTenant, ownerDb } from "./helpers.js";

const db = appDb();
const owner = ownerDb();
const api = buildApp({ db: db.db, devTenantHeader: true });
afterAll(async () => {
  await api.close();
  await db.close();
  await owner.close();
});

let tenantId: string;
const call = async (method: "GET" | "POST" | "DELETE", url: string, body?: unknown, cookie?: string) => {
  const headers: Record<string, string> = cookie ? { cookie, "x-requested-with": "vols" } : { "x-tenant-id": tenantId };
  const res = await api.inject({ method, url: `/api/v1${url}`, headers, payload: body as never });
  const set = res.headers["set-cookie"];
  return { status: res.statusCode, body: res.body ? res.json() : undefined, cookie: typeof set === "string" ? set.split(";")[0]! : undefined };
};
const setLimits = (points: number | null, users: number | null) =>
  owner.db.execute(sql`UPDATE tenants SET point_limit = ${points}, user_limit = ${users} WHERE id = ${tenantId}`);

let site: string;
let models: { id: string; name: string }[];
const add = (name: string, modelName: string, parentId?: string) =>
  call("POST", "/equipment", { siteId: site, modelId: models.find((m) => m.name === modelName)!.id, name, parentId });

beforeAll(async () => {
  tenantId = await newTenant(db.db);
  site = (await call("POST", "/sites", { kind: "pole", name: "Оп. 1", position: [49.1, 55.8] })).body.id;
  models = (await call("GET", "/equipment-models")).body;
});

describe("лимит точек учёта", () => {
  it("новый оператор — бесплатный тариф: 200 точек, 3 пользователя", async () => {
    const [t] = await owner.db.execute<{ plan: string; pl: number; ul: number }>(sql`
      SELECT plan, tenant_point_limit(id) AS pl, tenant_user_limit(id) AS ul FROM tenants WHERE id = ${tenantId}`);
    expect(t).toEqual({ plan: "free", pl: 200, ul: 3 });
  });

  it("сверх лимита — понятный отказ; сплиттеры не считаются; удаление освобождает место", async () => {
    await setLimits(2, null);
    const m1 = (await add("М-1", "Муфта МТОК-Л6 (до 96 сварок)")).body.id;
    expect((await add("ОРК-1", "ОРК на 8 абонентов (SC/APC)")).status).toBe(201);
    const over = await add("М-2", "Муфта МТОК-Л6 (до 96 сварок)");
    expect(over.status).toBe(422);
    expect(over.body.error).toMatch(/лимит тарифа: 2 точек учёта/);
    expect((await add("Сплиттер", "PLC 1:8", m1)).status).toBe(201);

    const del = await call("DELETE", `/equipment/${m1}?force=true`);
    expect(del.status).toBe(200);
    expect((await add("М-3", "Муфта МТОК-Л6 (до 96 сварок)")).status).toBe(201);

    // Восстановить удалённое можно всегда — даже если место уже занято.
    expect((await call("POST", `/operations/${del.body.operationId}/undo`)).status).toBe(200);
    const [row] = await owner.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM equipment WHERE tenant_id = ${tenantId} AND kind <> 'splitter'`);
    expect(row!.n).toBe(3);
    expect((await add("М-4", "Муфта МТОК-Л6 (до 96 сварок)")).status).toBe(422);
  });

  it("тариф без ограничений — лимита нет", async () => {
    await owner.db.execute(sql`UPDATE tenants SET plan = 'unlimited', point_limit = NULL WHERE id = ${tenantId}`);
    expect((await add("М-5", "Муфта МТОК-Л6 (до 96 сварок)")).status).toBe(201);
    await owner.db.execute(sql`UPDATE tenants SET plan = 'free' WHERE id = ${tenantId}`);
  });
});

describe("лимит пользователей", () => {
  it("приглашения занимают места; отзыв освобождает; принятое приглашение — пользователь", async () => {
    const [u] = await owner.db.execute<{ id: string }>(sql`
      INSERT INTO users (email, name, password_hash) VALUES ('plan-owner@x.ru', 'Владелец', ${await hashPassword("пароль-владельца")}) RETURNING id`);
    await owner.db.execute(sql`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${tenantId}, ${u!.id}, 'owner')`);
    await setLimits(null, 2);
    const c = (await call("POST", "/auth/login", { email: "plan-owner@x.ru", password: "пароль-владельца" })).cookie!;

    const me = (await call("GET", "/auth/me", undefined, c)).body;
    expect(me.usage).toMatchObject({ plan: "free", users: 1, userLimit: 2, pointLimit: 200 });

    const inv = await call("POST", "/invites", { email: "a@x.ru", role: "viewer" }, c);
    expect(inv.status).toBe(201);
    const second = await call("POST", "/invites", { email: "b@x.ru", role: "viewer" }, c);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/лимит тарифа: 2 пользователя/);

    const pending = (await call("GET", "/users", undefined, c)).body.invites;
    expect((await call("DELETE", `/invites/${pending[0].id}`, undefined, c)).status).toBe(204);
    const again = await call("POST", "/invites", { email: "b@x.ru", role: "viewer" }, c);
    expect(again.status).toBe(201);
    expect((await call("POST", `/auth/invites/${again.body.token}/accept`, { name: "Б", password: "пароль-сотрудника" })).status).toBe(200);
    expect((await call("GET", "/auth/me", undefined, c)).body.usage.users).toBe(2);
    expect((await call("POST", "/invites", { email: "c@x.ru", role: "viewer" }, c)).status).toBe(409);
  });
});
