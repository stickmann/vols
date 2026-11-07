/**
 * Роли у оператора и права на запросы API. Проверка — на сервере, по методу и пути;
 * интерфейс только прячет недоступные кнопки.
 */
export const ROLES = ["viewer", "technician", "designer", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Владелец",
  admin: "Администратор",
  designer: "Инженер",
  technician: "Монтажник",
  viewer: "Просмотр",
};

const rank = (r: Role) => ROLES.indexOf(r);
export const atLeast = (role: Role, min: Role) => rank(role) >= rank(min);

/** Минимальная роль для запроса. Всё, что не перечислено и меняет данные, — инженер. */
export function requiredRole(method: string, path: string): Role {
  const p = path.replace(/^\/api\/v1/, "").split("?")[0]!;
  // Администратор: пользователи, приглашения, настройки оператора — в том числе чтение.
  if (/^\/(users|members|invites)(\/|$)/.test(p) || p === "/tenant") return "admin";
  if (method === "GET" || method === "HEAD") return "viewer";
  // Расчёты без изменений данных.
  if (method === "POST" && /^\/(trace|trace\/locate|routing\/path)$/.test(p)) return "viewer";
  // Монтажник: разварка, заведение и вывод кабелей, очистка разварки.
  if (/^\/connections(\/|$)/.test(p)) return "technician";
  if (/^\/equipment\/[^/]+\/(cables|clear-splicing)(\/|$)/.test(p)) return "technician";
  return "designer";
}
