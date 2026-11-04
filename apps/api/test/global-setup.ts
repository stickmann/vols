import postgres from "postgres";
import { runMigrations } from "../src/scripts/migrate.js";
import { testUrls } from "./helpers.js";

/** Пересоздаёт тестовую базу и накатывает миграции. Нужен запущенный Postgres с PostGIS (docker compose up db). */
export default async function setup() {
  const { admin, owner, dbName } = testUrls();
  const sql = postgres(admin, { max: 1, onnotice: () => {} });
  await sql.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await sql.unsafe(`CREATE DATABASE ${dbName}`);
  await sql.end();
  await runMigrations(owner);
}
