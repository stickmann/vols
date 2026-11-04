import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ColorChip } from "../../components/ColorChip.js";
import { Alert, Badge, Button, Dialog, Field, Input, Select, cx } from "../../components/ui/index.js";
import { EQUIPMENT_KIND_LABELS, SITE_KIND_LABELS } from "../map/style.js";
import {
  useConnect,
  useConnectBatch,
  useDisconnect,
  useDisconnectMany,
  useEnterCable,
  useLeaveCable,
  useSplicing,
  useUpdateConnection,
  type CableIn,
  type Conn,
  type SplicingData,
} from "./api.js";
import { CableBlock, ConnectionLines, DeviceBlock, type DiagramCtx } from "./Diagram.js";
import {
  connectionByTerminal,
  KIND_LABELS,
  planPairs,
  sequences,
  stats,
  terminalIndex,
  TYPICAL_LOSS,
  type Sequence,
  type TerminalInfo,
} from "./model.js";

export function SplicingPage() {
  const { id } = useParams();
  const q = useSplicing(id!);
  if (q.isPending) return <div className="p-6 text-sm text-slate-500">Загрузка…</div>;
  if (q.isError)
    return (
      <div className="p-6">
        <Alert>{q.error.message}</Alert>
      </div>
    );
  return <Editor data={q.data} />;
}

