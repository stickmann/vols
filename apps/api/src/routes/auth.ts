import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { HttpError } from "../errors.js";
import * as auth from "../services/auth/auth.js";

const COOKIE = "vols_session";

export function readSessionCookie(req: FastifyRequest): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string | null) {
  // Secure — когда сайт открыт по HTTPS (за Caddy); по IP без HTTPS cookie тоже должна работать.
  const secure = req.protocol === "https" ? "; Secure" : "";
  const value = token
    ? `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${auth.SESSION_DAYS * 86400}${secure}`
    : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  reply.header("set-cookie", value);
}

/**
 * Не больше 10 неудачных попыток за 15 минут с одного адреса и на один e-mail: подбор пароля
 * упирается в лимит, а обычный вход (удачный) лимит не тратит.
 */
const failures = new Map<string, number[]>();
const WINDOW = 15 * 60_000;
function checkLimit(keys: string[]) {
  const now = Date.now();
  for (const k of keys) {
    const list = (failures.get(k) ?? []).filter((t) => now - t < WINDOW);
    failures.set(k, list);
    if (list.length >= 10) throw new HttpError(429, "Слишком много неудачных попыток. Подождите 15 минут.");
  }
}
function recordFailure(keys: string[]) {
  for (const k of keys) failures.set(k, [...(failures.get(k) ?? []), Date.now()]);
  if (failures.size > 10_000) failures.clear();
}
/** Выполнить проверку с учётом лимита: неудача (401) засчитывается. */
async function limited<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
  checkLimit(keys);
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError && e.statusCode === 401) recordFailure(keys);
    throw e;
  }
}

const meta = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers["user-agent"] });
const password = z.string().min(1).max(200);

export const authRoutes: FastifyPluginAsync = async (app) => {
  const session = async (req: FastifyRequest, opts: { allowPending?: boolean } = {}) => {
    const token = readSessionCookie(req);
    const s = token ? await auth.sessionByToken(app.db, token) : null;
    if (!s || (s.pending2fa && !opts.allowPending)) throw new HttpError(401, "Требуется вход");
    if (req.method !== "GET" && req.headers["x-requested-with"] !== "vols") throw new HttpError(403, "Запрос отклонён: нет заголовка клиента");
    return s;
  };

  app.post("/login", async (req, reply) => {
    const v = z.object({ email: z.string().trim().min(3).max(200), password }).parse(req.body);
    const r = await limited([`ip:${req.ip}`, `email:${v.email.toLowerCase()}`], () => auth.login(app.db, v.email, v.password, meta(req)));
    setSessionCookie(req, reply, r.token);
    return { twoFactorRequired: r.twoFactorRequired };
  });

  app.post("/login/2fa", async (req) => {
    const { code } = z.object({ code: z.string().trim().min(6).max(20) }).parse(req.body);
    const s = await session(req, { allowPending: true });
    await limited([`2fa:${req.ip}`, `2fa:${s.userId}`], () => auth.completeTwoFactor(app.db, s, code));
    return { ok: true };
  });

  app.post("/logout", async (req, reply) => {
    const token = readSessionCookie(req);
    const s = token ? await auth.sessionByToken(app.db, token) : null;
    if (s) await auth.deleteSession(app.db, s.sessionId);
    setSessionCookie(req, reply, null);
    return { ok: true };
  });

  app.get("/me", async (req) => auth.me(app.db, await session(req)));

  app.post("/switch-tenant", async (req) => {
    const { tenantId } = z.object({ tenantId: z.uuid() }).parse(req.body);
    await auth.switchTenant(app.db, await session(req), tenantId);
    return { ok: true };
  });

  app.post("/password", async (req) => {
    const v = z.object({ current: password, next: password }).parse(req.body);
    await auth.changePassword(app.db, await session(req), v.current, v.next);
    return { ok: true };
  });

  app.post("/2fa/setup", async (req) => auth.startTwoFactorSetup(app.db, await session(req)));
  app.post("/2fa/enable", async (req) => {
    const { code } = z.object({ code: z.string().trim().min(6).max(10) }).parse(req.body);
    return auth.enableTwoFactor(app.db, await session(req), code);
  });
  app.post("/2fa/disable", async (req) => {
    const v = z.object({ password }).parse(req.body);
    await auth.disableTwoFactor(app.db, await session(req), v.password);
    return { ok: true };
  });

  // Приглашение и сброс пароля — по ссылке, без входа.
  const tokenParams = z.object({ token: z.string().min(20).max(100) });
  app.get("/invites/:token", async (req) => auth.inviteInfo(app.db, tokenParams.parse(req.params).token));
  app.post("/invites/:token/accept", async (req, reply) => {
    const { token } = tokenParams.parse(req.params);
    const v = z.object({ name: z.string().trim().max(120).optional(), password }).parse(req.body);
    const r = await limited([`invite:${req.ip}`], () => auth.acceptInvite(app.db, token, v, meta(req)));
    setSessionCookie(req, reply, r.token);
    return { twoFactorRequired: r.twoFactorRequired };
  });
  app.get("/reset/:token", async (req) => auth.resetInfo(app.db, tokenParams.parse(req.params).token));
  app.post("/reset/:token", async (req) => {
    const { token } = tokenParams.parse(req.params);
    const v = z.object({ password }).parse(req.body);
    await limited([`reset:${req.ip}`], () => auth.resetPassword(app.db, token, v.password));
    return { ok: true };
  });
};
