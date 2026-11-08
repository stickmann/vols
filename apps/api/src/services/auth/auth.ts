import { sql } from "drizzle-orm";
import { withTenant, type Db, type Tx } from "../../db/client.js";
import { HttpError } from "../../errors.js";
import {
  hashPassword,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUrl,
  randomToken,
  sha256,
  verifyPassword,
  verifyTotp,
} from "./crypto.js";
import { atLeast, type Role } from "./roles.js";
import { assertUserSlot, tenantUsage } from "../plans.js";

export const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const RESET_HOURS = 24;
export const MIN_PASSWORD = 8;

/** Транзакция от имени пользователя: видны его членства у всех операторов (RLS own_memberships). */
export function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true), set_config('app.tenant_id', '', true)`);
    return fn(tx);
  });
}

/** Транзакция от имени пользователя у конкретного оператора (как обычный запрос). */
export function withUserTenant<T>(db: Db, userId: string, tenantId: string, fn: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true), set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

const normEmail = (e: string) => e.trim().toLowerCase();
function checkPassword(p: string) {
  if (p.length < MIN_PASSWORD) throw new HttpError(422, `Пароль — не короче ${MIN_PASSWORD} символов`);
  if (p.length > 200) throw new HttpError(422, "Слишком длинный пароль");
}

type UserRow = {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  totpSecret: string | null;
  totpEnabledAt: string | null;
  totpLastStep: number | null;
  recoveryCodes: string[] | null;
  disabledAt: string | null;
};

async function userByEmail(db: Db | Tx, email: string) {
  const [u] = await db.execute<UserRow>(sql`
    SELECT id, email, name, password_hash AS "passwordHash", totp_secret AS "totpSecret",
           totp_enabled_at AS "totpEnabledAt", totp_last_step AS "totpLastStep",
           recovery_codes AS "recoveryCodes", disabled_at AS "disabledAt"
    FROM users WHERE email = ${normEmail(email)}`);
  return u;
}

async function userById(db: Db | Tx, id: string) {
  const [u] = await db.execute<UserRow>(sql`
    SELECT id, email, name, password_hash AS "passwordHash", totp_secret AS "totpSecret",
           totp_enabled_at AS "totpEnabledAt", totp_last_step AS "totpLastStep",
           recovery_codes AS "recoveryCodes", disabled_at AS "disabledAt"
    FROM users WHERE id = ${id}`);
  return u;
}

/** Членства пользователя: оператор, его название, роль. */
export async function userMemberships(db: Db, userId: string) {
  return withUser(db, userId, (tx) =>
    tx.execute<{ tenantId: string; name: string; role: Role; require2fa: boolean }>(sql`
      SELECT m.tenant_id AS "tenantId", t.name, m.role, t.require_2fa AS "require2fa"
      FROM memberships m JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = ${userId} ORDER BY t.name`),
  );
}

// ---------------------------------------------------------------- сессии

export type SessionInfo = {
  sessionId: string;
  userId: string;
  tenantId: string | null;
  pending2fa: boolean;
};

export async function createSession(
  db: Db,
  userId: string,
  opts: { tenantId: string | null; pending2fa: boolean; ip?: string; userAgent?: string },
) {
  const token = randomToken();
  await db.execute(sql`
    INSERT INTO sessions (token_hash, user_id, tenant_id, pending_2fa, ip, user_agent, expires_at)
    VALUES (${sha256(token)}, ${userId}, ${opts.tenantId}, ${opts.pending2fa}, ${opts.ip ?? null},
            ${opts.userAgent?.slice(0, 300) ?? null}, now() + make_interval(days => ${SESSION_DAYS}))`);
  return token;
}

/** Сессия по токену из cookie; продлевается при активности (не чаще раза в 5 минут). */
export async function sessionByToken(db: Db, token: string): Promise<SessionInfo | null> {
  const [s] = await db.execute<SessionInfo & { stale: boolean }>(sql`
    SELECT s.id AS "sessionId", s.user_id AS "userId", s.tenant_id AS "tenantId", s.pending_2fa AS "pending2fa",
           s.last_seen_at < now() - interval '5 minutes' AS stale
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha256(token)} AND s.expires_at > now() AND u.disabled_at IS NULL`);
  if (!s) return null;
  if (s.stale) {
    await db.execute(sql`
      UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => ${SESSION_DAYS}) WHERE id = ${s.sessionId}`);
  }
  return { sessionId: s.sessionId, userId: s.userId, tenantId: s.tenantId, pending2fa: s.pending2fa };
}

export const deleteSession = (db: Db, sessionId: string) => db.execute(sql`DELETE FROM sessions WHERE id = ${sessionId}`);

// ---------------------------------------------------------------- вход

/** Проверить пароль; если включён 2FA — сессия ждёт код. Возвращает токен и нужен ли код. */
export async function login(db: Db, email: string, password: string, meta: { ip?: string; userAgent?: string }) {
  const u = await userByEmail(db, email);
  // Одинаковый ответ и время для «нет такого» и «неверный пароль».
  const ok = await verifyPassword(password, u?.passwordHash ?? FAKE_HASH);
  if (!u || !ok || !u.passwordHash) throw new HttpError(401, "Неверный e-mail или пароль");
  if (u.disabledAt) throw new HttpError(403, "Учётная запись отключена");
  const memberships = await userMemberships(db, u.id);
  // Оператор, с которым пользователь работал в прошлый раз, иначе первый по алфавиту.
  const [last] = await db.execute<{ tenantId: string }>(sql`
    SELECT tenant_id AS "tenantId" FROM sessions WHERE user_id = ${u.id} AND tenant_id IS NOT NULL ORDER BY last_seen_at DESC LIMIT 1`);
  const tenantId = memberships.find((m) => m.tenantId === last?.tenantId)?.tenantId ?? memberships[0]?.tenantId ?? null;
  const pending2fa = !!u.totpEnabledAt;
  const token = await createSession(db, u.id, { tenantId, pending2fa, ...meta });
  if (!pending2fa) await db.execute(sql`UPDATE users SET last_login_at = now() WHERE id = ${u.id}`);
  return { token, twoFactorRequired: pending2fa };
}
const FAKE_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

/** Второй шаг входа: код из приложения или код восстановления. */
export async function completeTwoFactor(db: Db, s: SessionInfo, code: string) {
  if (!s.pending2fa) return;
  const u = await userById(db, s.userId);
  if (!u?.totpSecret || !u.totpEnabledAt) throw new HttpError(422, "Двухфакторный вход не настроен");
  if (!(await useSecondFactor(db, u, code))) throw new HttpError(401, "Неверный код");
  await db.execute(sql`UPDATE sessions SET pending_2fa = false WHERE id = ${s.sessionId}`);
  await db.execute(sql`UPDATE users SET last_login_at = now() WHERE id = ${u.id}`);
}

/** Код TOTP (одноразово по шагу) или код восстановления (сгорает). */
async function useSecondFactor(db: Db | Tx, u: UserRow, code: string) {
  const step = verifyTotp(u.totpSecret!, code, u.totpLastStep);
  if (step != null) {
    await db.execute(sql`UPDATE users SET totp_last_step = ${step} WHERE id = ${u.id}`);
    return true;
  }
  const h = sha256(code.trim().toLowerCase());
  if (u.recoveryCodes?.includes(h)) {
    await db.execute(sql`UPDATE users SET recovery_codes = ${JSON.stringify(u.recoveryCodes.filter((x) => x !== h))}::jsonb WHERE id = ${u.id}`);
    return true;
  }
  return false;
}

export async function switchTenant(db: Db, s: SessionInfo, tenantId: string) {
  const m = (await userMemberships(db, s.userId)).find((x) => x.tenantId === tenantId);
  if (!m) throw new HttpError(403, "Нет доступа к этому оператору");
  await db.execute(sql`UPDATE sessions SET tenant_id = ${tenantId}, last_seen_at = now() WHERE id = ${s.sessionId}`);
}

export async function me(db: Db, s: SessionInfo) {
  const u = (await userById(db, s.userId))!;
  const memberships = await userMemberships(db, s.userId);
  const current = memberships.find((m) => m.tenantId === s.tenantId) ?? null;
  const usage = current ? await withUserTenant(db, s.userId, current.tenantId, (tx) => tenantUsage(tx)) : null;
  return {
    usage,
    user: { id: u.id, email: u.email, name: u.name, twoFactor: !!u.totpEnabledAt, recoveryCodesLeft: u.recoveryCodes?.length ?? 0 },
    tenant: current ? { id: current.tenantId, name: current.name, require2fa: current.require2fa } : null,
    role: current?.role ?? null,
    memberships: memberships.map((m) => ({ tenantId: m.tenantId, name: m.name, role: m.role })),
    mustSetup2fa: !!current?.require2fa && !u.totpEnabledAt,
  };
}

// ---------------------------------------------------------------- пароль и 2FA

export async function changePassword(db: Db, s: SessionInfo, current: string, next: string) {
  const u = (await userById(db, s.userId))!;
  if (!(await verifyPassword(current, u.passwordHash))) throw new HttpError(401, "Текущий пароль неверный");
  checkPassword(next);
  await db.execute(sql`UPDATE users SET password_hash = ${await hashPassword(next)} WHERE id = ${u.id}`);
  // Остальные сессии пользователя закрываются.
  await db.execute(sql`DELETE FROM sessions WHERE user_id = ${u.id} AND id <> ${s.sessionId}`);
}

export async function startTwoFactorSetup(db: Db, s: SessionInfo) {
  const u = (await userById(db, s.userId))!;
  if (u.totpEnabledAt) throw new HttpError(409, "Двухфакторный вход уже включён");
  const secret = newTotpSecret();
  await db.execute(sql`UPDATE users SET totp_secret = ${secret}, totp_last_step = NULL WHERE id = ${u.id}`);
  return { secret, otpauthUrl: otpauthUrl(secret, u.email) };
}

export async function enableTwoFactor(db: Db, s: SessionInfo, code: string) {
  const u = (await userById(db, s.userId))!;
  if (u.totpEnabledAt) throw new HttpError(409, "Двухфакторный вход уже включён");
  if (!u.totpSecret) throw new HttpError(422, "Сначала начните настройку");
  const step = verifyTotp(u.totpSecret, code, null);
  if (step == null) throw new HttpError(422, "Код не подошёл. Проверьте время на телефоне и введите новый код.");
  const codes = newRecoveryCodes();
  await db.execute(sql`
    UPDATE users SET totp_enabled_at = now(), totp_last_step = ${step}, recovery_codes = ${JSON.stringify(codes.hashed)}::jsonb
    WHERE id = ${u.id}`);
  return { recoveryCodes: codes.plain };
}

export async function disableTwoFactor(db: Db, s: SessionInfo, password: string) {
  const u = (await userById(db, s.userId))!;
  if (!(await verifyPassword(password, u.passwordHash))) throw new HttpError(401, "Пароль неверный");
  if ((await userMemberships(db, u.id)).some((m) => m.require2fa))
    throw new HttpError(409, "У вашего оператора двухфакторный вход обязателен — отключить нельзя");
  await db.execute(sql`
    UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, recovery_codes = NULL WHERE id = ${u.id}`);
}

// ---------------------------------------------------------------- приглашения

export async function createInvite(db: Db, tenantId: string, byUserId: string | null, byRole: Role, email: string, role: Role) {
  if (role === "owner" && byRole !== "owner") throw new HttpError(403, "Назначить владельца может только владелец");
  // Ожидающие приглашения занимают места тарифа.
  const [{ n: pending } = { n: 0 }] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM invites WHERE tenant_id = ${tenantId} AND accepted_at IS NULL AND expires_at > now()`);
  await withTenant(db, { tenantId }, (tx) => assertUserSlot(tx, pending));
  const token = randomToken();
  await db.execute(sql`
    INSERT INTO invites (tenant_id, email, role, token_hash, created_by, expires_at)
    VALUES (${tenantId}, ${normEmail(email)}, ${role}::member_role, ${sha256(token)}, ${byUserId}, now() + make_interval(days => ${INVITE_DAYS}))`);
  return { token, expiresInDays: INVITE_DAYS };
}

