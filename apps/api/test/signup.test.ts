import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { appDb, newTenant, ownerDb } from "./helpers.js";

const db = appDb();
const owner = ownerDb();
const open = buildApp({ db: db.db, devTenantHeader: false, signup: true, termsUrl: "https://example.ru/terms" });
const closed = buildApp({ db: db.db, devTenantHeader: false });
afterAll(async () => {
  await open.close();
  await closed.close();
  await db.close();
  await owner.close();
});

type Res = { status: number; body: any; cookie: string | undefined };
async function call(app: typeof open, method: "GET" | "POST", url: string, body?: unknown, cookie?: string, ip = "10.0.0.1"): Promise<Res> {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { "x-requested-with": "vols", ...(cookie ? { cookie } : {}) },
    payload: body as never,
    remoteAddress: ip,
  });
  const set = res.headers["set-cookie"];
  return { status: res.statusCode, body: res.body ? res.json() : undefined, cookie: typeof set === "string" ? set.split(";")[0] : undefined };
}

let n = 0;
const form = (over: Record<string, unknown> = {}) => ({
  company: "ООО «Оптика»",
  name: "Иван Петров",
  email: `signup${++n}-${Date.now()}@isp.ru`,
  password: "пароль-владельца",
  demo: true,
  acceptTerms: true,
  ...over,
});

describe("регистрация оператора", () => {
  it("по умолчанию закрыта", async () => {
    expect((await call(closed, "GET", "/auth/config")).body).toEqual({ signup: false, termsUrl: null });
    expect((await call(closed, "POST", "/auth/signup", form())).status).toBe(403);
  });

  it("создаёт оператора на бесплатном тарифе со справочниками и демо-сетью, владелец сразу вошёл", async () => {
    expect((await call(open, "GET", "/auth/config")).body).toEqual({ signup: true, termsUrl: "https://example.ru/terms" });
    const r = await call(open, "POST", "/auth/signup", form({ company: "  ООО «Свет»  " }));
    expect(r.status).toBe(201);
    const me = (await call(open, "GET", "/auth/me", undefined, r.cookie)).body;
    expect(me).toMatchObject({ role: "owner", tenant: { name: "ООО «Свет»" }, usage: { plan: "free", pointLimit: 200, userLimit: 3, users: 1 } });
    expect(me.usage.points).toBeGreaterThan(0); // демо-сеть
    expect((await call(open, "GET", "/cable-types", undefined, r.cookie)).body.length).toBeGreaterThan(3);
    const net = (await call(open, "GET", "/network", undefined, r.cookie)).body;
    expect(net.sites.features.length).toBeGreaterThan(0);
    const [u] = await owner.db.execute<{ t: string | null }>(sql`SELECT terms_accepted_at AS t FROM users WHERE id = ${me.user.id}`);
    expect(u!.t).not.toBeNull();
  });

  it("без демо-сети — пустая карта; новый владелец не видит чужих операторов", async () => {
    const other = await newTenant(db.db);
    const r = await call(open, "POST", "/auth/signup", form({ demo: false }), undefined, "10.0.0.2");
    const me = (await call(open, "GET", "/auth/me", undefined, r.cookie)).body;
    expect(me.usage.points).toBe(0);
    expect(me.memberships).toHaveLength(1);
    expect((await call(open, "POST", "/auth/switch-tenant", { tenantId: other }, r.cookie)).status).toBe(403);
  });

  it("занятый e-mail, без согласия, короткий пароль, бот — отказ, лишних операторов не остаётся", async () => {
    const before = (await owner.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM tenants`))[0]!.n;
    const f = form();
    expect((await call(open, "POST", "/auth/signup", f, undefined, "10.0.0.3")).status).toBe(201);
    const dup = await call(open, "POST", "/auth/signup", { ...f, email: f.email.toUpperCase() }, undefined, "10.0.0.3");
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/уже зарегистрирован/);
    expect((await call(open, "POST", "/auth/signup", form({ acceptTerms: false }), undefined, "10.0.0.3")).status).toBe(400);
    const short = await call(open, "POST", "/auth/signup", form({ password: "123" }), undefined, "10.0.0.4");
    expect(short.status).toBe(422);
    expect(short.body.error).toMatch(/не короче 8/);
    expect((await call(open, "POST", "/auth/signup", form({ website: "http://spam" }), undefined, "10.0.0.4")).status).toBe(400);
    const after = (await owner.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM tenants`))[0]!.n;
    expect(after).toBe(before + 1);
  });

  it("не больше 5 регистраций в час с одного адреса", async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await call(open, "POST", "/auth/signup", form({ demo: false }), undefined, "10.0.0.9")).status);
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
  });
});