function Editor({ data }: { data: SplicingData }) {
  const eq = data.equipment;
  const connect = useConnect(eq.id);
  const disconnect = useDisconnect(eq.id);
  const disconnectMany = useDisconnectMany(eq.id);
  const leave = useLeaveCable(eq.id);

  const index = useMemo(() => terminalIndex(data), [data]);
  const byTerminal = useMemo(() => connectionByTerminal(data.connections), [data.connections]);
  const s = stats(data);

  const [pending, setPending] = useState<string | null>(null);
  const [selectedConn, setSelectedConn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  // Кабели, пришедшие в корпус, по умолчанию слева, уходящие — справа.
  const [swapped, setSwapped] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Map<string, Set<number>>>(new Map());
  const diagram = useRef<HTMLDivElement>(null);

  const columnOf = (c: CableIn) => ((c.side === "b") !== swapped.has(c.spanId) ? "left" : "right");
  const left = data.cables.filter((c) => columnOf(c) === "left");
  const right = data.cables.filter((c) => columnOf(c) === "right");
  const container = data.devices.find((d) => d.id === eq.id);
  const inner = data.devices.filter((d) => d.id !== eq.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPending(null);
        setSelectedConn(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onTerminal = (tid: string) => {
    setError(null);
    const conn = byTerminal.get(tid);
    if (conn) {
      setPending(null);
      setSelectedConn(conn.id === selectedConn ? null : conn.id);
      return;
    }
    setSelectedConn(null);
    if (!pending) return setPending(tid);
    if (pending === tid) return setPending(null);
    connect.mutate(
      { aTerminalId: pending, bTerminalId: tid },
      { onSuccess: () => setPending(null), onError: (e) => (setError(e.message), setPending(null)) },
    );
  };

  const ctx: DiagramCtx = { byTerminal, index, pending, selectedConn, onTerminal };
  const selected = data.connections.find((c) => c.id === selectedConn) ?? null;

  const throughOf = (c: CableIn) =>
    (c.fibers ?? [])
      .map((f) => byTerminal.get(f.terminalId))
      .filter((x): x is Conn => !!x && x.kind === "through");

  const cableActions = (c: CableIn) => {
    const through = throughOf(c);
    const busy = (c.fibers ?? []).some((f) => byTerminal.has(f.terminalId));
    return (
      <>
        {through.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            title="Разрезать все транзитные волокна кабеля, чтобы развести их"
            onClick={() => disconnectMany.mutate(through.map((t) => t.id), { onError: (e) => setError(e.message) })}
          >
            ✂ транзит ({through.length})
          </Button>
        )}
        <Button size="sm" variant="ghost" title="Перенести на другую сторону схемы" onClick={() => setSwapped((p) => toggle(p, c.spanId))}>
          ⇄
        </Button>
        {!busy && (
          <Button size="sm" variant="ghost" title="Вывести кабель из корпуса" onClick={() => leave.mutate(c.spanId, { onError: (e) => setError(e.message) })}>
            ✕
          </Button>
        )}
      </>
    );
  };

  const cableColumn = (list: CableIn[], column: "left" | "right") => (
    <div className="space-y-3">
      {list.map((c) => (
        <CableBlock
          key={c.spanId}
          cable={c}
          column={column}
          ctx={ctx}
          collapsed={collapsed.get(c.spanId) ?? new Set()}
          onToggleModule={(m) => setCollapsed((p) => new Map(p).set(c.spanId, toggle(p.get(c.spanId) ?? new Set(), m)))}
          onCutModule={(_m, ids) => disconnectMany.mutate(ids, { onError: (e) => setError(e.message) })}
          actions={cableActions(c)}
        />
      ))}
      {list.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400">
          {column === "left" ? "Нет приходящих кабелей" : "Нет уходящих кабелей"}
        </div>
      )}
    </div>
  );

  const siteLabel = eq.siteName || SITE_KIND_LABELS[eq.siteKind];

  return (
    <div className="mx-auto max-w-[1400px] p-4 pb-40 md:p-6 md:pb-40">
      <nav className="mb-1 text-sm text-slate-500" aria-label="Навигация">
        <Link to={`/map?site=${eq.siteId}`} className="hover:text-slate-800 hover:underline">
          Карта
        </Link>{" "}
        › {siteLabel}
      </nav>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">
            Разварка: {eq.name || EQUIPMENT_KIND_LABELS[eq.kind]}
          </h1>
          <p className="text-sm text-slate-500">
            {EQUIPMENT_KIND_LABELS[eq.kind]} · {eq.modelName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge tone="brand">
            сварок {s.splices}
            {eq.maxSplices ? ` / ${eq.maxSplices}` : ""}
          </Badge>
          {s.through > 0 && <Badge>транзит {s.through}</Badge>}
          {s.patches > 0 && <Badge>патч-кордов {s.patches}</Badge>}
          <Badge tone={s.freeFibers ? "amber" : "green"}>
            свободных волокон {s.freeFibers} / {s.totalFibers}
          </Badge>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <EnterCableMenu data={data} onError={setError} />
        <Button onClick={() => setBatchOpen(true)} disabled={data.cables.length === 0}>
          Сварить по порядку…
        </Button>
        <Button variant="ghost" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
          {showTable ? "Скрыть таблицу" : "Таблица соединений"}
        </Button>
        <span className="text-sm text-slate-500">
          {pending
            ? `Выбрано: ${index.get(pending)?.label}. Кликните вторую точку, Esc — отмена.`
            : "Кликните свободное волокно или порт, затем второе — появится сварка. Клик по занятому покажет соединение."}
        </span>
        {pending && (
          <Link to={`/map?trace=${pending}`} className="text-sm font-medium text-brand-700 hover:underline">
            Трассировать от выбранной точки
          </Link>
        )}
      </div>

      {(error || connect.error) && (
        <div className="mb-3">
          <Alert>{error ?? connect.error?.message}</Alert>
        </div>
      )}

      {showTable && <ConnectionsTable connections={data.connections} index={index} onSelect={setSelectedConn} selected={selectedConn} />}

      {data.cables.length === 0 && inner.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          В корпус ещё не заведено ни одного кабеля. Нажмите «Завести кабель».
        </div>
      ) : (
        <div ref={diagram} className="relative">
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(190px,260px)_minmax(0,1fr)] md:gap-20">
            {cableColumn(left, "left")}
            <div className="space-y-3">
              {inner.map((d) => (
                <DeviceBlock key={d.id} device={d} ctx={ctx} />
              ))}
              {container && <DeviceBlock device={container} ctx={ctx} title={`Порты ${EQUIPMENT_KIND_LABELS[eq.kind]?.toLowerCase()}`} />}
              {inner.length === 0 && !container?.ports?.length && (
                <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400">
                  Сплиттеров нет. Добавить сплиттер в муфту можно в панели места на карте.
                </div>
              )}
            </div>
            {cableColumn(right, "right")}
          </div>
          <ConnectionLines
            container={diagram}
            connections={data.connections}
            index={index}
            selected={selectedConn}
            onSelect={(cid) => (setPending(null), setSelectedConn(cid))}
            deps={[swapped, collapsed, showTable]}
          />
        </div>
      )}

      {selected && (
        <ConnectionCard
          key={selected.id}
          equipmentId={eq.id}
          conn={selected}
          index={index}
          onClose={() => setSelectedConn(null)}
          onDelete={() =>
            disconnect.mutate(selected.id, { onSuccess: () => setSelectedConn(null), onError: (e) => setError(e.message) })
          }
        />
      )}

      <BatchDialog open={batchOpen} onClose={() => setBatchOpen(false)} data={data} busy={byTerminal} />
    </div>
  );
}

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const n = new Set(set);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
}

// ---------------------------------------------------------------- завести кабель

