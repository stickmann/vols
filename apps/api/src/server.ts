import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";
import { env } from "./env.js";

const { db, close } = createDb(env.DATABASE_URL);
const app = buildApp({ db, devTenantHeader: env.ALLOW_TENANT_HEADER, signup: env.SIGNUP === "open", termsUrl: env.TERMS_URL, logger: true });
if (env.ALLOW_TENANT_HEADER && process.env.NODE_ENV === "production") {
  app.log.warn("ALLOW_TENANT_HEADER=true: оператор берётся из заголовка без входа. Только для просмотра за паролем веб-сервера.");
}

const shutdown = async () => {
  await app.close();
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.API_PORT, host: env.API_HOST });
