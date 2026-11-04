import { objectStatuses, routeKinds, siteKinds, type ObjectStatus } from "@vols/shared";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Alert, Badge, Button, Field, Input, Select, Textarea } from "../../../components/ui/index.js";
import {
  useCable,
  useCreateEquipment,
  useDeleteCable,
  useDeleteEquipment,
  useDeleteRoute,
  useDeleteSite,
  useEquipmentModels,
  useRoute,
  useSite,
  useUpdateCable,
  useUpdateRoute,
  useUpdateSite,
} from "../api.js";
import { EQUIPMENT_KIND_LABELS, ROUTE_KIND_LABELS, SITE_KIND_LABELS, STATUS_LABELS } from "../style.js";
import type { Selection, SiteDetails } from "../types.js";

type Select_ = (s: Selection) => void;

const fmtLen = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} км` : `${Math.round(m)} м`);

export function PanelShell({ title, subtitle, onClose, children }: { title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{title}</h2>
          {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
        </div>
        <button className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Закрыть панель">
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">{children}</div>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatusSelect({ value, onChange }: { value: ObjectStatus; onChange: (v: ObjectStatus) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as ObjectStatus)}>
      {objectStatuses.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </Select>
  );
}

/** Форма с локальным черновиком: «Сохранить» активна, только когда есть изменения. */
function useFormDraft<T extends object>(source: T | undefined) {
  const [draft, setDraft] = useState<T | undefined>(source);
  const key = JSON.stringify(source);
  useEffect(() => setDraft(source), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!draft && JSON.stringify(draft) !== key;
  const set = <K extends keyof T>(k: K, v: T[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  return { draft, set, dirty, reset: () => setDraft(source) };
}

function DeleteButton({ label, onConfirm, disabled, title }: { label: string; onConfirm: () => void; disabled?: boolean; title?: string }) {
  const [ask, setAsk] = useState(false);
  if (!ask)
    return (
      <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setAsk(true)} disabled={disabled} title={title}>
        {label}
      </Button>
    );
  return (
    <span className="flex items-center gap-1">
      <span className="text-sm text-slate-600">Точно?</span>
      <Button size="sm" variant="danger" onClick={onConfirm}>
        Да, удалить
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAsk(false)}>
        Нет
      </Button>
    </span>
  );
}

function MutationError({ error }: { error: Error | null }) {
  return error ? <Alert>{error.message}</Alert> : null;
}

// ---------------------------------------------------------------- место

export function SitePanel({ id, onClose, onSelect }: { id: string; onClose: () => void; onSelect: Select_ }) {
  const q = useSite(id);
  const update = useUpdateSite();
  const del = useDeleteSite();
  const src = useMemo(
    () =>
      q.data && {
        kind: q.data.kind,
        name: q.data.name ?? "",
        address: q.data.address ?? "",
        status: q.data.status,
        notes: q.data.notes ?? "",
      },
    [q.data],
  );
  const f = useFormDraft(src);

  if (q.isPending) return <PanelShell title="Загрузка…" onClose={onClose}>{null}</PanelShell>;
  if (q.isError || !f.draft) return <PanelShell title="Место" onClose={onClose}><Alert>{q.error?.message ?? "Не найдено"}</Alert></PanelShell>;
  const d = f.draft;
  const s = q.data!;

  return (
    <PanelShell
      title={s.name || SITE_KIND_LABELS[s.kind]}
      subtitle={`${SITE_KIND_LABELS[s.kind]} · ${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}`}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Вид">
          <Select value={d.kind} onChange={(e) => f.set("kind", e.target.value as typeof d.kind)}>
            {siteKinds.map((k) => (
              <option key={k} value={k}>
                {SITE_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Статус">
          <StatusSelect value={d.status} onChange={(v) => f.set("status", v)} />
        </Field>
        <Field label="Название / номер" className="col-span-2">
          <Input value={d.name} onChange={(e) => f.set("name", e.target.value)} placeholder="Оп. 12" />
        </Field>
        <Field label="Адрес" className="col-span-2">
          <Input value={d.address} onChange={(e) => f.set("address", e.target.value)} />
        </Field>
        <Field label="Примечание" className="col-span-2">
          <Textarea rows={2} value={d.notes} onChange={(e) => f.set("notes", e.target.value)} />
        </Field>
      </div>
      <MutationError error={update.error} />
      {f.dirty && (
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={update.isPending}
            onClick={() => update.mutate({ id, kind: d.kind, status: d.status, name: d.name || null, address: d.address || null, notes: d.notes || null })}
          >
            Сохранить
          </Button>
          <Button size="sm" onClick={f.reset}>
            Отменить
          </Button>
        </div>
      )}
      <p className="text-xs text-slate-500">Чтобы переместить место, перетащите его на карте — трассы потянутся следом.</p>

      <EquipmentSection site={s} onTrace={(terminalId) => onSelect({ type: "trace", id: terminalId })} />

      <Section title={`Кабели (${s.cables.length})`}>
        {s.cables.length === 0 ? (
          <p className="text-sm text-slate-500">Здесь нет кабелей.</p>
        ) : (
          <ul className="space-y-1">
            {s.cables.map((c) => (
              <li key={c.id}>
                <button className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-slate-50" onClick={() => onSelect({ type: "cable", id: c.id })}>
                  <span className="min-w-0 flex-1 truncate">{c.name || c.typeName}</span>
                  <Badge tone={c.role === "end" ? "brand" : "slate"}>{c.role === "end" ? "конец" : "проходит"}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="border-t border-slate-100 pt-3">
        <MutationError error={del.error} />
        <DeleteButton label="Удалить место" onConfirm={() => del.mutate(id, { onSuccess: onClose })} />
      </div>
    </PanelShell>
  );
}

function EquipmentSection({ site, onTrace }: { site: SiteDetails; onTrace: (terminalId: string) => void }) {
  const models = useEquipmentModels();
  const create = useCreateEquipment();
  const del = useDeleteEquipment();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState("closure");
  const [modelId, setModelId] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");

  const ofKind = (models.data ?? []).filter((m) => m.kind === kind);
  const containers = site.equipment.filter((e) => ["closure", "terminal_box", "odf"].includes(e.kind));
  const roots = site.equipment.filter((e) => !e.parentId);
  const children = (pid: string) => site.equipment.filter((e) => e.parentId === pid);

  useEffect(() => {
    setModelId(ofKind[0]?.id ?? "");
    setParentId(kind === "splitter" ? (containers[0]?.id ?? "") : "");
  }, [kind, models.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const Row = ({ e, depth }: { e: SiteDetails["equipment"][number]; depth: number }) => (
    <>
      <li className="flex items-center gap-2 py-1 text-sm" style={{ paddingLeft: depth * 16 }}>
        <span className="min-w-0 flex-1">
          <span className="font-medium">{e.name || EQUIPMENT_KIND_LABELS[e.kind]}</span>
          <span className="block truncate text-xs text-slate-500">
            {EQUIPMENT_KIND_LABELS[e.kind]} · {e.modelName}
            {e.ports ? ` · портов: ${e.ports}` : ""}
          </span>
        </span>
        {["closure", "terminal_box", "odf"].includes(e.kind) && (
          <Link
            to={`/equipment/${e.id}/splicing`}
            className="rounded px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
            title="Открыть схему разварки"
          >
            Разварка
          </Link>
        )}
        <button
          className="rounded px-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          title="Удалить оборудование"
          aria-label={`Удалить ${e.name || EQUIPMENT_KIND_LABELS[e.kind]}`}
          onClick={() => del.mutate(e.id)}
        >
          ✕
        </button>
      </li>
      {e.tracePorts.length > 0 && (
        <li className="flex flex-wrap items-center gap-1 pb-2" style={{ paddingLeft: depth * 16 }}>
          <span className="mr-1 text-xs text-slate-500">{e.kind === "olt" || e.kind === "onu" ? "Трасса от PON:" : "Трасса от порта:"}</span>
          {e.tracePorts.map((p) => (
            <button
              key={p.terminalId}
              onClick={() => onTrace(p.terminalId)}
              title={p.connected ? "Построить трассу" : "Порт не подключён — трасса будет из одной точки"}
              className={
                "rounded border px-1.5 py-0.5 text-xs tabular-nums hover:border-brand-500 hover:text-brand-700 " +
                (p.connected ? "border-slate-300 text-slate-700" : "border-dashed border-slate-200 text-slate-400")
              }
            >
              {p.role === "pon" ? `PON ${p.no}` : p.no}
            </button>
          ))}
        </li>
      )}
      {children(e.id).map((c) => (
        <Row key={c.id} e={c} depth={depth + 1} />
      ))}
    </>
  );

  return (
    <Section
      title={`Оборудование (${site.equipment.length})`}
      action={
        !adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            + Добавить
          </Button>
        )
      }
    >
      {site.equipment.length === 0 && !adding && <p className="text-sm text-slate-500">Пусто.</p>}
      <ul className="divide-y divide-slate-100">
        {roots.map((e) => (
          <Row key={e.id} e={e} depth={0} />
        ))}
      </ul>
      <MutationError error={del.error} />
      {adding && (
        <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Вид">
              <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(EQUIPMENT_KIND_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Модель">
              <Select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                {ofKind.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Название" className="col-span-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "closure" ? "М-1" : ""} />
            </Field>
            {kind === "splitter" && (
              <Field label="Внутри" className="col-span-2">
                <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  <option value="">— отдельно —</option>
                  {containers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || EQUIPMENT_KIND_LABELS[c.kind]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          <MutationError error={create.error} />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={!modelId || create.isPending}
              onClick={() =>
                create.mutate(
                  { siteId: site.id, modelId, name: name || null, parentId: parentId || null, status: site.status },
                  { onSuccess: () => (setAdding(false), setName("")) },
                )
              }
            >
              Добавить
            </Button>
            <Button size="sm" onClick={() => setAdding(false)}>
              Отмена
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- трасса

export function RoutePanel({ id, onClose, onSelect }: { id: string; onClose: () => void; onSelect: Select_ }) {
  const q = useRoute(id);
  const update = useUpdateRoute();
  const del = useDeleteRoute();
  const src = useMemo(
    () => q.data && { kind: q.data.kind, name: q.data.name ?? "", status: q.data.status, notes: q.data.notes ?? "" },
    [q.data],
  );
  const f = useFormDraft(src);

  if (q.isPending) return <PanelShell title="Загрузка…" onClose={onClose}>{null}</PanelShell>;
  if (q.isError || !f.draft) return <PanelShell title="Трасса" onClose={onClose}><Alert>{q.error?.message ?? "Не найдено"}</Alert></PanelShell>;
  const r = q.data!;
  const d = f.draft;
  const siteName = (name: string | null, kind: keyof typeof SITE_KIND_LABELS) => name || SITE_KIND_LABELS[kind];

  return (
    <PanelShell title={r.name || `Трасса: ${ROUTE_KIND_LABELS[r.kind]}`} subtitle={`Длина ${fmtLen(r.lengthM)}`} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <button className="text-brand-700 hover:underline" onClick={() => onSelect({ type: "site", id: r.fromSiteId })}>
          {siteName(r.fromName, r.fromKind)}
        </button>
        <span className="text-slate-400">→</span>
        <button className="text-brand-700 hover:underline" onClick={() => onSelect({ type: "site", id: r.toSiteId })}>
          {siteName(r.toName, r.toKind)}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Вид">
          <Select value={d.kind} onChange={(e) => f.set("kind", e.target.value as typeof d.kind)}>
            {routeKinds.map((k) => (
              <option key={k} value={k}>
                {ROUTE_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Статус">
          <StatusSelect value={d.status} onChange={(v) => f.set("status", v)} />
        </Field>
        <Field label="Название" className="col-span-2">
          <Input value={d.name} onChange={(e) => f.set("name", e.target.value)} />
        </Field>
        <Field label="Примечание" className="col-span-2">
          <Textarea rows={2} value={d.notes} onChange={(e) => f.set("notes", e.target.value)} />
        </Field>
      </div>
      <MutationError error={update.error} />
      {f.dirty && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={update.isPending}
            onClick={() => update.mutate({ id, kind: d.kind, status: d.status, name: d.name || null, notes: d.notes || null })}
          >
            Сохранить
          </Button>
          <Button size="sm" onClick={f.reset}>
            Отменить
          </Button>
        </div>
      )}

      <Section title={`Кабели на трассе (${r.cables.length})`}>
        {r.cables.length === 0 ? (
          <p className="text-sm text-slate-500">Кабелей нет.</p>
        ) : (
          <ul className="space-y-1">
            {r.cables.map((c) => (
              <li key={c.id}>
                <button className="w-full truncate rounded px-1 py-1 text-left text-sm hover:bg-slate-50" onClick={() => onSelect({ type: "cable", id: c.id })}>
                  {c.name || "Без названия"} <span className="text-slate-500">· {c.typeName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="border-t border-slate-100 pt-3">
        <MutationError error={del.error} />
        <DeleteButton
          label="Удалить трассу"
          disabled={r.cables.length > 0}
          title={r.cables.length ? "По трассе проложены кабели" : undefined}
          onConfirm={() => del.mutate(id, { onSuccess: onClose })}
        />
      </div>
    </PanelShell>
  );
}

// ---------------------------------------------------------------- кабель

export function CablePanel({ id, onClose, onSelect }: { id: string; onClose: () => void; onSelect: Select_ }) {
  const q = useCable(id);
  const update = useUpdateCable();
  const del = useDeleteCable();
  const first = q.data?.spans[0];
  const last = q.data?.spans[q.data.spans.length - 1];
  const fromSite = useSite(first?.fromSiteId ?? null);
  const toSite = useSite(last?.toSiteId ?? null);
  const src = useMemo(() => q.data && { name: q.data.name ?? "", status: q.data.status, notes: q.data.notes ?? "" }, [q.data]);
  const f = useFormDraft(src);

  if (q.isPending) return <PanelShell title="Загрузка…" onClose={onClose}>{null}</PanelShell>;
  if (q.isError || !f.draft) return <PanelShell title="Кабель" onClose={onClose}><Alert>{q.error?.message ?? "Не найдено"}</Alert></PanelShell>;
  const c = q.data!;
  const d = f.draft;
  const length = c.spans.reduce((s, sp) => s + sp.routeLengthM + sp.slackM, 0);
  const slack = c.spans.reduce((s, sp) => s + sp.slackM, 0);
  const terminating = (site: SiteDetails | undefined) =>
    (site?.equipment ?? []).filter((e) => ["closure", "terminal_box", "odf"].includes(e.kind));

  const EndSelect = ({ end }: { end: "from" | "to" }) => {
    const sp = end === "from" ? first! : last!;
    const site = end === "from" ? fromSite.data : toSite.data;
    const value = (end === "from" ? sp.fromEquipmentId : sp.toEquipmentId) ?? "";
    const siteId = end === "from" ? sp.fromSiteId : sp.toSiteId;
    const siteName = (end === "from" ? sp.fromSiteName : sp.toSiteName) || SITE_KIND_LABELS[end === "from" ? sp.fromSiteKind : sp.toSiteKind];
    return (
      <div className="rounded-lg border border-slate-200 p-2">
        <button className="text-sm font-medium text-brand-700 hover:underline" onClick={() => onSelect({ type: "site", id: siteId })}>
          {end === "from" ? "Начало" : "Конец"}: {siteName}
        </button>
        <Select
          className="mt-1 h-8"
          value={value}
          aria-label={end === "from" ? "Оборудование в начале" : "Оборудование в конце"}
          onChange={(e) => update.mutate({ id, [end === "from" ? "fromEquipmentId" : "toEquipmentId"]: e.target.value || null })}
        >
          <option value="">— не заведён в оборудование —</option>
          {terminating(site).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name || EQUIPMENT_KIND_LABELS[e.kind]} ({EQUIPMENT_KIND_LABELS[e.kind]})
            </option>
          ))}
        </Select>
      </div>
    );
  };

  return (
    <PanelShell title={c.name || c.typeName} subtitle={`${c.typeName} · ${c.fiberCount} вол. · ${fmtLen(length)}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Название" className="col-span-2">
          <Input value={d.name} onChange={(e) => f.set("name", e.target.value)} placeholder="Магистраль УС1–М1" />
        </Field>
        <Field label="Статус">
          <StatusSelect value={d.status} onChange={(v) => f.set("status", v)} />
        </Field>
        <Field label="Длина">
          <div className="flex h-9 items-center text-sm">
            {fmtLen(length)}
            {slack > 0 && <span className="ml-1 text-slate-500">(запас {Math.round(slack)} м)</span>}
          </div>
        </Field>
        <Field label="Примечание" className="col-span-2">
          <Textarea rows={2} value={d.notes} onChange={(e) => f.set("notes", e.target.value)} />
        </Field>
      </div>
      <MutationError error={update.error} />
      {f.dirty && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={update.isPending}
            onClick={() => update.mutate({ id, name: d.name || null, status: d.status, notes: d.notes || null })}
          >
            Сохранить
          </Button>
          <Button size="sm" onClick={f.reset}>
            Отменить
          </Button>
        </div>
      )}

      {first && last && (
        <Section title="Концы кабеля">
          <div className="space-y-2">
            <EndSelect end="from" />
            <EndSelect end="to" />
          </div>
        </Section>
      )}

      <Section title="Состав">
        <p className="text-sm text-slate-600">
          Пролётов: {c.spans.length}, участков трассы: {c.spans.reduce((s, sp) => s + sp.routeIds.length, 0)}, соединений волокон:{" "}
          {c.connections}.
        </p>
      </Section>

      <div className="border-t border-slate-100 pt-3">
        <MutationError error={del.error} />
        <DeleteButton
          label="Удалить кабель"
          disabled={c.connections > 0}
          title={c.connections ? "У кабеля есть сварки" : undefined}
          onConfirm={() => del.mutate(id, { onSuccess: onClose })}
        />
      </div>
    </PanelShell>
  );
}
