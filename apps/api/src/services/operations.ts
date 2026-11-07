import { sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { HttpError } from "../errors.js";

/** Сколько дней операцию можно отменить из корзины. */
export const UNDO_DAYS = 30;

export interface OperationInfo {
  kind: string;
  title: string;
  summary?: unknown;
}

/**
 * Выполнить действие как операцию: все изменения в журнале помечаются её номером,
 * поэтому её можно отменить целиком. Возвращает номер операции и результат действия.
 */
export async function withOperation<T>(tx: Tx, tenantId: string, info: OperationInfo, fn: () => Promise<T>) {
  const [op] = await tx.execute<{ id: string }>(sql`
    INSERT INTO operations (tenant_id, user_id, kind, title, summary)
    VALUES (${tenantId}, nullif(current_setting('app.user_id', true), '')::uuid, ${info.kind}, ${info.title},
            ${info.summary === undefined ? null : JSON.stringify(info.summary)}::jsonb)
    RETURNING id`);
  await tx.execute(sql`SELECT set_config('app.op_id', ${op!.id}, true)`);
  const result = await fn();
  await tx.execute(sql`SELECT set_config('app.op_id', '', true)`);
  return { operationId: op!.id, result };
}

type OperationRow = {
  id: string;
  kind: string;
  title: string;
  summary: { kind: string; text: string }[] | null;
  createdAt: string;
  undoneAt: string | null;
  canUndo: boolean;
};

/** Корзина и история: последние операции оператора. */
export async function listOperations(tx: Tx, limit = 100) {
  return tx.execute<OperationRow>(sql`
    SELECT id, kind, title, summary, created_at AS "createdAt", undone_at AS "undoneAt",
           (undone_at IS NULL AND kind <> 'undo' AND created_at > now() - make_interval(days => ${UNDO_DAYS})) AS "canUndo"
    FROM operations
    ORDER BY created_at DESC
    LIMIT ${limit}`);
}

const TABLE_NOUN: Record<string, string> = {
  sites: "место",
  routes: "трасса",
  equipment: "оборудование",
  cables: "кабель",
  cable_spans: "пролёт кабеля",
  cable_slacks: "запас кабеля",
  span_routes: "участок трассы кабеля",
  fibers: "волокно",
  terminals: "точка подключения",
  connections: "соединение",
};

/** Отменить операцию: вернуть все её строки в состояние до неё. Отмена — тоже операция (в журнале). */
export async function undoOperation(tx: Tx, tenantId: string, id: string) {
  const [op] = await tx.execute<{ title: string; kind: string; undoneAt: string | null; old: boolean }>(sql`
    SELECT title, kind, undone_at AS "undoneAt",
           created_at <= now() - make_interval(days => ${UNDO_DAYS}) AS old
    FROM operations WHERE id = ${id} FOR UPDATE`);
  if (!op) throw new HttpError(404, "Операция не найдена");
  if (op.undoneAt) throw new HttpError(409, "Операция уже отменена");
  if (op.kind === "undo") throw new HttpError(422, "Отмену отменить нельзя");
  if (op.old) throw new HttpError(422, `Операцию старше ${UNDO_DAYS} дней отменить нельзя`);

  const conflicts = await tx.execute<{ table_name: string; row_id: string }>(sql`SELECT * FROM operation_conflicts(${id})`);
  if (conflicts.length) {
    const kinds = [...new Set(conflicts.map((c) => TABLE_NOUN[c.table_name] ?? c.table_name))];
    throw new HttpError(
      409,
      `После этой операции изменялись связанные объекты (${kinds.join(", ")}: ${conflicts.length}). ` +
        "Сначала отмените более поздние операции из корзины.",
    );
  }

  const { operationId } = await withOperation(tx, tenantId, { kind: "undo", title: `Отмена: ${op.title}` }, () =>
    tx.execute(sql`SELECT undo_operation(${id})`),
  );
  await tx.execute(sql`UPDATE operations SET undone_at = now(), undone_by_op_id = ${operationId} WHERE id = ${id}`);
  return { operationId, title: op.title };
}
