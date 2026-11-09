import { disabledMailer, type Mailer } from "./services/mail.js";
import Fastify, { type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import type { Db, RequestContext } from "./db/client.js";
import { HttpError } from "./errors.js";
import { catalogRoutes } from "./routes/catalog.js";
import { networkRoutes } from "./routes/network.js";
import { splicingRoutes } from "./routes/splicing.js";
import { traceRoutes } from "./routes/trace.js";
import { documentRoutes } from "./routes/documents.js";
import { authRoutes, readSessionCookie } from "./routes/auth.js";
import { userRoutes } from "./routes/users.js";
import { sql } from "drizzle-orm";
import { sessionByToken, withUserTenant } from "./services/auth/auth.js";
import { atLeast, requiredRole, ROLE_LABELS, type Role } from "./services/auth/roles.js";

export interface AppOptions {
  db: Db;
  /**
   * Без входа оператор берётся из заголовка X-Tenant-Id (с правами владельца).
   * Только для разработки и тестов — в проде выключено, работает только вход.
   */
  devTenantHeader: boolean;
  /** Открыта ли самостоятельная регистрация операторов. */
  signup?: boolean;
  termsUrl?: string;
  /** Отправка писем; без неё ссылки приглашений и смены пароля копируются вручную. */
  mailer?: Mailer;
  logger?: boolean;
}

export interface AuthContext extends RequestContext {
  role: Role;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    mailer: Mailer;
    requireContext(req: FastifyRequest): AuthContext;
  }
  interface FastifyRequest {
    volsCtx?: AuthContext;
  }
}


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildApp(opts: AppOptions) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  app.decorate("db", opts.db);
  app.decorate("mailer", opts.mailer ?? disabledMailer);
  app.decorate("requireContext", (req: FastifyRequest): AuthContext => {
    if (!req.volsCtx) throw new HttpError(401, "Требуется вход");
    return req.volsCtx;
  });

  // Кто делает запрос и хватает ли прав. Маршруты входа (/auth/*) разбираются сами.
  app.addHook("preHandler", async (req) => {
    const path = req.url.split("?")[0]!;
    if (!path.startsWith("/api/v1/") || path.startsWith("/api/v1/auth/")) return;
    const ctx = await resolveContext(req);
    if (!ctx) return; // requireContext ответит 401
    const need = requiredRole(req.method, path);
    if (!atLeast(ctx.role, need)) {
      throw new HttpError(403, `Недостаточно прав: нужна роль «${ROLE_LABELS[need]}» или выше`);
    }
    req.volsCtx = ctx;
  });

  async function resolveContext(req: FastifyRequest): Promise<AuthContext | null> {
    const token = readSessionCookie(req);
    if (token) {
      const s = await sessionByToken(opts.db, token);
      if (!s || s.pending2fa) return null;
      // Изменения — только из нашего интерфейса: чужой сайт не может поставить этот заголовок (CSRF).
      if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-requested-with"] !== "vols") {
        throw new HttpError(403, "Запрос отклонён: нет заголовка клиента");
      }
      if (!s.tenantId) throw new HttpError(403, "Нет доступа ни к одному оператору");
      const [m] = await withUserTenant(opts.db, s.userId, s.tenantId, (tx) =>
        tx.execute<{ role: Role; require2fa: boolean; has2fa: boolean }>(sql`
          SELECT m.role, t.require_2fa AS "require2fa", (u.totp_enabled_at IS NOT NULL) AS "has2fa"
          FROM memberships m JOIN tenants t ON t.id = m.tenant_id JOIN users u ON u.id = m.user_id
          WHERE m.tenant_id = ${s.tenantId} AND m.user_id = ${s.userId}`),
      );
      if (!m) throw new HttpError(403, "Нет доступа к этому оператору");
      if (m.require2fa && !m.has2fa) {
        throw new HttpError(403, "У оператора обязателен двухфакторный вход — настройте его в профиле");
      }
      return { tenantId: s.tenantId, userId: s.userId, role: m.role };
    }
    const tenantId = req.headers["x-tenant-id"];
    if (opts.devTenantHeader && typeof tenantId === "string" && UUID_RE.test(tenantId)) {
      return { tenantId, userId: null, role: "owner" };
    }
    return null;
  }

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "validation", issues: err.issues });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    // Ошибки ограничений и триггеров БД — понятные сообщения для пользователя.
    const pg = findPgError(err);
    if (pg?.code === "23503" && /violates foreign key constraint/.test(pg.message)) {
      // Ссылка на несуществующий объект: обычно его удалили в другой вкладке или другим пользователем.
      app.log.warn(err);
      return reply.code(409).send({
        error: "Связанный объект не найден — возможно, его только что удалили. Обновите страницу и повторите.",
        code: pg.code,
      });
    }
    if (pg) {
      const status = pg.code === "23505" ? 409 : 422;
      return reply.code(status).send({ error: pg.message, code: pg.code });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "Внутренняя ошибка" });
  });

  app.get("/health", async () => ({ ok: true, version: process.env.VOLS_VERSION ?? "dev" }));
  app.register(authRoutes, { prefix: "/api/v1/auth", signup: opts.signup ?? false, termsUrl: opts.termsUrl });
  app.register(userRoutes, { prefix: "/api/v1" });
  app.register(catalogRoutes, { prefix: "/api/v1" });
  app.register(networkRoutes, { prefix: "/api/v1" });
  app.register(splicingRoutes, { prefix: "/api/v1" });
  app.register(traceRoutes, { prefix: "/api/v1" });
  app.register(documentRoutes, { prefix: "/api/v1" });
  return app;
}

function findPgError(err: unknown): { code: string; message: string } | null {
  for (let e: any = err, i = 0; e && i < 5; e = e.cause, i++) {
    if (typeof e.code === "string" && /^2[0-9A-Z]{4}$/.test(e.code)) return { code: e.code, message: e.message };
  }
  return null;
}
