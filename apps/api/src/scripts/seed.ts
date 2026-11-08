import { DEMO_TENANT_ID } from "@vols/shared";
import { sql } from "drizzle-orm";
import { createDb, withTenant } from "../db/client.js";
import { env } from "../env.js";
import { createDemoNetwork } from "../services/demo-network.js";
import { provisionTenant } from "../services/tenants.js";
import { hashPassword } from "../services/auth/crypto.js";

const SLUG = "demo";
/** Вход для разработки (только вне продакшена): demo@vols.local / demo-password. */
export const DEV_USER = { email: "demo@vols.local", name: "Демо-пользователь", password: "demo-password" };

// Проверка существования — под владельцем: под ролью приложения без контекста tenants не видны.
const owner = createDb(env.MIGRATION_DATABASE_URL, { max: 1 });
const existing = await owner.db.execute<{ id: string }>(sql`SELECT id FROM tenants WHERE slug = ${SLUG} OR id = ${DEMO_TENANT_ID}`);
await owner.close();

if (existing.length > 0) {
  console.log(`Демо-оператор уже есть: ${existing[0]!.id}`);
} else {
  const app = createDb(env.DATABASE_URL, { max: 1 });
  const tenantId = await provisionTenant(app.db, { name: "Демо-оператор", slug: SLUG, id: DEMO_TENANT_ID });
  await withTenant(app.db, { tenantId }, (tx) => createDemoNetwork(tx, tenantId));
  await app.close();
  console.log(`Создан демо-оператор: ${tenantId}`);
  console.log(`Для запросов к API: заголовок X-Tenant-Id: ${tenantId}`);
}

// Вход для разработки: владелец демо-оператора. В продакшене администратора создаёт create-admin.
if (process.env.NODE_ENV !== "production") {
  const o = createDb(env.MIGRATION_DATABASE_URL, { max: 1 });
  const [u] = await o.db.execute<{ id: string }>(sql`
    INSERT INTO users (email, name, password_hash) VALUES (${DEV_USER.email}, ${DEV_USER.name}, ${await hashPassword(DEV_USER.password)})
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`);
  await o.db.execute(sql`
    INSERT INTO memberships (tenant_id, user_id, role) VALUES (${DEMO_TENANT_ID}, ${u!.id}, 'owner') ON CONFLICT DO NOTHING`);
  await o.close();
  console.log(`Вход для разработки: ${DEV_USER.email} / ${DEV_USER.password}`);
}
