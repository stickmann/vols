import { sql } from "drizzle-orm";
import { bigserial, index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_common.js";
import { memberRole } from "./enums.js";

/** Оператор связи — арендатор SaaS. */
export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ...timestamps(),
});

/** Пользователи глобальны: один человек может работать у нескольких операторов. */
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  ...timestamps(),
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
