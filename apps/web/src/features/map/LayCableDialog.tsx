import { objectStatuses, type ObjectStatus } from "@vols/shared";
import { useEffect, useState } from "react";
import { Alert, Button, Dialog, Field, Input, Select } from "../../components/ui/index.js";
import { useCreateCable, useSite } from "./api.js";
import { EQUIPMENT_KIND_LABELS, SITE_KIND_LABELS, STATUS_LABELS } from "./style.js";
import type { SiteDetails } from "./types.js";

const terminating = (s: SiteDetails | undefined) => (s?.equipment ?? []).filter((e) => ["closure", "terminal_box", "odf"].includes(e.kind));

/** Последний шаг прокладки: название, статус, оборудование на концах и запасы. */
export function LayCableDialog({
  open,
  onClose,
  cableTypeId,
  typeName,
  siteIds,
  lengthM,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  cableTypeId: string;
  typeName: string;
  siteIds: string[];
  lengthM: number;
  onCreated: (cableId: string) => void;
}) {
  const fromId = siteIds[0] ?? null;
  const toId = siteIds[siteIds.length - 1] ?? null;
  const from = useSite(open ? fromId : null);
  const to = useSite(open ? toId : null);
  const create = useCreateCable();
  const [name, setName] = useState("");
  const [status, setStatus] = useState<ObjectStatus>("planned");
  const [fromEq, setFromEq] = useState("");
  const [toEq, setToEq] = useState("");
  const [slackFrom, setSlackFrom] = useState("");
  const [slackTo, setSlackTo] = useState("");

  // По умолчанию заводим кабель в первое подходящее оборудование на концах.
  useEffect(() => setFromEq(terminating(from.data)[0]?.id ?? ""), [from.data]);
  useEffect(() => setToEq(terminating(to.data)[0]?.id ?? ""), [to.data]);
  useEffect(() => {
    if (open) create.reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = (s: SiteDetails | undefined) => (s ? s.name || SITE_KIND_LABELS[s.kind] : "…");
  const num = (v: string) => (v.trim() ? Number(v.replace(",", ".")) : 0);
  const slacks = [
    { siteId: fromId!, lengthM: num(slackFrom) },
    { siteId: toId!, lengthM: num(slackTo) },
  ].filter((s) => s.lengthM > 0);
  const totalLength = lengthM + slacks.reduce((a, s) => a + s.lengthM, 0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Новый кабель"
      footer={
        <>
          <Button onClick={onClose}>Назад к пути</Button>
          <Button
            variant="primary"
            disabled={create.isPending || !fromId || !toId}
            onClick={() =>
              create.mutate(
                {
                  cableTypeId,
                  name: name.trim() || null,
                  status,
                  siteIds,
                  fromEquipmentId: fromEq || null,
                  toEquipmentId: toEq || null,
                  slacks,
                },
                { onSuccess: (r) => onCreated(r.id) },
              )
            }
          >
            Проложить
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          {typeName} · по трассам {Math.round(lengthM)} м, всего с запасами <b>{Math.round(totalLength)} м</b>
        </p>
        <div className="grid grid-cols-[1fr_9rem] gap-2">
          <Field label="Название">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Магистраль УС1–М3" autoFocus />
          </Field>
          <Field label="Статус">
            <Select value={status} onChange={(e) => setStatus(e.target.value as ObjectStatus)}>
              {objectStatuses.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <EndField title="Начало" name={label(from.data)} site={from.data} value={fromEq} set={setFromEq} slack={slackFrom} setSlack={setSlackFrom} />
        <EndField title="Конец" name={label(to.data)} site={to.data} value={toEq} set={setToEq} slack={slackTo} setSlack={setSlackTo} />
        {create.error && <Alert>{create.error.message}</Alert>}
      </div>
    </Dialog>
  );
}

function EndField({
  title,
  name,
  site,
  value,
  set,
  slack,
  setSlack,
}: {
  title: string;
  name: string;
  site: SiteDetails | undefined;
  value: string;
  set: (v: string) => void;
  slack: string;
  setSlack: (v: string) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 text-sm font-medium">
        {title}: {name}
      </div>
      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <Field label="Заводится в">
          <Select value={value} onChange={(e) => set(e.target.value)}>
            <option value="">— никуда —</option>
            {terminating(site).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name || EQUIPMENT_KIND_LABELS[e.kind]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Запас, м">
          <Input inputMode="decimal" value={slack} onChange={(e) => setSlack(e.target.value)} placeholder="0" />
        </Field>
      </div>
    </div>
  );
}
