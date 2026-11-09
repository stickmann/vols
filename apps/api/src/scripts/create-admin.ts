/**
 * Создать первого администратора (или задать пароль существующему) и сделать его владельцем.
 *   node dist/create-admin.js --email a@b.ru --name "Имя" [--tenant <id>] < пароль
 *   node dist/create-admin.js --check          — код выхода 0, если вход уже настроен (есть хоть один пароль)
 * Без --tenant — владелец всех операторов на этой установке. Пароль читается из stdin.
 */
import { sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { env } from "../env.js";
import { hashPassword } from "../services/auth/crypto.js";
import { MIN_PASSWORD } from "../services/auth/auth.js";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

// Под владельцем базы: операторы ещё не выбраны, а создать нужно членство во всех.
const { db, close } = createDb(env.MIGRATION_DATABASE_URL, { max: 1 });
try {
  if (args.includes("--check")) {
    const [r] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM users WHERE password_hash IS NOT NULL`);
    process.exitCode = r!.n > 0 ? 0 : 1;
  } else {
    const email = arg("email")?.trim().toLowerCase();
    const name = arg("name")?.trim();
    if (!email || !email.includes("@") || !name) throw new Error("Укажите --email и --name");
    const password = (await readStdin()).replace(/\r?\n$/, "");
    if (password.length < MIN_PASSWORD) throw new Error(`Пароль — не короче ${MIN_PASSWORD} символов (передаётся через stdin)`);

    const hash = await hashPassword(password);
    const [u] = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, name, password_hash, email_verified_at) VALUES (${email}, ${name}, ${hash}, now())
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, disabled_at = NULL,
        email_verified_at = coalesce(users.email_verified_at, now())
      RETURNING id`);
    const tenant = arg("tenant");
    const tenants = await db.execute<{ id: string; name: string }>(
      tenant ? sql`SELECT id, name FROM tenants WHERE id = ${tenant}` : sql`SELECT id, name FROM tenants ORDER BY name`,
    );
    if (!tenants.length) throw new Error("Нет ни одного оператора — сначала запустите seed.js");
    for (const t of tenants) {
      await db.execute(sql`
        INSERT INTO memberships (tenant_id, user_id, role) VALUES (${t.id}, ${u!.id}, 'owner')
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner'`);
    }
    console.log(`Администратор ${email} — владелец: ${tenants.map((t) => t.name).join(", ")}`);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 2;
} finally {
  await close();
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error("Передайте пароль через stdin: printf '%s' \"$ПАРОЛЬ\" | node dist/create-admin.js …");
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
