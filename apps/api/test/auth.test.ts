import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { currentStep, hashPassword, totpCode } from "../src/services/auth/crypto.js";
import { appDb, newTenant, ownerDb } from "./helpers.js";

const db = appDb();
const owner = ownerDb();
const api = buildApp({ db: db.db, devTenantHeader: true });
afterAll(async () => {
  await api.close();
  await db.close();
  await owner.close();
});

type Res = { status: number; body: any; cookie: string | null };
/** Запрос «как браузер»: cookie сессии и заголовок клиента. */
async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, o: { body?: unknown; cookie?: string | null; csrf?: boolean; tenant?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (o.cookie) headers.cookie = o.cookie;
  if (o.csrf !== false) headers["x-requested-with"] = "vols";
  if (o.tenant) headers["x-tenant-id"] = o.tenant;
  const res = await api.inject({ method, url: `/api/v1${url}`, headers, payload: o.body as never });
  const set = res.headers["set-cookie"];
  const cookie = typeof set === "string" ? set.split(";")[0]! : null;
  return { status: res.statusCode, body: res.body ? res.json() : undefined, cookie };
}

let tenantA: string;
let tenantB: string;
const PASS = "пароль-владельца";

async function addUser(email: string, name: string, tenantId: string, role: string, password = PASS) {
  const [u] = await owner.db.execute<{ id: string }>(sql`
    INSERT INTO users (email, name, password_hash) VALUES (${email}, ${name}, ${await hashPassword(password)}) RETURNING id`);
  await owner.db.execute(sql`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${tenantId}, ${u!.id}, ${role}::member_role)`);
  return u!.id;
}
const login = async (email: string, password = PASS) => (await call("POST", "/auth/login", { body: { email, password } })).cookie!;

beforeAll(async () => {
  tenantA = await newTenant(db.db);
  tenantB = await newTenant(db.db);
  // Здесь проверяется вход, а не тарифы (лимиты — в plans.test.ts).
  await owner.db.execute(sql`UPDATE tenants SET plan = 'unlimited' WHERE id IN (${tenantA}, ${tenantB})`);
  await addUser("owner@a.ru", "Владелец А", tenantA, "owner");
  await addUser("viewer@a.ru", "Наблюдатель", tenantA, "viewer");
  await addUser("tech@a.ru", "Монтажник", tenantA, "technician");
  await addUser("owner@b.ru", "Владелец Б", tenantB, "owner");
});

describe("вход", () => {
  it("неверный пароль и неизвестный e-mail — одинаковый отказ", async () => {
    const a = await call("POST", "/auth/login", { body: { email: "owner@a.ru", password: "не-тот-пароль" } });
    const b = await call("POST", "/auth/login", { body: { email: "nobody@a.ru", password: "не-тот-пароль" } });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body.error).toBe(b.body.error);
  });

  it("вход, профиль, выход", async () => {
    const r = await call("POST", "/auth/login", { body: { email: "OWNER@a.ru ", password: PASS } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ twoFactorRequired: false });
    const me = await call("GET", "/auth/me", { cookie: r.cookie });
    expect(me.body).toMatchObject({ user: { email: "owner@a.ru", twoFactor: false }, role: "owner", tenant: { id: tenantA } });
    expect((await call("GET", "/network", { cookie: r.cookie })).status).toBe(200);
    await call("POST", "/auth/logout", { cookie: r.cookie });
    expect((await call("GET", "/network", { cookie: r.cookie })).status).toBe(401);
  });

  it("без сессии и без заголовка оператора — 401", async () => {
    expect((await call("GET", "/network")).status).toBe(401);
  });

  it("изменения без заголовка клиента отклоняются (защита от подделки запроса)", async () => {
    const c = await login("owner@a.ru");
    const r = await call("POST", "/sites", { cookie: c, csrf: false, body: { kind: "pole", name: "X", position: [49, 55] } });
    expect(r.status).toBe(403);
  });
});

describe("роли", () => {
  it("просмотр: читать можно, менять нельзя; трассировка доступна", async () => {
    const c = await login("viewer@a.ru");
    expect((await call("GET", "/network", { cookie: c })).status).toBe(200);
    const r = await call("POST", "/sites", { cookie: c, body: { kind: "pole", name: "X", position: [49, 55] } });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/Инженер/);
    expect((await call("POST", "/trace", { cookie: c, body: { terminalId: "00000000-0000-4000-8000-000000000001" } })).status).not.toBe(403);
  });

  it("монтажник: разварка да, места и удаление нет", async () => {
    const c = await login("tech@a.ru");
    expect((await call("POST", "/connections", { cookie: c, body: {} })).status).toBe(400); // права есть, данные неверные
    expect((await call("POST", "/sites", { cookie: c, body: { kind: "pole", name: "X", position: [49, 55] } })).status).toBe(403);
    expect((await call("GET", "/users", { cookie: c })).status).toBe(403);
  });

  it("журнал знает, кто удалил", async () => {
    const c = await login("owner@a.ru");
    const site = (await call("POST", "/sites", { cookie: c, body: { kind: "pole", name: "Удаляемая", position: [49, 55] } })).body.id;
    await call("DELETE", `/sites/${site}?force=true`, { cookie: c });
    const ops = (await call("GET", "/operations", { cookie: c })).body;
    expect(ops[0]).toMatchObject({ title: "Удаление места «Удаляемая»", userName: "Владелец А" });
  });
});