export async function listInvites(db: Db, tenantId: string) {
  return db.execute(sql`
    SELECT id, email, role, created_at AS "createdAt", expires_at AS "expiresAt"
    FROM invites WHERE tenant_id = ${tenantId} AND accepted_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC`);
}

export async function revokeInvite(db: Db, tenantId: string, id: string) {
  const r = await db.execute(sql`DELETE FROM invites WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING id`);
  if (!r.length) throw new HttpError(404, "Приглашение не найдено");
}

async function inviteByToken(db: Db, token: string) {
  const [i] = await db.execute<{ id: string; tenantId: string; email: string; role: Role }>(sql`
    SELECT id, tenant_id AS "tenantId", email, role FROM invites
    WHERE token_hash = ${sha256(token)} AND accepted_at IS NULL AND expires_at > now()`);
  if (!i) throw new HttpError(404, "Приглашение не найдено или истекло");
  // Название оператора закрыто RLS — читаем в контексте оператора из приглашения.
  const [t] = await withTenant(db, { tenantId: i.tenantId }, (tx) => tx.execute<{ name: string }>(sql`SELECT name FROM tenants`));
  return { ...i, tenantName: t?.name ?? "" };
}

export async function inviteInfo(db: Db, token: string) {
  const i = await inviteByToken(db, token);
  const u = await userByEmail(db, i.email);
  return { email: i.email, role: i.role, tenantName: i.tenantName, hasAccount: !!u?.passwordHash };
}

