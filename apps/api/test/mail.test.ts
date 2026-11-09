import { sql } from "drizzle-orm";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/services/auth/crypto.js";
import { smtpMailer } from "../src/services/mail.js";
import { appDb, newTenant, ownerDb } from "./helpers.js";

/** Настоящий SMTP-сервер на случайном порту: письма проходят весь путь через nodemailer. */
type Received = { to: string[]; raw: string };
const inbox: Received[] = [];
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS"],
  logger: false,
  onData(stream, session, cb) {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => {
      inbox.push({ to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks).toString("utf8") });
      cb();
    });
  },
});

const db = appDb();
const owner = ownerDb();
let api: ReturnType<typeof buildApp>;
const plain = buildApp({ db: db.db, devTenantHeader: false, signup: true });

const PUBLIC = "https://vols.example.ru";
const PASS = "пароль-владельца";
let tenant: string;

beforeAll(async () => {
  await new Promise<void>((ok) => smtp.listen(0, "127.0.0.1", ok));
  const port = (smtp.server.address() as { port: number }).port;
  const mailer = smtpMailer({
    host: "127.0.0.1",
    port,
    secure: false,
    from: "ВОЛС <noreply@example.ru>",
    publicUrl: `${PUBLIC}/`,
    allowSelfSigned: true,
  });
  api = buildApp({ db: db.db, devTenantHeader: false, signup: true, mailer });
  tenant = await newTenant(db.db);
  await owner.db.execute(sql`UPDATE tenants SET plan = 'unlimited' WHERE id = ${tenant}`);
  const [u] = await owner.db.execute<{ id: string }>(sql`
    INSERT INTO users (email, name, password_hash, email_verified_at) VALUES ('boss@mail.ru', 'Начальник', ${await hashPassword(PASS)}, now()) RETURNING id`);
  await owner.db.execute(sql`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${tenant}, ${u!.id}, 'owner')`);
});
afterAll(async () => {
  await api.close();
  await plain.close();
  await new Promise<void>((ok) => smtp.close(() => ok()));
  await db.close();
  await owner.close();
});

type Res = { status: number; body: any; cookie: string | undefined };
async function call(
  method: "GET" | "POST",
  url: string,
  o: { body?: unknown; cookie?: string; app?: typeof plain; ip?: string } = {},
): Promise<Res> {
  const res = await (o.app ?? api).inject({
    method,
    url: `/api/v1${url}`,
    headers: { "x-requested-with": "vols", ...(o.cookie ? { cookie: o.cookie } : {}) },
    payload: o.body as never,
    remoteAddress: o.ip ?? "10.1.0.1",
  });
  const set = res.headers["set-cookie"];
  return {
    status: res.statusCode,
    body: res.body ? res.json() : undefined,
    cookie: typeof set === "string" ? set.split(";")[0] : undefined,
  };
}
const login = async (email: string, password = PASS) =>
  (await call("POST", "/auth/login", { body: { email, password } })).cookie!;

/** Последнее письмо на адрес и ссылка из него (с учётом quoted-printable переносов). */
function lastLink(to: string, kind: "invite" | "reset" | "verify") {
  const mail = [...inbox].reverse().find((m) => m.to.includes(to));
  if (!mail) return null;
  const body = mail.raw.replace(/=\r?\n/g, "");
  const m = body.match(new RegExp(`${PUBLIC.replace(/\./g, "\\.")}/${kind}/([A-Za-z0-9_-]{20,})`));
  return m ? m[1]! : null;
}

