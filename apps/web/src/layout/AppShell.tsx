import { DEMO_TENANT_ID } from "@vols/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { Button, Dialog, Field, Input, cx } from "../components/ui/index.js";
import { getTenantId, setTenantId } from "../lib/tenant.js";

const nav = [
  { to: "/map", label: "Карта" },
  { to: "/documents", label: "Документы" },
  { section: "Справочники" },
  { to: "/catalog/cables", label: "Типы кабелей" },
] as const;

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);

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
          {nav.map((item, i) =>
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
        <TenantSwitch />
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
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

/** Временный выбор оператора до появления авторизации. */
function TenantSwitch() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(getTenantId());
  const current = getTenantId();
  const valid = /^[0-9a-f-]{36}$/i.test(value.trim());

  return (
    <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
      <div>Оператор (режим разработки)</div>
      <button type="button" className="mt-0.5 font-medium text-slate-700 hover:underline" onClick={() => setOpen(true)}>
        {current === DEMO_TENANT_ID ? "Демо-оператор" : `${current.slice(0, 8)}…`}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Оператор"
        footer={
          <>
            <Button
              onClick={() => {
                setTenantId("");
                setValue(DEMO_TENANT_ID);
              }}
            >
              Демо
            </Button>
            <Button
              variant="primary"
              disabled={!valid}
              onClick={() => {
                setTenantId(value.trim());
                setOpen(false);
                void qc.resetQueries();
              }}
            >
              Применить
            </Button>
          </>
        }
      >
        <Field label="ID оператора" hint="Пока нет входа в систему, данные открываются по ID оператора.">
          <Input value={value} onChange={(e) => setValue(e.target.value)} className="font-mono" />
        </Field>
      </Dialog>
    </div>
  );
}
