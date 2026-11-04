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
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index().on(t.tenantId, t.tableName, t.rowId), index().on(t.tenantId, t.at)],
);
