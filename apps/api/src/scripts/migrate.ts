import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../db/client.js";
import { env } from "../env.js";

// Папка миграций рядом с исходниками (src/scripts → ../../migrations) или со сборкой (dist → ../migrations).
const migrationsFolder = ["../../migrations", "../migrations"]
  .map((p) => fileURLToPath(new URL(p, import.meta.url)))
  .find((p) => existsSync(`${p}/meta/_journal.json`))!;

export async function runMigrations(url: string) {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations(env.MIGRATION_DATABASE_URL);
  console.log("Миграции применены");
}
