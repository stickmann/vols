import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}

export interface RequestContext {
  tenantId: string;
  userId?: string | null;
}

/**
 * Всё обращение к данным оператора — только через эту функцию.
 * Контекст ставится на транзакцию (set_config(..., true)), поэтому не
 * «протекает» в другие запросы через пул соединений, а RLS видит только этого оператора.
 */
export function withTenant<T>(db: Db, ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true), set_config('app.user_id', ${ctx.userId ?? ""}, true)`,
    );
    return fn(tx);
  });
}
