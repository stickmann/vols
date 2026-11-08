import { sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { HttpError } from "../errors.js";

/**
 * Тарифы. Бесплатный: 200 точек учёта и 3 пользователя; «без ограничений» — без лимитов.
 * Точка учёта — оборудование, кроме сплиттеров: муфты, ящики, кроссы, OLT, ONU. Опоры, колодцы,
 * трассы, кабели и волокна не считаются — документировать сеть подробно ничего не стоит.
 * Лимит точек проверяет база (триггер point_limit), лимит пользователей — сервис приглашений.
 */
export const PLAN_LABELS = { free: "Бесплатный", unlimited: "Без ограничений" } as const;
export type Plan = keyof typeof PLAN_LABELS;

export interface Usage {
  plan: Plan;
  points: number;
  pointLimit: number | null;
  users: number;
  userLimit: number | null;
}

/** Использование текущего оператора (транзакция с app.tenant_id). */
export async function tenantUsage(tx: Tx): Promise<Usage> {
  const [u] = await tx.execute<Usage & Record<string, unknown>>(sql`
    SELECT t.plan,
           (SELECT count(*)::int FROM equipment WHERE tenant_id = t.id AND kind <> 'splitter') AS points,
           tenant_point_limit(t.id) AS "pointLimit",
           (SELECT count(*)::int FROM memberships WHERE tenant_id = t.id) AS users,
           tenant_user_limit(t.id) AS "userLimit"
    FROM tenants t WHERE t.id = current_tenant_id()`);
  if (!u) throw new HttpError(404, "Оператор не найден");
  return u;
}

/**
 * Хватит ли места для ещё одного пользователя. Ожидающие приглашения занимают место
 * (includeInvites), чтобы нельзя было разослать приглашений больше, чем мест.
 */
export async function assertUserSlot(tx: Tx, pendingInvites: number, opts: { replacingInvite?: boolean } = {}) {
  const u = await tenantUsage(tx);
  if (u.userLimit == null) return;
  const taken = u.users + pendingInvites - (opts.replacingInvite ? 1 : 0);
  if (taken >= u.userLimit) {
    throw new HttpError(
      409,
      `Достигнут лимит тарифа: ${u.userLimit} ${u.userLimit === 1 ? "пользователь" : u.userLimit < 5 ? "пользователя" : "пользователей"} (вместе с ожидающими приглашениями). Отзовите приглашение, уберите сотрудника или перейдите на тариф без ограничений.`,
    );
  }
}