describe("письма", () => {
  it("конфигурация сообщает, что почта включена", async () => {
    expect((await call("GET", "/auth/config")).body.mail).toBe(true);
    expect((await call("GET", "/auth/config", { app: plain })).body.mail).toBe(false);
  });

  it("приглашение приходит письмом, ссылка из письма работает", async () => {
    const c = await login("boss@mail.ru");
    const r = await call("POST", "/invites", { cookie: c, body: { email: "new@mail.ru", role: "technician" } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ emailed: true, mailError: null });
    const token = lastLink("new@mail.ru", "invite");
    expect(token).toBe(r.body.token);
    const accepted = await call("POST", `/auth/invites/${token}/accept`, {
      body: { name: "Новичок", password: "пароль-новичка" },
    });
    expect(accepted.status).toBe(200);
    const me = await call("GET", "/auth/me", { cookie: accepted.cookie });
    expect(me.body).toMatchObject({ user: { email: "new@mail.ru", emailVerified: true }, role: "technician" });
  });

  it("«Забыли пароль?»: письмо существующему, тот же ответ для неизвестного", async () => {
    const before = inbox.length;
    const a = await call("POST", "/auth/forgot", { body: { email: "Boss@mail.ru" }, ip: "10.2.0.1" });
    const b = await call("POST", "/auth/forgot", { body: { email: "nobody@mail.ru" }, ip: "10.2.0.1" });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body).toEqual(b.body);
    expect(inbox.length).toBe(before + 1);
    const token = lastLink("boss@mail.ru", "reset")!;
    expect((await call("POST", `/auth/reset/${token}`, { body: { password: "новый-пароль-1" } })).status).toBe(200);
    expect((await call("POST", "/auth/login", { body: { email: "boss@mail.ru", password: "новый-пароль-1" } })).status).toBe(200);
    await owner.db.execute(sql`UPDATE users SET password_hash = ${await hashPassword(PASS)} WHERE email = 'boss@mail.ru'`);
  });

  it("сброс администратором — письмо участнику", async () => {
    const c = await login("boss@mail.ru");
    const users = await call("GET", "/users", { cookie: c });
    const member = users.body.members.find((m: { email: string }) => m.email === "new@mail.ru");
    const r = await call("POST", `/members/${member.userId ?? member.id}/reset-link`, { cookie: c });
    expect(r.status).toBe(200);
    expect(r.body.emailed).toBe(true);
    expect(lastLink("new@mail.ru", "reset")).toBe(r.body.token);
  });

  it("регистрация: письмо подтверждения; без подтверждения нельзя приглашать", async () => {
    const email = `reg-${Date.now()}@mail.ru`;
    const s = await call("POST", "/auth/signup", {
      body: { company: "ООО «Свет»", name: "Ольга", email, password: PASS, demo: false, acceptTerms: true },
      ip: "10.3.0.1",
    });
    expect(s.status).toBe(201);
    expect((await call("GET", "/auth/me", { cookie: s.cookie })).body.user.emailVerified).toBe(false);
    const blocked = await call("POST", "/invites", { cookie: s.cookie, body: { email: "x@mail.ru", role: "viewer" } });
    expect(blocked.status).toBe(403);

    // повторная отправка сразу — слишком часто
    expect((await call("POST", "/auth/verify/resend", { cookie: s.cookie })).status).toBe(429);

    const token = lastLink(email, "verify")!;
    expect(token).toBeTruthy();
    expect((await call("POST", `/auth/verify/${token}`)).status).toBe(200);
    expect((await call("GET", "/auth/me", { cookie: s.cookie })).body.user.emailVerified).toBe(true);
    expect((await call("POST", `/auth/verify/${token}`)).status).toBe(404);
    const ok = await call("POST", "/invites", { cookie: s.cookie, body: { email: "x@mail.ru", role: "viewer" } });
    expect(ok.status).toBe(201);
  });

  it("не больше 30 приглашений в сутки", async () => {
    const c = await login("boss@mail.ru");
    const [{ n }] = (await owner.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM invites WHERE tenant_id = ${tenant}`,
    )) as unknown as [{ n: number }];
    for (let i = n; i < 30; i++) {
      expect((await call("POST", "/invites", { cookie: c, body: { email: `bulk${i}@mail.ru`, role: "viewer" } })).status).toBe(
        201,
      );
    }
    expect((await call("POST", "/invites", { cookie: c, body: { email: "one-more@mail.ru", role: "viewer" } })).status).toBe(429);
  });

  it("почта не настроена: ссылки по-прежнему выдаются, «Забыли пароль?» недоступно", async () => {
    expect((await call("POST", "/auth/forgot", { app: plain, body: { email: "boss@mail.ru" } })).status).toBe(422);
    const c = (await call("POST", "/auth/login", { app: plain, body: { email: "boss@mail.ru", password: PASS } })).cookie!;
    await owner.db.execute(sql`DELETE FROM invites WHERE tenant_id = ${tenant}`);
    const r = await call("POST", "/invites", { app: plain, cookie: c, body: { email: "manual@mail.ru", role: "viewer" } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ emailed: false, mailError: null });
    expect(r.body.token).toBeTruthy();
  });
});
