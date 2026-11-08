import { useEffect, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { ApiError, UNAUTHORIZED_EVENT } from "../api/client.js";
import { Alert, Button, Select, cx } from "../components/ui/index.js";
import { atLeast, MeContext, ROLE_LABELS, useLogout, useMe, useSwitchTenant, type Me, type Role } from "../features/auth/api.js";
import { UndoToast } from "../features/trash/undo.js";

type NavItem = { to: string; label: string; min?: Role } | { section: string; min?: Role };

const nav: NavItem[] = [
  { to: "/map", label: "Карта" },
  { to: "/documents", label: "Документы" },
  { to: "/trash", label: "Корзина" },
  { section: "Справочники" },
  { to: "/catalog/cables", label: "Типы кабелей" },
  { section: "Управление", min: "admin" },
  { to: "/settings/users", label: "Пользователи", min: "admin" },
];

/** Вход обязателен: без сессии — на страницу входа, без обязательного 2FA — в профиль. */
export function AppShell() {
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();

  // Сессия истекла посреди работы (любой запрос вернул 401) — на вход с возвратом сюда.
  useEffect(() => {
    const onUnauthorized = () =>
      navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [navigate, location]);

  if (me.isPending) return <div className="p-6 text-sm text-slate-500">Загрузка…</div>;
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401)
      return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
    return (
      <div className="p-6">
        <Alert>{me.error.message}</Alert>
      </div>
    );
  }
  if (me.data.mustSetup2fa && location.pathname !== "/profile") return <Navigate to="/profile" replace />;
  if (!me.data.tenant)
    return (
      <div className="p-6">
        <Alert tone="warning">У вас нет доступа ни к одному оператору. Попросите администратора прислать приглашение.</Alert>
      </div>
    );

  return (
    <MeContext.Provider value={me.data}>
      <Shell me={me.data} />
    </MeContext.Provider>
  );
}

function Shell({ me }: { me: Me }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const items = nav.filter((i) => !i.min || atLeast(me.role, i.min));

  return (
    <div className="flex h-full flex-col md:flex-row">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 md:hidden">
        <Brand />
        <Button size="sm" variant="ghost" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label="Меню">
          ☰
        </Button>
      </header>

      <aside
        className={cx(
          "flex-col border-slate-200 bg-white md:flex md:w-60 md:shrink-0 md:border-r",
          menuOpen ? "flex border-b" : "hidden",
        )}
      >
        <div className="hidden px-4 py-4 md:block">
          <Brand />
        </div>
        <nav className="flex-1 space-y-0.5 px-2 py-2" onClick={() => setMenuOpen(false)}>
          {items.map((item, i) =>
            "section" in item ? (
              <div key={i} className="px-2 pt-4 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                {item.section}
              </div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cx(
                    "flex items-center justify-between rounded-md px-2 py-1.5 text-sm",
                    isActive ? "bg-brand-50 font-medium text-brand-700" : "text-slate-700 hover:bg-slate-100",
                  )
                }
              >
                {item.label}
              </NavLink>
            ),
          )}
        </nav>
        <UserBlock me={me} onNavigate={() => setMenuOpen(false)} />
        <div className="px-4 pb-3 text-xs text-slate-400">Версия {import.meta.env.VITE_APP_VERSION || "dev"}</div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <PlanBanner me={me} />
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </main>
      <UndoToast />
    </div>
  );
}

/** Предупреждение, когда лимит точек учёта тарифа почти или полностью исчерпан. */
function PlanBanner({ me }: { me: Me }) {
  const u = me.usage;
  if (!u?.pointLimit || u.points < u.pointLimit * 0.9) return null;
  const full = u.points >= u.pointLimit;
  return (
    <div role="status" className={cx("border-b px-4 py-2 text-sm", full ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900")}>
      {full ? "Лимит тарифа исчерпан" : "Лимит тарифа почти исчерпан"}: точек учёта {u.points} из {u.pointLimit} (муфты, ящики, кроссы, OLT,
      ONU). {full ? "Новые точки добавить нельзя — удалите ненужные или перейдите на тариф без ограничений." : "Опоры, трассы и кабели в лимит не входят."}
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white">В</span>
      <span className="font-semibold">ВОЛС</span>
    </div>
  );
}

/** Кто вошёл, выбор оператора, профиль и выход. */
function UserBlock({ me, onNavigate }: { me: Me; onNavigate: () => void }) {
  const navigate = useNavigate();
  const logout = useLogout();
  const switchTenant = useSwitchTenant();
  return (
    <div className="space-y-2 border-t border-slate-200 px-4 py-3 text-sm">
      {me.memberships.length > 1 ? (
        <Select
          aria-label="Оператор"
          value={me.tenant!.id}
          onChange={(e) =>
            switchTenant.mutate(e.target.value, {
              onSuccess: () => navigate("/map"),
            })
          }
        >
          {me.memberships.map((m) => (
            <option key={m.tenantId} value={m.tenantId}>
              {m.name}
            </option>
          ))}
        </Select>
      ) : (
        <div className="truncate font-medium text-slate-700">{me.tenant!.name}</div>
      )}
      <div className="flex items-center gap-2">
        <NavLink
          to="/profile"
          onClick={onNavigate}
          className="min-w-0 flex-1 truncate text-slate-600 hover:text-slate-900 hover:underline"
          title="Профиль"
        >
          {me.user.name}
          <span className="block truncate text-xs text-slate-400">{me.role ? ROLE_LABELS[me.role] : ""}</span>
        </NavLink>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            logout.mutate(undefined, {
              onSuccess: () => navigate("/login", { replace: true }),
            })
          }
        >
          Выйти
        </Button>
      </div>
    </div>
  );
}
