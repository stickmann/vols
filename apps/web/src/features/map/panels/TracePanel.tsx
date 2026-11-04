import {
  assessBudget,
  GPON_CLASS_BUDGET_DB,
  TRACE_END_LABELS,
  WAVELENGTHS,
  type GponClass,
  type TraceNode,
  type TraceResult,
  type Wavelength,
} from "@vols/shared";
import { useEffect, useMemo, useState } from "react";
import { ColorChip } from "../../../components/ColorChip.js";
import { Alert, Badge, Button, Field, Input, Select, cx } from "../../../components/ui/index.js";
import { locateFault, useTrace, type LocateResult } from "../api.js";
import { PanelShell } from "./Panels.js";

const fmtLen = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} км` : `${Math.round(m)} м`);
const fmtDb = (x: number) => `${x.toFixed(2)} дБ`;

const STATUS_STYLE = {
  ok: { tone: "green" as const, text: "в норме" },
  low_margin: { tone: "amber" as const, text: "малый запас" },
  over: { tone: "amber" as const, text: "превышен бюджет" },
  under: { tone: "slate" as const, text: "ниже минимума" },
};

/** Путь от корня трассы до узла. */
export function pathTo(t: TraceResult, i: number): TraceNode[] {
  const out: TraceNode[] = [];
  for (let n: TraceNode | undefined = t.nodes[i]; n; n = n.parent === null ? undefined : t.nodes[n.parent]) out.unshift(n);
  return out;
}

export interface TraceView {
  /** Пролёты для подсветки (вся трасса или путь до выбранной конечной точки). */
  spanIds: Set<string>;
  /** Места конечных точек. */
  endSiteIds: string[];
  marker: [number, number] | null;
}

export function TracePanel({
  terminalId,
  onClose,
  onView,
  onFocus,
}: {
  terminalId: string;
  onClose: () => void;
  onView: (v: TraceView) => void;
  onFocus: (p: [number, number]) => void;
}) {
  const q = useTrace(terminalId);
  const [cls, setCls] = useState<GponClass>("B+");
  const [wl, setWl] = useState<Wavelength>(1490);
  const [leaf, setLeaf] = useState<number | null>(null);
  const [distance, setDistance] = useState("");
  const [found, setFound] = useState<LocateResult | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const t = q.data;
  const leaves = useMemo(
    () => (t ? t.leaves.map((i) => t.nodes[i]!).sort((a, b) => b.loss[wl] - a.loss[wl]) : []),
    [t, wl],
  );
  const path = t && leaf !== null ? pathTo(t, leaf) : null;

  // Одна конечная точка — сразу показываем путь до неё.
  useEffect(() => {
    if (t && t.leaves.length === 1) setLeaf(t.leaves[0]!);
  }, [t]);

  useEffect(() => {
    if (!t) return;
    const nodes = path ?? t.nodes;
    onView({
      spanIds: new Set(nodes.map((n) => n.spanId).filter((x): x is string => !!x)),
      endSiteIds: (path ? [path[path.length - 1]!] : leaves).map((n) => n.siteId),
      marker: found?.position ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, leaf, found]);

  useEffect(() => {
    setFound(null);
    setLocError(null);
  }, [leaf]);

  if (q.isPending) return <PanelShell title="Трассировка…" onClose={onClose}>{null}</PanelShell>;
  if (q.isError || !t)
    return (
      <PanelShell title="Трассировка" onClose={onClose}>
        <Alert>{q.error?.message ?? "Не удалось построить трассу"}</Alert>
      </PanelShell>
    );

  const worst = leaves[0];
  const startNode = t.nodes[0]!;

  const locate = async () => {
    if (leaf === null) return;
    const d = Number(distance.replace(",", "."));
    if (!Number.isFinite(d) || d < 0) return setLocError("Укажите расстояние в метрах");
    setLocating(true);
    setLocError(null);
    try {
      const r = await locateFault(terminalId, t.nodes[leaf]!.terminalId, d);
      setFound(r);
      if (r.position) onFocus(r.position);
    } catch (e) {
      setLocError(e instanceof Error ? e.message : String(e));
    } finally {
      setLocating(false);
    }
  };

  return (
    <PanelShell title={`Трасса: ${t.start.label}`} subtitle={startNode.siteName ?? undefined} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Класс оптики">
          <Select value={cls} onChange={(e) => setCls(e.target.value as GponClass)}>
            {Object.entries(GPON_CLASS_BUDGET_DB).map(([k, v]) => (
              <option key={k} value={k}>
                {k} ({v.min}–{v.max} дБ)
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Длина волны">
          <Select value={wl} onChange={(e) => setWl(Number(e.target.value) as Wavelength)}>
            {WAVELENGTHS.map((w) => (
              <option key={w} value={w}>
                {w} нм{w === 1490 ? " (вниз)" : w === 1310 ? " (вверх)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {worst && (
        <p className="text-sm text-slate-600">
          Конечных точек: <b>{leaves.length}</b>. Худшая: <b>{fmtDb(worst.loss[wl])}</b> на {fmtLen(worst.distanceM)}, запас{" "}
          <b>{fmtDb(assessBudget(worst.loss[wl], cls).margin)}</b>.
        </p>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Конечные точки</h3>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {leaves.map((n) => {
            const a = assessBudget(n.loss[wl], cls);
            const st = STATUS_STYLE[a.status];
            const active = leaf === n.i;
            return (
              <li key={n.i}>
                <button
                  className={cx("w-full px-3 py-2 text-left hover:bg-slate-50", active && "bg-brand-50")}
                  onClick={() => setLeaf(active ? null : n.i)}
                  aria-pressed={active}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{n.label}</span>
                    <span className="text-sm tabular-nums">{fmtDb(n.loss[wl])}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                    <span className="min-w-0 flex-1 truncate">
                      {TRACE_END_LABELS[n.end!]} · {n.siteName ?? "…"} · {fmtLen(n.distanceM)}
                    </span>
                    {n.end !== "open_fiber" && (
                      <span
                        title={
                          a.status === "under"
                            ? `Затухание меньше минимума класса ${cls} (${a.min} дБ): приёмник ONU может перегружаться, нужен аттенюатор`
                            : a.status === "over"
                              ? `Затухание больше бюджета класса ${cls} (${a.max} дБ)`
                              : `Запас до ${a.max} дБ`
                        }
                      >
                        <Badge tone={st.tone}>
                          {a.status === "ok" ? `запас ${a.margin.toFixed(1)}` : a.status === "under" ? `ниже ${a.min} дБ` : st.text}
                        </Badge>
                      </span>
                    )}
                    {n.end === "open_fiber" && <Badge tone="amber">не разварено</Badge>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        {leaves.length > 1 && leaf === null && <p className="mt-1 text-xs text-slate-500">Выберите точку, чтобы увидеть путь и найти место по рефлектометру.</p>}
      </section>

      {path && (
        <>
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Путь ({path.length} точек)</h3>
            <ol className="space-y-0.5 text-sm">
              {path.map((n) => (
                <li key={n.i} className="flex items-start gap-2 rounded px-1 py-0.5 hover:bg-slate-50">
                  <span className="mt-1 w-4 shrink-0 text-center text-xs text-slate-400" title={n.via}>
                    {VIA_ICON[n.via]}
                  </span>
                  {n.color ? <ColorChip color={n.color} size={14} /> : <span className="w-3.5 shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{n.label}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {stepText(n)}
                      {n.siteName ? ` · ${n.siteName}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-slate-600">
                    {n.stepLoss[wl] > 0 && <span className="block">+{n.stepLoss[wl].toFixed(2)}</span>}
                    <span className="block font-medium text-slate-800">{n.loss[wl].toFixed(2)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-lg bg-slate-50 p-3">
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Найти место по рефлектометру</h3>
            <p className="mb-2 text-xs text-slate-500">
              Прибор подключён в начале трассы ({t.start.label}). Расстояние до события — по рефлектограмме.
            </p>
            <div className="flex items-end gap-2">
              <Field label="Расстояние, м" className="flex-1">
                <Input inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void locate()} placeholder="например, 1250" />
              </Field>
              <Button variant="primary" onClick={() => void locate()} disabled={locating || !distance.trim()}>
                Найти
              </Button>
            </div>
            {locError && <div className="mt-2"><Alert>{locError}</Alert></div>}
            {found && (
              <div className="mt-2">
                <Alert tone={found.beyond ? "warning" : "info"}>{found.description}</Alert>
              </div>
            )}
          </section>
        </>
      )}
    </PanelShell>
  );
}

const VIA_ICON: Record<TraceNode["via"], string> = { start: "●", connection: "⨯", fiber: "│", splitter: "⑃", adapter: "◫" };

function stepText(n: TraceNode): string {
  switch (n.via) {
    case "start":
      return "начало";
    case "fiber":
      return `волокно ${fmtLen(n.stepLengthM)}`;
    case "splitter":
      return "сплиттер";
    case "adapter":
      return "через адаптер";
    case "connection":
      return n.connectionKind === "through" ? "транзит" : n.connectionKind === "patch" ? "патч-корд" : n.connectionKind === "mechanical" ? "мех. сплайс" : "сварка";
  }
}
