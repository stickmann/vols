import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../db/client.js";
import { env } from "../env.js";

export async function runMigrations(url: string) {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../migrations", import.meta.url)) });
  } finally {
    await close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations(env.MIGRATION_DATABASE_URL);
  console.log("Миграции применены");
}
