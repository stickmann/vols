/**
 * Тарифы операторов на этой установке.
 *   node dist/set-plan.js                                   — список: тариф, точки учёта, пользователи
 *   node dist/set-plan.js --tenant <id|slug|all> --plan free|unlimited
 *   node dist/set-plan.js --tenant <id|slug> --points 500 --users 10   — свой лимит (default — по тарифу)
 */
import { sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { env } from "../env.js";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const limit = (v: string | undefined, name: string) => {
  if (v === undefined) return undefined;
  if (v === "default") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name}: целое число или default`);
  return n;
};

// Под владельцем базы: видны все операторы установки.
const { db, close } = createDb(env.MIGRATION_DATABASE_URL, { max: 1 });
try {
  const tenant = arg("tenant");
  if (tenant) {
    const plan = arg("plan");
    if (plan && plan !== "free" && plan !== "unlimited") throw new Error("--plan: free или unlimited");
    const points = limit(arg("points"), "points");
    const users = limit(arg("users"), "users");
    if (!plan && points === undefined && users === undefined) throw new Error("Укажите --plan, --points или --users");
    const where = tenant === "all" ? sql`true` : sql`(id::text = ${tenant} OR slug = ${tenant})`;
    const r = await db.execute(sql`
      UPDATE tenants SET
        plan = coalesce(${plan ?? null}, plan),
        point_limit = CASE WHEN ${points !== undefined} THEN ${points ?? null}::int ELSE point_limit END,
        user_limit = CASE WHEN ${users !== undefined} THEN ${users ?? null}::int ELSE user_limit END
      WHERE ${where} RETURNING id`);
    if (!r.length) throw new Error(`Оператор «${tenant}» не найден`);
    console.log(`Изменено операторов: ${r.length}`);
  }
  const rows = await db.execute<{ name: string; slug: string; plan: string; points: number; pl: number | null; users: number; ul: number | null }>(sql`
    SELECT t.name, t.slug, t.plan,
           (SELECT count(*)::int FROM equipment e WHERE e.tenant_id = t.id AND e.kind <> 'splitter') AS points, tenant_point_limit(t.id) AS pl,
           (SELECT count(*)::int FROM memberships m WHERE m.tenant_id = t.id) AS users, tenant_user_limit(t.id) AS ul
    FROM tenants t ORDER BY t.name`);
  for (const r of rows) {
    console.log(`${r.name} (${r.slug}) — ${r.plan}: точек учёта ${r.points} из ${r.pl ?? "∞"}, пользователей ${r.users} из ${r.ul ?? "∞"}`);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 2;
} finally {
  await close();
}
