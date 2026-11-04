import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";
import { env } from "./env.js";

const { db, close } = createDb(env.DATABASE_URL);
const app = buildApp({ db, devTenantHeader: process.env.NODE_ENV !== "production", logger: true });

const shutdown = async () => {
  await app.close();
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.API_PORT, host: env.API_HOST });