describe("изоляция операторов", () => {
  it("пользователь А не может переключиться на оператора Б и не видит его участников", async () => {
    const c = await login("owner@a.ru");
    expect((await call("POST", "/auth/switch-tenant", { cookie: c, body: { tenantId: tenantB } })).status).toBe(403);
    const users = (await call("GET", "/users", { cookie: c })).body.members.map((m: { email: string }) => m.email);
    expect(users).toContain("owner@a.ru");
    expect(users).not.toContain("owner@b.ru");
    // Заголовок оператора при сессии не действует: работает только оператор сессии.
    const net = await call("GET", "/users", { cookie: c, tenant: tenantB });
    expect(net.body.members.map((m: { email: string }) => m.email)).not.toContain("owner@b.ru");
  });

  it("приглашение и сброс пароля чужого оператора не видны и не отзываются", async () => {
    const cb = await login("owner@b.ru");
    const inv = await call("POST", "/invites", { cookie: cb, body: { email: "x@b.ru", role: "viewer" } });
    const ca = await login("owner@a.ru");
    expect((await call("GET", "/users", { cookie: ca })).body.invites.map((i: { email: string }) => i.email)).not.toContain("x@b.ru");
    const invB = (await call("GET", "/users", { cookie: cb })).body.invites.find((i: { email: string }) => i.email === "x@b.ru");
    expect((await call("DELETE", `/invites/${invB.id}`, { cookie: ca })).status).toBe(404);
    const ownerB = (await call("GET", "/users", { cookie: cb })).body.members[0].id;
    expect((await call("POST", `/members/${ownerB}/reset-link`, { cookie: ca })).status).toBe(404);
    expect(inv.status).toBe(201);
  });
});

describe("приглашение, роли участников, сброс пароля", () => {
  it("приглашённый задаёт имя и пароль и входит с выданной ролью", async () => {
    const c = await login("owner@a.ru");
    const inv = await call("POST", "/invites", { cookie: c, body: { email: "New@A.ru", role: "designer" } });
    expect(inv.status).toBe(201);
    const info = await call("GET", `/auth/invites/${inv.body.token}`);
    expect(info.body).toMatchObject({ email: "new@a.ru", role: "designer", hasAccount: false });
    const acc = await call("POST", `/auth/invites/${inv.body.token}/accept`, { body: { name: "Новый Инженер", password: "новый-пароль" } });
    expect(acc.status).toBe(200);
    expect((await call("GET", "/auth/me", { cookie: acc.cookie })).body).toMatchObject({ role: "designer", user: { name: "Новый Инженер" } });
    // Повторно по той же ссылке нельзя.
    expect((await call("GET", `/auth/invites/${inv.body.token}`)).status).toBe(404);
  });

  it("существующий пользователь принимает приглашение другого оператора своим паролем", async () => {
    const cb = await login("owner@b.ru");
    const inv = await call("POST", "/invites", { cookie: cb, body: { email: "viewer@a.ru", role: "technician" } });
    expect((await call("GET", `/auth/invites/${inv.body.token}`)).body.hasAccount).toBe(true);
    expect((await call("POST", `/auth/invites/${inv.body.token}/accept`, { body: { password: "чужой" } })).status).toBe(401);
    const acc = await call("POST", `/auth/invites/${inv.body.token}/accept`, { body: { password: PASS } });
    const me = (await call("GET", "/auth/me", { cookie: acc.cookie })).body;
    expect(me.memberships.map((m: { tenantId: string }) => m.tenantId).sort()).toEqual([tenantA, tenantB].sort());
    expect(me.tenant.id).toBe(tenantB);
    expect((await call("POST", "/auth/switch-tenant", { cookie: acc.cookie, body: { tenantId: tenantA } })).status).toBe(200);
    expect((await call("GET", "/auth/me", { cookie: acc.cookie })).body.role).toBe("viewer");
  });

  it("последнего владельца не снять; администратор не назначает владельца", async () => {
    const c = await login("owner@a.ru");
    const members = (await call("GET", "/users", { cookie: c })).body.members as { id: string; email: string }[];
    const me = members.find((m) => m.email === "owner@a.ru")!;
    expect((await call("PATCH", `/members/${me.id}`, { cookie: c, body: { role: "admin" } })).status).toBe(409);
    const tech = members.find((m) => m.email === "tech@a.ru")!;
    expect((await call("PATCH", `/members/${tech.id}`, { cookie: c, body: { role: "admin" } })).status).toBe(200);
    const ct = await login("tech@a.ru");
    expect((await call("POST", "/invites", { cookie: ct, body: { email: "z@a.ru", role: "owner" } })).status).toBe(403);
    expect((await call("PATCH", `/members/${me.id}`, { cookie: ct, body: { role: "viewer" } })).status).toBe(403);
    await call("PATCH", `/members/${tech.id}`, { cookie: c, body: { role: "technician" } });
  });

  it("ссылка сброса пароля: новый пароль работает, старые сессии закрыты", async () => {
    const c = await login("owner@a.ru");
    const ct = await login("tech@a.ru");
    const tech = ((await call("GET", "/users", { cookie: c })).body.members as { id: string; email: string }[]).find((m) => m.email === "tech@a.ru")!;
    const link = await call("POST", `/members/${tech.id}/reset-link`, { cookie: c });
    expect((await call("GET", `/auth/reset/${link.body.token}`)).body).toEqual({ email: "tech@a.ru" });
    expect((await call("POST", `/auth/reset/${link.body.token}`, { body: { password: "короткий" } })).status).toBe(200);
    expect((await call("GET", "/network", { cookie: ct })).status).toBe(401);
    expect((await call("POST", "/auth/login", { body: { email: "tech@a.ru", password: "короткий" } })).status).toBe(200);
    expect((await call("POST", `/auth/reset/${link.body.token}`, { body: { password: "ещё-один" } })).status).toBe(404);
  });
});