/** Принять приглашение: новый пользователь задаёт имя и пароль, существующий — вводит свой пароль. */
export async function acceptInvite(db: Db, token: string, v: { name?: string; password: string }, meta: { ip?: string; userAgent?: string }) {
  const i = await inviteByToken(db, token);
  let u = await userByEmail(db, i.email);
  if (u?.passwordHash) {
    if (!(await verifyPassword(v.password, u.passwordHash))) throw new HttpError(401, "Неверный пароль от вашей учётной записи");
  } else {
    checkPassword(v.password);
    const name = v.name?.trim();
    if (!name) throw new HttpError(422, "Укажите имя");
    const hash = await hashPassword(v.password);
    if (u) await db.execute(sql`UPDATE users SET name = ${name}, password_hash = ${hash} WHERE id = ${u.id}`);
    else await db.execute(sql`INSERT INTO users (email, name, password_hash) VALUES (${i.email}, ${name}, ${hash})`);
    u = (await userByEmail(db, i.email))!;
  }
  const userId = u.id;
  await withUserTenant(db, userId, i.tenantId, async (tx) => {
    const [already] = await tx.execute(sql`SELECT 1 FROM memberships WHERE tenant_id = ${i.tenantId} AND user_id = ${userId}`);
    if (!already) await assertUserSlot(tx, 0);
    await tx.execute(sql`
      INSERT INTO memberships (tenant_id, user_id, role) VALUES (${i.tenantId}, ${userId}, ${i.role}::member_role)
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role`);
  });
  await db.execute(sql`UPDATE invites SET accepted_at = now() WHERE id = ${i.id}`);
  const pending2fa = !!u.totpEnabledAt;
  return { token: await createSession(db, userId, { tenantId: i.tenantId, pending2fa, ...meta }), twoFactorRequired: pending2fa };
}