function EnterCableMenu({ data, onError }: { data: SplicingData; onError: (m: string) => void }) {
  const enter = useEnterCable(data.equipment.id);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <Button variant="primary" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={enter.isPending}>
        Завести кабель {data.candidates.length > 0 && `(${data.candidates.length})`}
      </Button>
      {open && (
        <div className="absolute z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white py-1 shadow-lg" role="menu">
          {data.candidates.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">
              В этом месте нет свободных концов и транзитных кабелей. Проложите кабель на карте.
            </p>
          ) : (
            data.candidates.map((c) => (
              <button
                key={c.spanId}
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() =>
                  enter.mutate(c.spanId, { onSuccess: () => setOpen(false), onError: (e) => (onError(e.message), setOpen(false)) })
                }
              >
                <span className="font-medium">{c.name || c.typeName}</span>
                <span className="block text-xs text-slate-500">
                  {c.mode === "end"
                    ? "конец кабеля в этом месте"
                    : "проходит транзитом — будет заведён с разрезом пролёта, волокна пойдут транзитом"}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- карточка соединения

function ConnectionCard({
  equipmentId,
  conn,
  index,
  onClose,
  onDelete,
}: {
  equipmentId: string;
  conn: Conn;
  index: Map<string, TerminalInfo>;
  onClose: () => void;
  onDelete: () => void;
}) {
  const update = useUpdateConnection(equipmentId);
  const navigate = useNavigate();
  const [kind, setKind] = useState(conn.kind);
  const [loss, setLoss] = useState(conn.lossDb?.toString() ?? "");
  const [tray, setTray] = useState(conn.trayNo?.toString() ?? "");
  const [slot, setSlot] = useState(conn.slotNo?.toString() ?? "");
  const a = index.get(conn.aTerminalId);
  const b = index.get(conn.bTerminalId);
  const num = (v: string) => (v.trim() ? Number(v.replace(",", ".")) : null);
  const isThrough = conn.kind === "through";

  const End = ({ t }: { t: TerminalInfo | undefined }) => (
    <span className="flex min-w-0 items-center gap-1.5">
      {t?.color && <ColorChip color={t.color} size={16} />}
      <span className="truncate">{t?.label ?? "?"}</span>
    </span>
  );

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.06)]" role="region" aria-label="Соединение">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-end gap-3 px-4 py-3 md:px-6">
        <div className="min-w-0 flex-1 basis-72 text-sm">
          <div className="mb-1 text-xs font-semibold text-slate-500 uppercase">{KIND_LABELS[conn.kind]}</div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <End t={a} />
            <span className="text-slate-400">↔</span>
            <End t={b} />
          </div>
        </div>
        {isThrough ? (
          <p className="max-w-sm text-sm text-slate-600">Волокно проходит муфту не разрезанным. Чтобы развести его, разрежьте транзит.</p>
        ) : (
          <>
            <Field label="Вид" className="w-44">
              <Select value={kind} onChange={(e) => setKind(e.target.value as Conn["kind"])}>
                <option value="fusion">Сварка</option>
                <option value="mechanical">Механический сплайс</option>
                <option value="patch">Патч-корд</option>
              </Select>
            </Field>
            <Field label="Потери, дБ" className="w-28">
              <Input inputMode="decimal" value={loss} onChange={(e) => setLoss(e.target.value)} placeholder={String(TYPICAL_LOSS[kind] ?? "")} />
            </Field>
            <Field label="Кассета" className="w-20">
              <Input inputMode="numeric" value={tray} onChange={(e) => setTray(e.target.value)} />
            </Field>
            <Field label="Место" className="w-20">
              <Input inputMode="numeric" value={slot} onChange={(e) => setSlot(e.target.value)} />
            </Field>
            <Button
              variant="primary"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({
                  id: conn.id,
                  kind: kind as "fusion" | "mechanical" | "patch",
                  lossDb: num(loss),
                  trayNo: num(tray),
                  slotNo: num(slot),
                })
              }
            >
              Сохранить
            </Button>
          </>
        )}
        <Button onClick={() => navigate(`/map?trace=${conn.aTerminalId}`)} title="Показать трассу на карте и посчитать затухание">
          Трассировать
        </Button>
        <Button variant="danger" onClick={onDelete}>
          {isThrough ? "✂ Разрезать" : "Удалить"}
        </Button>
        <Button variant="ghost" onClick={onClose} aria-label="Закрыть">
          ✕
        </Button>
        {update.error && <div className="basis-full"><Alert>{update.error.message}</Alert></div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- таблица

function ConnectionsTable({
  connections,
  index,
  onSelect,
  selected,
}: {
  connections: Conn[];
  index: Map<string, TerminalInfo>;
  onSelect: (id: string) => void;
  selected: string | null;
}) {
  const cell = (t: TerminalInfo | undefined) => (
    <span className="flex items-center gap-1.5">
      {t?.color && <ColorChip color={t.color} size={14} />}
      <span>{t?.label ?? "?"}</span>
    </span>
  );
  return (
    <div className="mb-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">№</th>
            <th className="px-3 py-2 font-medium">Откуда</th>
            <th className="px-3 py-2 font-medium">Куда</th>
            <th className="px-3 py-2 font-medium">Вид</th>
            <th className="px-3 py-2 font-medium">Потери, дБ</th>
            <th className="px-3 py-2 font-medium">Кассета / место</th>
          </tr>
        </thead>
        <tbody>
          {connections.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                Соединений пока нет.
              </td>
            </tr>
          )}
          {connections.map((c, i) => (
            <tr
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={cx("cursor-pointer border-t border-slate-100 hover:bg-slate-50", selected === c.id && "bg-brand-50")}
            >
              <td className="px-3 py-1.5 tabular-nums">{i + 1}</td>
              <td className="px-3 py-1.5">{cell(index.get(c.aTerminalId))}</td>
              <td className="px-3 py-1.5">{cell(index.get(c.bTerminalId))}</td>
              <td className="px-3 py-1.5">{KIND_LABELS[c.kind]}</td>
              <td className="px-3 py-1.5 tabular-nums">
                {c.lossDb ?? <span className="text-slate-400">{TYPICAL_LOSS[c.kind]} (тип.)</span>}
              </td>
              <td className="px-3 py-1.5 tabular-nums">
                {c.trayNo ?? "—"} / {c.slotNo ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- сварка по порядку

function BatchDialog({ open, onClose, data, busy }: { open: boolean; onClose: () => void; data: SplicingData; busy: Map<string, Conn> }) {
  const batch = useConnectBatch(data.equipment.id);
  const seqs = useMemo(() => sequences(data), [data]);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [fromStart, setFromStart] = useState(1);
  const [toStart, setToStart] = useState(1);
  const [count, setCount] = useState(8);
  const [tray, setTray] = useState("");

  useEffect(() => {
    if (!open) return;
    batch.reset();
    setFromId((v) => v || seqs[0]?.id || "");
    setToId((v) => v || seqs[1]?.id || seqs[0]?.id || "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const from = seqs.find((s) => s.id === fromId);
  const to = seqs.find((s) => s.id === toId);
  const pairs = from && to ? planPairs(from, fromStart, to, toStart, count, new Set(busy.keys())) : [];
  const ok = pairs.filter((p) => !p.busy);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Сварить по порядку"
      wide
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            disabled={ok.length === 0 || batch.isPending}
            onClick={() =>
              batch.mutate(
                { pairs: ok.map((p) => ({ aTerminalId: p.a.id, bTerminalId: p.b.id })), trayNo: tray.trim() ? Number(tray) : null },
                { onSuccess: onClose },
              )
            }
          >
            Сварить {ok.length}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Соединяет волокна или порты попарно по порядку: например, волокна 1–8 магистрали с выходами сплиттера или модуль в
          модуль. Занятые точки пропускаются.
        </p>
        <SeqPicker seqs={seqs} label="Откуда" value={fromId} onChange={setFromId} start={fromStart} setStart={setFromStart} />
        <SeqPicker seqs={seqs} label="Куда" value={toId} onChange={setToId} start={toStart} setStart={setToStart} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Сколько">
            <Input type="number" min={1} max={576} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </Field>
          <Field label="Кассета" hint="Необязательно">
            <Input inputMode="numeric" value={tray} onChange={(e) => setTray(e.target.value)} />
          </Field>
        </div>
        {pairs.length > 0 && (
          <div className="max-h-56 overflow-auto rounded-md border border-slate-200 text-sm">
            {pairs.map((p, i) => (
              <div key={i} className={cx("flex justify-between gap-2 border-b border-slate-100 px-3 py-1 last:border-0", p.busy && "text-slate-400 line-through")}>
                <span>{p.a.label}</span>
                <span>→</span>
                <span>{p.b.label}</span>
              </div>
            ))}
          </div>
        )}
        {pairs.some((p) => p.busy) && <p className="text-xs text-slate-500">Зачёркнутые пары пропущены: одна из точек уже занята.</p>}
        {batch.error && <Alert>{batch.error.message}</Alert>}
      </div>
    </Dialog>
  );
}


function SeqPicker({
  seqs,
  value,
  onChange,
  start,
  setStart,
  label,
}: {
  seqs: Sequence[];
  value: string;
  onChange: (v: string) => void;
  start: number;
  setStart: (n: number) => void;
  label: string;
}) {
  const seq = seqs.find((s) => s.id === value);
  return (
    <div className="grid grid-cols-[1fr_6rem] gap-2">
      <Field label={label}>
        <Select
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setStart(seqs.find((s) => s.id === e.target.value)?.terminals[0]?.n ?? 1);
          }}
        >
          {seqs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Начиная с">
        <Select value={start} onChange={(e) => setStart(Number(e.target.value))}>
          {seq?.terminals.map((t) => (
            <option key={t.id} value={t.n}>
              {t.n}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
