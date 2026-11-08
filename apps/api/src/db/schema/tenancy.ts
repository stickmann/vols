import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common.js";
import { memberRole } from "./enums.js";

/** Оператор связи — арендатор SaaS. */
export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** Двухфакторный вход обязателен для всех пользователей оператора. */
  require2fa: boolean("require_2fa").notNull().default(false),
  /** Тариф: free — бесплатный с лимитами, unlimited — без ограничений (см. services/plans.ts). */
  plan: text("plan").notNull().default("free"),
  /** Свой лимит точек учёта / пользователей вместо лимита тарифа (NULL — по тарифу). */
  pointLimit: integer("point_limit"),
  userLimit: integer("user_limit"),
  ...timestamps(),
});

/** Пользователи глобальны: один человек может работать у нескольких операторов. */
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  /** scrypt$N$r$p$соль$хэш; NULL — пароль ещё не задан (приглашение не принято). */
  passwordHash: text("password_hash"),
  /** Секрет TOTP (base32); включён, если totp_enabled_at задан. */
  totpSecret: text("totp_secret"),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  /** Последний принятый шаг TOTP — код нельзя использовать повторно. */
  totpLastStep: bigint("totp_last_step", { mode: "number" }),
  /** SHA-256 одноразовых кодов восстановления. */
  recoveryCodes: jsonb("recovery_codes").$type<string[]>(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  ...timestamps(),
});

/** Сессия входа: в cookie — случайный токен, в базе — его SHA-256. */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Текущий оператор сессии. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    /** Пароль верный, но ещё не введён код двухфакторного входа. */
    pending2fa: boolean("pending_2fa").notNull().default(false),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index().on(t.userId)],
);

/** Приглашение в оператора: ссылка с токеном, в базе — его SHA-256. */
export const invites = pgTable(
  "invites",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: memberRole("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => [index().on(t.tenantId)],
);

/** Ссылка на смену пароля, выданная администратором. */
export const passwordResets = pgTable("password_resets", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const memberships = pgTable(
  "memberships",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), index().on(t.userId)],
);

/** Журнал изменений, заполняется триггером audit_row(). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // Без FK: строки журнала пишутся и при каскадном удалении оператора.
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id"),
    tableName: text("table_name").notNull(),
    rowId: uuid("row_id").notNull(),
    action: text("action").notNull(),
    oldData: jsonb("old_data"),
    newData: jsonb("new_data"),
    /** Операция пользователя, в которой сделано изменение (см. operations). */
    opId: uuid("op_id"),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index().on(t.tenantId, t.tableName, t.rowId), index().on(t.tenantId, t.at), index().on(t.opId)],
);

/**
 * Операция пользователя (удаление, очистка разварки, вывод кабеля…): все её изменения
 * в audit_log помечены op_id, поэтому операцию можно отменить целиком. Это же — корзина.
 */
export const operations = pgTable(
  "operations",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    /** Последствия, показанные перед действием: [{ kind, text }]. */
    summary: jsonb("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    /** Операция отмены, которая вернула эту. */
    undoneByOpId: uuid("undone_by_op_id"),
  },
  (t) => [index().on(t.tenantId, t.createdAt)],
);