// ---------------------------------------------------------------- сброс пароля по ссылке

export async function createResetLink(db: Db, tenantId: string, byUserId: string | null, userId: string) {
  const [m] = await withUserTenant(db, byUserId ?? userId, tenantId, (tx) =>
    tx.execute(sql`SELECT 1 FROM memberships WHERE tenant_id = ${tenantId} AND user_id = ${userId}`),
  );
  if (!m) throw new HttpError(404, "Пользователь не найден");
  const token = randomToken();
  await db.execute(sql`
    INSERT INTO password_resets (user_id, token_hash, created_by, expires_at)
    VALUES (${userId}, ${sha256(token)}, ${byUserId}, now() + make_interval(hours => ${RESET_HOURS}))`);
  return { token, expiresInHours: RESET_HOURS };
}

async function resetByToken(db: Db, token: string) {
  const [r] = await db.execute<{ id: string; userId: string; email: string }>(sql`
    SELECT r.id, r.user_id AS "userId", u.email FROM password_resets r JOIN users u ON u.id = r.user_id
    WHERE r.token_hash = ${sha256(token)} AND r.used_at IS NULL AND r.expires_at > now()`);
  if (!r) throw new HttpError(404, "Ссылка не найдена или истекла");
  return r;
}

export const resetInfo = async (db: Db, token: string) => ({ email: (await resetByToken(db, token)).email });

export async function resetPassword(db: Db, token: string, password: string) {
  const r = await resetByToken(db, token);
  checkPassword(password);
  await db.execute(sql`UPDATE users SET password_hash = ${await hashPassword(password)} WHERE id = ${r.userId}`);
  await db.execute(sql`UPDATE password_resets SET used_at = now() WHERE id = ${r.id}`);
  await db.execute(sql`DELETE FROM sessions WHERE user_id = ${r.userId}`);
}

// ---------------------------------------------------------------- участники оператора

