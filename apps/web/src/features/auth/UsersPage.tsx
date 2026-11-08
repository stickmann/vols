import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client.js";
import { Alert, Badge, Button, Dialog, Field, Input, Select } from "../../components/ui/index.js";
import { atLeast, meKey, PLAN_LABELS, ROLE_HINTS, ROLE_LABELS, ROLES, useCurrentUser, type Role, type Usage } from "./api.js";

interface Member {
  id: string;
  email: string;
  name: string;
  role: Role;
  twoFactor: boolean;
  lastLoginAt: string | null;
}
interface Invite {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

const dt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const link = (kind: "invite" | "reset", token: string) => `${window.location.origin}/${kind}/${token}`;

export function UsersPage() {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["users"],
    queryFn: () => api<{ members: Member[]; invites: Invite[] }>("/users"),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["users"] });
  const setRole = useMutation({
    mutationFn: (v: { id: string; role: Role }) => api(`/members/${v.id}`, { method: "PATCH", body: { role: v.role } }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/members/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/invites/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const resetLink = useMutation({
    mutationFn: (id: string) => api<{ token: string }>(`/members/${id}/reset-link`, { method: "POST" }),
  });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [shown, setShown] = useState<{
    title: string;
    url: string;
    hint: string;
  } | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const isOwner = me.role === "owner";
  const assignable = ROLES.filter((r) => r !== "owner" || isOwner)
    .slice()
    .reverse();
  const error = setRole.error ?? remove.error ?? revoke.error ?? resetLink.error;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Пользователи</h1>
          <p className="text-sm text-slate-500">Сотрудники «{me.tenant?.name}», их роли и приглашения.</p>
        </div>
        <Button variant="primary" onClick={() => setInviteOpen(true)}>
          + Пригласить
        </Button>
      </div>

      {error && <Alert>{error.message}</Alert>}
      {q.isError && <Alert>{q.error.message}</Alert>}

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Сотрудник</th>
              <th className="px-3 py-2 font-medium">Роль</th>
              <th className="px-3 py-2 font-medium">2FA</th>
              <th className="px-3 py-2 font-medium">Последний вход</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data?.members.map((m) => {
              const self = m.id === me.user.id;
              const locked = (m.role === "owner" && !isOwner) || self;
              return (
                <tr key={m.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {m.name} {self && <span className="text-xs font-normal text-slate-400">(вы)</span>}
                    </div>
                    <div className="text-xs text-slate-500">{m.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    {locked ? (
                      ROLE_LABELS[m.role]
                    ) : (
                      <Select
                        value={m.role}
                        aria-label={`Роль: ${m.name}`}
                        onChange={(e) =>
                          setRole.mutate({
                            id: m.id,
                            role: e.target.value as Role,
                          })
                        }
                        className="w-auto!"
                      >
                        {assignable.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {m.twoFactor ? <Badge tone="green">да</Badge> : <span className="text-slate-400">нет</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{m.lastLoginAt ? dt.format(new Date(m.lastLoginAt)) : "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {!self && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            resetLink.mutate(m.id, {
                              onSuccess: (r) =>
                                setShown({
                                  title: `Смена пароля: ${m.name}`,
                                  url: link("reset", r.token),
                                  hint: "Передайте ссылку сотруднику. Действует 24 часа, один раз; после смены пароля вход на всех устройствах сбрасывается.",
                                }),
                            })
                          }
                        >
                          Сменить пароль
                        </Button>
                        {!(m.role === "owner" && !isOwner) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:bg-red-50"
                            onClick={() => setRemoving(m)}
                          >
                            Убрать
                          </Button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {q.data && q.data.invites.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Ожидают принятия</h2>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
            {q.data.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  {i.email} · {ROLE_LABELS[i.role]}
                  <span className="block text-xs text-slate-500">до {dt.format(new Date(i.expiresAt))}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>
                  Отозвать
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {me.usage && <PlanSection usage={me.usage} />}
      <TenantSettings />

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        roles={assignable}
        onCreated={(email, token) => {
          refresh();
          setShown({
            title: `Приглашение для ${email}`,
            url: link("invite", token),
            hint: "Отправьте ссылку сотруднику. Действует 7 дней, один раз. По ней он задаст имя и пароль.",
          });
        }}
      />
      <Dialog
        open={!!shown}
        onClose={() => setShown(null)}
        title={shown?.title ?? ""}
        footer={
          <Button variant="primary" onClick={() => setShown(null)}>
            Готово
          </Button>
        }
      >
        {shown && (
          <div className="space-y-2 text-sm">
            <p className="text-slate-600">{shown.hint}</p>
            <div className="flex gap-2">
              <Input readOnly value={shown.url} onFocus={(e) => e.target.select()} aria-label="Ссылка" />
              <Button onClick={() => void navigator.clipboard?.writeText(shown.url)}>Копировать</Button>
            </div>
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Убрать ${removing?.name ?? ""}?`}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Отмена</Button>
            <Button
              variant="danger"
              onClick={() =>
                removing &&
                remove.mutate(removing.id, {
                  onSuccess: () => setRemoving(null),
                })
              }
            >
              Убрать
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Сотрудник потеряет доступ к «{me.tenant?.name}», его вход будет сброшен. Его правки в журнале останутся.
        </p>
      </Dialog>
    </div>
  );
}

function InviteDialog({
  open,
  onClose,
  roles,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  roles: Role[];
  onCreated: (email: string, token: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("technician");
  const create = useMutation({
    mutationFn: () =>
      api<{ token: string }>("/invites", {
        method: "POST",
        body: { email, role },
      }),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Пригласить сотрудника"
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            disabled={!email.includes("@") || create.isPending}
            onClick={() =>
              create.mutate(undefined, {
                onSuccess: (r) => {
                  onCreated(email, r.token);
                  setEmail("");
                  onClose();
                },
              })
            }
          >
            Создать приглашение
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="E-mail">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Роль" hint={ROLE_HINTS[role]}>
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        {create.isError && <Alert>{create.error.message}</Alert>}
      </div>
    </Dialog>
  );
}

function TenantSettings() {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const [name, setName] = useState(me.tenant?.name ?? "");
  const save = useMutation({
    mutationFn: (v: { name?: string; require2fa?: boolean }) => api("/tenant", { method: "PATCH", body: v }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meKey }),
  });
  if (!me.tenant || !atLeast(me.role, "admin")) return null;
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">Настройки оператора</h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ name });
        }}
      >
        <Field label="Название" className="min-w-0 flex-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button type="submit" disabled={save.isPending || !name.trim() || name === me.tenant.name}>
          Сохранить
        </Button>
      </form>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={me.tenant.require2fa}
          disabled={!me.user.twoFactor && !me.tenant.require2fa}
          onChange={(e) => save.mutate({ require2fa: e.target.checked })}
        />
        <span>
          Двухфакторный вход обязателен для всех сотрудников
          <span className="block text-xs text-slate-500">
            Кто его не настроил, после входа сможет только открыть профиль и включить его.
            {!me.user.twoFactor && " Сначала включите его у себя в профиле."}
          </span>
        </span>
      </label>
      {save.isError && <Alert>{save.error.message}</Alert>}
    </section>
  );
}

function Meter({ label, value, limit }: { label: string; value: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((value / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums">
          {value} из {limit ?? "∞"}
        </span>
      </div>
      {limit != null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100" aria-hidden>
          <div className={pct >= 100 ? "h-full bg-red-500" : pct >= 90 ? "h-full bg-amber-500" : "h-full bg-brand-600"} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function PlanSection({ usage }: { usage: Usage }) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">Тариф: {PLAN_LABELS[usage.plan]}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Meter label="Точки учёта" value={usage.points} limit={usage.pointLimit} />
        <Meter label="Пользователи" value={usage.users} limit={usage.userLimit} />
      </div>
      <p className="text-xs text-slate-500">
        Точки учёта — муфты, ящики, кроссы, OLT и ONU. Опоры, колодцы, трассы, кабели и сплиттеры в лимит не входят. Ожидающие
        приглашения занимают места пользователей.
      </p>
    </section>
  );
}