describe("двухфакторный вход", () => {
  it("настройка, вход с кодом, код восстановления одноразовый", async () => {
    await addUser("2fa@a.ru", "С ключом", tenantA, "designer");
    let c = await login("2fa@a.ru");
    const setup = await call("POST", "/auth/2fa/setup", { cookie: c });
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect((await call("POST", "/auth/2fa/enable", { cookie: c, body: { code: "000000" } })).status).toBe(422);
    const en = await call("POST", "/auth/2fa/enable", { cookie: c, body: { code: totpCode(setup.body.secret, currentStep()) } });
    expect(en.body.recoveryCodes).toHaveLength(10);

    const r = await call("POST", "/auth/login", { body: { email: "2fa@a.ru", password: PASS } });
    expect(r.body).toEqual({ twoFactorRequired: true });
    c = r.cookie!;
    expect((await call("GET", "/network", { cookie: c })).status).toBe(401);
    expect((await call("POST", "/auth/login/2fa", { cookie: c, body: { code: "123456" } })).status).toBe(401);
    // Код того же шага уже использован при включении — нужен следующий.
    expect((await call("POST", "/auth/login/2fa", { cookie: c, body: { code: totpCode(setup.body.secret, currentStep() + 1) } })).status).toBe(200);
    expect((await call("GET", "/network", { cookie: c })).status).toBe(200);

    const r2 = await call("POST", "/auth/login", { body: { email: "2fa@a.ru", password: PASS } });
    const rc = en.body.recoveryCodes[0];
    expect((await call("POST", "/auth/login/2fa", { cookie: r2.cookie, body: { code: rc } })).status).toBe(200);
    const r3 = await call("POST", "/auth/login", { body: { email: "2fa@a.ru", password: PASS } });
    expect((await call("POST", "/auth/login/2fa", { cookie: r3.cookie, body: { code: rc } })).status).toBe(401);
    expect((await call("GET", "/auth/me", { cookie: r2.cookie })).body.user.recoveryCodesLeft).toBe(9);
  });

  it("обязательный 2FA у оператора: без него работа закрыта, профиль доступен", async () => {
    const c = await login("owner@a.ru");
    expect((await call("PATCH", "/tenant", { cookie: c, body: { require2fa: true } })).status).toBe(200);
    const cv = await login("viewer@a.ru");
    const net = await call("GET", "/network", { cookie: cv });
    expect(net.status).toBe(403);
    expect(net.body.error).toMatch(/двухфакторный/);
    expect((await call("GET", "/auth/me", { cookie: cv })).body.mustSetup2fa).toBe(true);
    // Владелец с обязательным 2FA тоже должен настроить — отключаем обратно через базу для остальных тестов.
    await owner.db.execute(sql`UPDATE tenants SET require_2fa = false WHERE id = ${tenantA}`);
  });
});
