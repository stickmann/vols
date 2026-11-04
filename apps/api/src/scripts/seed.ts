import { sql } from "drizzle-orm";
import { createDb, withTenant } from "../db/client.js";
import { env } from "../env.js";
import { createDemoNetwork } from "../services/demo-network.js";
import { provisionTenant } from "../services/tenants.js";

const SLUG = "demo";

// Проверка существования — под владельцем: под ролью приложения без контекста tenants не видны.
const owner = createDb(env.MIGRATION_DATABASE_URL, { max: 1 });
const existing = await owner.db.execute<{ id: string }>(sql`SELECT id FROM tenants WHERE slug = ${SLUG}`);
await owner.close();

if (existing.length > 0) {
  console.log(`Демо-оператор уже есть: ${existing[0]!.id}`);
} else {
  const app = createDb(env.DATABASE_URL, { max: 1 });
  const tenantId = await provisionTenant(app.db, { name: "Демо-оператор", slug: SLUG });
  await withTenant(app.db, { tenantId }, (tx) => createDemoNetwork(tx, tenantId));
  await app.close();
  console.log(`Создан демо-оператор: ${tenantId}`);
  console.log(`Для запросов к API: заголовок X-Tenant-Id: ${tenantId}`);
}