export async function listMembers(tx: Tx) {
  return tx.execute(sql`
    SELECT u.id, u.email, u.name, m.role, (u.totp_enabled_at IS NOT NULL) AS "twoFactor",
           u.last_login_at AS "lastLoginAt", u.password_hash IS NULL AS "pendingPassword"
    FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = current_tenant_id()
    ORDER BY array_position(ARRAY['owner','admin','designer','technician','viewer']::member_role[], m.role), u.name`);
}

async function memberRole(tx: Tx, userId: string) {
  const [m] = await tx.execute<{ role: Role }>(sql`SELECT role FROM memberships WHERE tenant_id = current_tenant_id() AND user_id = ${userId}`);
  if (!m) throw new HttpError(404, "Пользователь не найден");
  return m.role;
}
const owners = async (tx: Tx) =>
  (await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM memberships WHERE tenant_id = current_tenant_id() AND role = 'owner'`))[0]!.n;

export async function setMemberRole(tx: Tx, byRole: Role, userId: string, role: Role) {
  const cur = await memberRole(tx, userId);
  if ((cur === "owner" || role === "owner") && byRole !== "owner") throw new HttpError(403, "Владельца назначает и снимает только владелец");
  if (cur === "owner" && role !== "owner" && (await owners(tx)) <= 1) throw new HttpError(409, "Нельзя снять последнего владельца");
  await tx.execute(sql`UPDATE memberships SET role = ${role}::member_role WHERE tenant_id = current_tenant_id() AND user_id = ${userId}`);
}

export async function removeMember(tx: Tx, byRole: Role, userId: string) {
  const cur = await memberRole(tx, userId);
  if (cur === "owner" && byRole !== "owner") throw new HttpError(403, "Владельца может удалить только владелец");
  if (cur === "owner" && (await owners(tx)) <= 1) throw new HttpError(409, "Нельзя удалить последнего владельца");
  await tx.execute(sql`DELETE FROM memberships WHERE tenant_id = current_tenant_id() AND user_id = ${userId}`);
  await tx.execute(sql`DELETE FROM sessions WHERE user_id = ${userId} AND tenant_id = current_tenant_id()`);
}

export async function updateTenant(tx: Tx, v: { name?: string; require2fa?: boolean }) {
  await tx.execute(sql`
    UPDATE tenants SET
      name = coalesce(${v.name?.trim() || null}, name),
      require_2fa = coalesce(${v.require2fa ?? null}::boolean, require_2fa)
    WHERE id = current_tenant_id()`);
}

export { atLeast };

// ---------------------------------------------------------------- регистрация оператора

export interface SignupInput {
  company: string;
  name: string;
  email: string;
  password: string;
  demo: boolean;
}

/**
 * Новый оператор на бесплатном тарифе и его владелец. Если что-то не удалось на полпути,
 * созданный оператор удаляется (каскадом — справочники, сеть, членства).
 */
export async function signup(db: Db, v: SignupInput, meta: { ip?: string; userAgent?: string }) {
  checkPassword(v.password);
  const email = normEmail(v.email);
  if (await userByEmail(db, email)) {
    throw new HttpError(409, "Этот e-mail уже зарегистрирован — войдите. Чтобы работать у другого оператора, попросите у него приглашение.");
  }
  const { provisionTenant } = await import("../tenants.js");
  const { createDemoNetwork } = await import("../demo-network.js");
  const tenantId = await provisionTenant(db, { name: v.company.trim(), slug: `op-${randomToken().slice(0, 10).toLowerCase()}`, plan: "free" });
  try {
    const [u] = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, name, password_hash, terms_accepted_at)
      VALUES (${email}, ${v.name.trim()}, ${await hashPassword(v.password)}, now()) RETURNING id`);
    const userId = u!.id;
    await withUserTenant(db, userId, tenantId, async (tx) => {
      await tx.execute(sql`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${tenantId}, ${userId}, 'owner')`);
      if (v.demo) await createDemoNetwork(tx, tenantId);
    });
    await db.execute(sql`UPDATE users SET last_login_at = now() WHERE id = ${userId}`);
    return { token: await createSession(db, userId, { tenantId, pending2fa: false, ...meta }), tenantId };
  } catch (e) {
    await withTenant(db, { tenantId }, (tx) => tx.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}`)).catch(() => {});
    await db.execute(sql`DELETE FROM users WHERE email = ${email} AND NOT EXISTS (SELECT 1 FROM sessions WHERE user_id = users.id)`).catch(() => {});
    throw e;
  }
}
