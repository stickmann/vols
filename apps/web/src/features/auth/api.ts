import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { api } from "../../api/client.js";

export const ROLES = ["viewer", "technician", "designer", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Владелец",
  admin: "Администратор",
  designer: "Инженер",
  technician: "Монтажник",
  viewer: "Просмотр",
};

export const ROLE_HINTS: Record<Role, string> = {
  owner: "Всё, включая назначение владельцев",
  admin: "Пользователи, приглашения, настройки и вся работа с сетью",
  designer: "Карта, кабели, оборудование, справочники, удаление и корзина",
  technician: "Разварка: сварки, заведение и вывод кабелей",
  viewer: "Только просмотр, трассировка и документы",
};

export const atLeast = (role: Role | null | undefined, min: Role) => !!role && ROLES.indexOf(role) >= ROLES.indexOf(min);

export interface Usage {
  plan: "free" | "unlimited";
  points: number;
  pointLimit: number | null;
  users: number;
  userLimit: number | null;
}

export const PLAN_LABELS: Record<Usage["plan"], string> = { free: "Бесплатный", unlimited: "Без ограничений" };

export interface Me {
  user: { id: string; email: string; name: string; twoFactor: boolean; recoveryCodesLeft: number; emailVerified: boolean };
  tenant: { id: string; name: string; require2fa: boolean } | null;
  role: Role | null;
  memberships: { tenantId: string; name: string; role: Role }[];
  mustSetup2fa: boolean;
  usage: Usage | null;
}

export const meKey = ["auth", "me"] as const;
export const useMe = () => useQuery({ queryKey: meKey, queryFn: () => api<Me>("/auth/me"), retry: false, staleTime: 60_000 });

export const MeContext = createContext<Me | null>(null);
/** Кто вошёл — внутри AuthGate всегда есть. */
export function useCurrentUser(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useCurrentUser вне AuthGate");
  return me;
}
/** Хватает ли роли (интерфейс только прячет кнопки — проверяет сервер). */
export function useCan(min: Role) {
  return atLeast(useContext(MeContext)?.role, min);
}

/** После входа, выхода и смены оператора все данные — другие. */
function useResetAll() {
  const qc = useQueryClient();
  return () => qc.resetQueries();
}

export function useLogin() {
  return useMutation({
    mutationFn: (v: { email: string; password: string }) => api<{ twoFactorRequired: boolean }>("/auth/login", { method: "POST", body: v }),
  });
}
export function useLogin2fa() {
  return useMutation({ mutationFn: (code: string) => api("/auth/login/2fa", { method: "POST", body: { code } }) });
}
export function useLogout() {
  const reset = useResetAll();
  return useMutation({ mutationFn: () => api("/auth/logout", { method: "POST" }), onSuccess: () => void reset() });
}
export function useSwitchTenant() {
  const reset = useResetAll();
  return useMutation({
    mutationFn: (tenantId: string) => api("/auth/switch-tenant", { method: "POST", body: { tenantId } }),
    onSuccess: () => void reset(),
  });
}

function useMeMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: meKey }) });
}
export const useChangePassword = () =>
  useMeMutation((v: { current: string; next: string }) => api("/auth/password", { method: "POST", body: v }));
export const useStart2fa = () => useMutation({ mutationFn: () => api<{ secret: string; otpauthUrl: string }>("/auth/2fa/setup", { method: "POST" }) });
export const useEnable2fa = () => useMeMutation((code: string) => api<{ recoveryCodes: string[] }>("/auth/2fa/enable", { method: "POST", body: { code } }));
export const useDisable2fa = () => useMeMutation((password: string) => api("/auth/2fa/disable", { method: "POST", body: { password } }));
