import Fastify, { type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import type { Db, RequestContext } from "./db/client.js";
import { HttpError } from "./errors.js";
import { catalogRoutes } from "./routes/catalog.js";
import { networkRoutes } from "./routes/network.js";
import { splicingRoutes } from "./routes/splicing.js";
import { traceRoutes } from "./routes/trace.js";
import { documentRoutes } from "./routes/documents.js";

export interface AppOptions {
  db: Db;
  /**
   * Пока нет авторизации: оператор берётся из заголовка X-Tenant-Id.
   * Только для разработки — в проде без авторизации доступ закрыт.
   */
  devTenantHeader: boolean;
  logger?: boolean;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    requireContext(req: FastifyRequest): RequestContext;
  }
}


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildApp(opts: AppOptions) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  app.decorate("db", opts.db);
  app.decorate("requireContext", (req: FastifyRequest): RequestContext => {
    const tenantId = req.headers["x-tenant-id"];
    if (!opts.devTenantHeader || typeof tenantId !== "string" || !UUID_RE.test(tenantId)) {
      throw new HttpError(401, "Требуется авторизация");
    }
    return { tenantId };
  });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "validation", issues: err.issues });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    // Ошибки ограничений и триггеров БД — понятные сообщения для пользователя.
    const pg = findPgError(err);
    if (pg) {
      const status = pg.code === "23505" ? 409 : 422;
      return reply.code(status).send({ error: pg.message, code: pg.code });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "Внутренняя ошибка" });
  });

  app.get("/health", async () => ({ ok: true, version: process.env.VOLS_VERSION ?? "dev" }));
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
