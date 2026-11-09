import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { HttpError } from "../errors.js";
import * as auth from "../services/auth/auth.js";
import { deliver, resetMail, verifyMail } from "../services/mail.js";

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

export const authRoutes: FastifyPluginAsync<{ signup: boolean; termsUrl?: string }> = async (app, opts) => {
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

  // Что показать на странице входа: открыта ли регистрация, ссылка на условия.
  app.get("/config", async () => ({ signup: opts.signup, termsUrl: opts.termsUrl ?? null, mail: app.mailer.enabled }));

  /** Письмо со ссылкой подтверждения e-mail. */
  const sendVerification = async (userId: string) => {
    if (!app.mailer.enabled) return;
    const v = await auth.createVerification(app.db, userId);
    if (!v) return;
    const url = `${app.mailer.publicUrl}/verify/${v.token}`;
    await deliver(app.mailer, verifyMail({ to: v.email, name: v.name, tenantName: v.tenantName, url, hours: auth.VERIFY_HOURS }), app.log);
  };

  /** Регистрация оператора: не чаще 5 раз в час с одного адреса; скрытое поле website — ловушка для ботов. */
  const signups = new Map<string, number[]>();
  app.post("/signup", async (req, reply) => {
    if (!opts.signup) throw new HttpError(403, "Регистрация закрыта. Обратитесь к администратору сервиса.");
    const v = z
      .object({
        company: z.string().trim().min(2, "Название компании — не короче 2 символов").max(200),
        name: z.string().trim().min(2, "Укажите имя").max(120),
        email: z.email("Некорректный e-mail").max(200),
        password,
        demo: z.boolean().default(true),
        acceptTerms: z.literal(true, { error: "Нужно согласие с условиями и обработкой персональных данных" }),
        website: z.string().max(200).optional(),
      })
      .parse(req.body);
    const now = Date.now();
    const recent = (signups.get(req.ip) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= 5) throw new HttpError(429, "Слишком много регистраций с этого адреса. Попробуйте через час.");
    signups.set(req.ip, [...recent, now]);
    if (v.website) throw new HttpError(400, "Не удалось зарегистрироваться"); // заполнил бот
    const r = await auth.signup(app.db, v, meta(req));
    setSessionCookie(req, reply, r.token);
    await sendVerification(r.userId).catch((e) => app.log.error(e));
    return reply.code(201).send({ ok: true });
  });

  app.post("/logout", async (req, reply) => {
    const token = readSessionCookie(req);
    const s = token ? await auth.sessionByToken(app.db, token) : null;
    if (s) await auth.deleteSession(app.db, s.sessionId);
    setSessionCookie(req, reply, null);
    return { ok: true };
  });

  app.get("/me", async (req) => auth.me(app.db, await session(req)));

  // Подтверждение e-mail: повторная отправка (из профиля) и переход по ссылке.
  app.post("/verify/resend", async (req) => {
    if (!app.mailer.enabled) throw new HttpError(422, "Отправка писем не настроена");
    await sendVerification((await session(req)).userId);
    return { ok: true };
  });
  app.post("/verify/:token", async (req) => {
    const { token } = z.object({ token: z.string().min(20).max(100) }).parse(req.params);
    await limited([`verify:${req.ip}`], () => auth.verifyEmail(app.db, token));
    return { ok: true };
  });

  // «Забыли пароль?» — ответ одинаковый, есть такой пользователь или нет.
  app.post("/forgot", async (req) => {
    if (!app.mailer.enabled) throw new HttpError(422, "Восстановление по почте не настроено — обратитесь к администратору");
    const { email } = z.object({ email: z.string().trim().min(3).max(200) }).parse(req.body);
    checkLimit([`forgot:${req.ip}`]);
    recordFailure([`forgot:${req.ip}`]); // каждый запрос считается: не больше 10 за 15 минут с адреса
    const r = await auth.forgotPassword(app.db, email);
    if (r) {
      const url = `${app.mailer.publicUrl}/reset/${r.token}`;
      await deliver(app.mailer, resetMail({ to: r.email, name: r.name, url, hours: r.hours, byAdmin: false }), app.log);
    }
    return { ok: true };
  });

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
