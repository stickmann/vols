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
  userName: string | null;
  canUndo: boolean;
};

/** Корзина и история: последние операции оператора. */
export async function listOperations(tx: Tx, limit = 100) {
  return tx.execute<OperationRow>(sql`
    SELECT o.id, o.kind, o.title, o.summary, o.created_at AS "createdAt", o.undone_at AS "undoneAt", u.name AS "userName",
           (o.undone_at IS NULL AND o.kind <> 'undo' AND o.created_at > now() - make_interval(days => ${UNDO_DAYS})) AS "canUndo"
    FROM operations o LEFT JOIN users u ON u.id = o.user_id
    ORDER BY o.created_at DESC
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

  // Нужное для восстановления удалено позже другой операцией — подсказываем, что вернуть сначала.
  const missing = await tx.execute<{ ref_table: string; ref_id: string }>(sql`SELECT DISTINCT * FROM operation_missing_refs(${id})`);
  if (missing.length) throw await blockedBy(tx, missing);

  // Восстановление — в точке сохранения: если базе чего-то не хватит, откатываем только его
  // и объясняем, что мешает, по журналу.
  try {
    const operationId = await tx.transaction(async (sp) => {
      const r = await withOperation(sp, tenantId, { kind: "undo", title: `Отмена: ${op.title}` }, () =>
        sp.execute(sql`SELECT undo_operation(${id})`),
      );
      await sp.execute(sql`UPDATE operations SET undone_at = now(), undone_by_op_id = ${r.operationId} WHERE id = ${id}`);
      return r.operationId;
    });
    return { operationId, title: op.title };
  } catch (e) {
    throw await explainUndoFailure(tx, tenantId, e);
  }
}

/** Какая операция удалила недостающие объекты: её нужно восстановить первой. */
async function blockedBy(tx: Tx, missing: { ref_table: string; ref_id: string }[]) {
  const [blocker] = await tx.execute<{ title: string }>(sql`
    SELECT o.title FROM audit_log a JOIN operations o ON o.id = a.op_id
    WHERE a.action = 'delete' AND o.undone_at IS NULL
      AND a.row_id = ANY(ARRAY[${sql.join(missing.map((m) => sql`${m.ref_id}`), sql`, `)}]::uuid[])
    ORDER BY a.id DESC LIMIT 1`);
  if (blocker) return new HttpError(409, `Сначала восстановите «${blocker.title}»: эта операция удалила то, без чего восстановить нельзя.`);
  const nouns = [...new Set(missing.map((m) => TABLE_NOUN[m.ref_table] ?? m.ref_table))];
  return new HttpError(409, `Восстановить нельзя: удалено то, на что ссылается эта операция (${nouns.join(", ")}), и в корзине этого нет.`);
}

/** Ошибка базы при восстановлении — понятным текстом (запасной случай, обычно ловится проверкой выше). */
async function explainUndoFailure(_tx: Tx, _tenantId: string, e: unknown): Promise<unknown> {
  const pg = pgError(e);
  if (pg?.code === "23503") return new HttpError(409, "Восстановить нельзя: удалено то, на что ссылается эта операция.");
  if (pg?.code === "23505")
    return new HttpError(409, "Восстановить нельзя: место удалённого уже занято новыми объектами (например, точка подключения уже сварена заново).");
  return e;
}

function pgError(err: unknown): { code: string; detail?: string } | null {
  for (let e = err as { code?: unknown; detail?: string; cause?: unknown } | undefined, i = 0; e && i < 5; e = e.cause as typeof e, i++) {
    if (typeof e.code === "string" && /^2[0-9A-Z]{4}$/.test(e.code)) return { code: e.code, detail: e.detail };
  }
  return null;
}
