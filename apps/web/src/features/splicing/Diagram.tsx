import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ColorChip } from "../../components/ColorChip.js";
import { cx } from "../../components/ui/index.js";
import { colorLabel } from "../../lib/color.js";
import type { CableIn, Conn, Device, FiberIn, Port } from "./api.js";
import { cableLabel, deviceLabel, partnerOf, type TerminalInfo } from "./model.js";

/** Общие для всех строк схемы обработчики и состояние выбора. */
export interface DiagramCtx {
  byTerminal: Map<string, Conn>;
  index: Map<string, TerminalInfo>;
  pending: string | null;
  selectedConn: string | null;
  onTerminal: (terminalId: string) => void;
}

/** Точка, к которой подходит линия соединения. dir — куда «смотрит» точка: вправо (1) или влево (-1). */
function Dot({ id, dir, state }: { id: string; dir: 1 | -1; state: "free" | "busy" | "through" | "pending" | "selected" }) {
  return (
    <span
      data-term={id}
      data-dir={dir}
      className={cx(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2",
        state === "free" && "border-slate-400 bg-white",
        state === "busy" && "border-slate-700 bg-slate-700",
        state === "through" && "border-slate-400 bg-slate-300",
        state === "pending" && "animate-pulse border-brand-600 bg-brand-500",
        state === "selected" && "border-brand-600 bg-brand-600",
      )}
    />
  );
}

function terminalState(ctx: DiagramCtx, id: string) {
  if (ctx.pending === id) return "pending" as const;
  const c = ctx.byTerminal.get(id);
  if (!c) return "free" as const;
  if (c.id === ctx.selectedConn) return "selected" as const;
  return c.kind === "through" ? ("through" as const) : ("busy" as const);
}

function partnerText(ctx: DiagramCtx, id: string) {
  const c = ctx.byTerminal.get(id);
  if (!c) return null;
  const p = ctx.index.get(partnerOf(c, id));
  if (c.kind === "through") return "транзит";
  return p?.short ?? "?";
}

// ---------------------------------------------------------------- кабель

export function CableBlock({
  cable,
  column,
  ctx,
  collapsed,
  onToggleModule,
  onCutModule,
  actions,
}: {
  cable: CableIn;
  column: "left" | "right";
  ctx: DiagramCtx;
  collapsed: Set<number>;
  onToggleModule: (module: number) => void;
  /** Разрезать транзит модуля (если есть). */
  onCutModule?: (module: number, connIds: string[]) => void;
  actions: ReactNode;
}) {
  const modules = new Map<number, FiberIn[]>();
  for (const f of cable.fibers ?? []) (modules.get(f.module) ?? modules.set(f.module, []).get(f.module)!).push(f);
  const dir = column === "left" ? 1 : -1;

  return (
    <section className="rounded-lg border border-slate-200 bg-white" aria-label={`Кабель ${cableLabel(cable)}`}>
      <header className="flex flex-wrap items-start gap-2 border-b border-slate-100 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{cableLabel(cable)}</div>
          <div className="truncate text-xs text-slate-500">
            {cable.name ? `${cable.typeName} · ` : ""}
            {cable.side === "b" ? "приходит от" : "уходит к"} {cable.otherSiteName || "…"}
          </div>
        </div>
        <div className="flex gap-0.5">{actions}</div>
      </header>
      <div className="py-1">
        {[...modules.entries()].map(([no, fibers]) => {
          const isCollapsed = collapsed.has(no);
          const mc = fibers[0]!.moduleColor;
          const busy = fibers.filter((f) => ctx.byTerminal.has(f.terminalId)).length;
          const throughIds = fibers
            .map((f) => ctx.byTerminal.get(f.terminalId))
            .filter((c): c is Conn => !!c && c.kind === "through")
            .map((c) => c.id);
          return (
            <div key={no}>
              <div className={cx("flex items-center", column === "right" && "flex-row-reverse")}>
                <button
                  type="button"
                  onClick={() => onToggleModule(no)}
                  className={cx("flex min-w-0 flex-1 items-center gap-2 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50", column === "right" && "flex-row-reverse text-right")}
                  aria-expanded={!isCollapsed}
                >
                  <ColorChip color={mc} size={14} />
                  <span className="font-medium">Модуль {no}</span>
                  <span className="text-slate-400">
                    {colorLabel(mc)} · {busy}/{fibers.length}
                  </span>
                  <span className={cx("text-slate-400", column === "left" ? "ml-auto" : "mr-auto")}>{isCollapsed ? "▸" : "▾"}</span>
                </button>
                {onCutModule && throughIds.length > 0 && (
                  <button
                    type="button"
                    className="mx-1 shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-red-50 hover:text-red-700"
                    title="Разрезать транзит волокон этого модуля"
                    onClick={() => onCutModule(no, throughIds)}
                  >
                    ✂ {throughIds.length}
                  </button>
                )}
              </div>
              {!isCollapsed &&
                fibers.map((f) => {
                  const st = terminalState(ctx, f.terminalId);
                  const partner = partnerText(ctx, f.terminalId);
                  return (
                    <button
                      type="button"
                      key={f.terminalId}
                      onClick={() => ctx.onTerminal(f.terminalId)}
                      title={ctx.index.get(f.terminalId)?.label}
                      aria-label={`Волокно ${f.number} (${colorLabel(f.color)}): ${partner ?? "свободно"}`}
                      aria-pressed={st === "pending" || st === "selected"}
                      className={cx(
                        "flex h-7 w-full items-center gap-2 px-3 text-sm hover:bg-slate-50",
                        column === "right" && "flex-row-reverse",
                        (st === "pending" || st === "selected") && "bg-brand-50",
                        f.condition === "damaged" && "opacity-60",
                      )}
                    >
                      <ColorChip color={f.color} size={16} />
                      <span className="w-6 text-right font-medium tabular-nums">{f.number}</span>
                      <span className={cx("min-w-0 flex-1 truncate text-xs", partner ? "text-slate-600" : "text-slate-300", column === "left" ? "text-right" : "text-left")}>
                        {partner ?? "свободно"}
                      </span>
                      <Dot id={f.terminalId} dir={dir} state={st} />
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- сплиттер и адаптеры

function PortRow({ ctx, port, label, dotSide }: { ctx: DiagramCtx; port: Port; label: string; dotSide: "left" | "right" }) {
  const st = terminalState(ctx, port.terminalId);
  const partner = partnerText(ctx, port.terminalId);
  return (
    <button
      type="button"
      onClick={() => ctx.onTerminal(port.terminalId)}
      title={ctx.index.get(port.terminalId)?.label}
      aria-label={`${label}: ${partner ?? "свободно"}`}
      aria-pressed={st === "pending" || st === "selected"}
      className={cx(
        "flex h-7 w-full items-center gap-2 px-2 text-sm hover:bg-slate-50",
        dotSide === "right" && "flex-row-reverse",
        (st === "pending" || st === "selected") && "bg-brand-50",
      )}
    >
      <Dot id={port.terminalId} dir={dotSide === "left" ? -1 : 1} state={st} />
      <span className="shrink-0 font-medium">{label}</span>
      <span className={cx("min-w-0 flex-1 truncate text-xs text-slate-500", dotSide === "left" ? "text-right" : "text-left")}>{partner ?? ""}</span>
    </button>
  );
}

export function DeviceBlock({ device, ctx, title }: { device: Device; ctx: DiagramCtx; title?: string }) {
  const ports = device.ports ?? [];
  if (device.kind === "splitter") {
    const ins = ports.filter((p) => p.role === "in");
    const outs = ports.filter((p) => p.role === "out");
    return (
      <section className="rounded-lg border border-violet-200 bg-violet-50/40" aria-label={deviceLabel(device)}>
        <header className="border-b border-violet-100 px-3 py-2">
          <div className="text-sm font-semibold">{deviceLabel(device)}</div>
          <div className="text-xs text-slate-500">
            {device.modelName}
            {device.insertionLossDb != null && ` · ${device.insertionLossDb} дБ`}
          </div>
        </header>
        <div className="py-1">
          {ins.map((p) => (
            <PortRow key={p.terminalId} ctx={ctx} port={p} label={`вход ${p.no}`} dotSide="left" />
          ))}
          <div className="mx-2 my-1 border-t border-dashed border-violet-200" />
          {outs.map((p) => (
            <PortRow key={p.terminalId} ctx={ctx} port={p} label={`выход ${p.no}`} dotSide="right" />
          ))}
        </div>
      </section>
    );
  }

  // Кросс / абонентский ящик: адаптеры, слева — сторона под сварку, справа — под патч-корд.
  const byNo = new Map<number, { rear?: Port; front?: Port }>();
  for (const p of ports.filter((x) => x.role === "adapter")) {
    const e = byNo.get(p.no) ?? {};
    e[p.face === "rear" ? "rear" : "front"] = p;
    byNo.set(p.no, e);
  }
  if (byNo.size === 0) return null;
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/40" aria-label={title ?? "Порты"}>
      <header className="border-b border-amber-100 px-3 py-2">
        <div className="text-sm font-semibold">{title ?? "Порты"}</div>
        <div className="text-xs text-slate-500">слева — сварка пигтейла, справа — патч-корд / дроп</div>
      </header>
      <div className="py-1">
        {[...byNo.entries()].map(([no, { rear, front }]) => {
          const rs = rear ? terminalState(ctx, rear.terminalId) : "free";
          const fs = front ? terminalState(ctx, front.terminalId) : "free";
          return (
            <div key={no} className="flex h-7 items-center gap-1 px-2 text-sm">
              {rear && (
                <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 rounded hover:bg-slate-50" onClick={() => ctx.onTerminal(rear.terminalId)} title={ctx.index.get(rear.terminalId)?.label} aria-label={`Порт ${no}, сварка: ${partnerText(ctx, rear.terminalId) ?? "свободно"}`}>
                  <Dot id={rear.terminalId} dir={-1} state={rs} />
                  <span className="min-w-0 flex-1 truncate text-left text-xs text-slate-500">{partnerText(ctx, rear.terminalId) ?? ""}</span>
                </button>
              )}
              <span className="w-14 shrink-0 text-center font-medium tabular-nums">порт {no}</span>
              {front && (
                <button type="button" className="flex min-w-0 flex-1 flex-row-reverse items-center gap-1.5 rounded hover:bg-slate-50" onClick={() => ctx.onTerminal(front.terminalId)} title={ctx.index.get(front.terminalId)?.label} aria-label={`Порт ${no}, патч: ${partnerText(ctx, front.terminalId) ?? "свободно"}`}>
                  <Dot id={front.terminalId} dir={1} state={fs} />
                  <span className="min-w-0 flex-1 truncate text-right text-xs text-slate-500">{partnerText(ctx, front.terminalId) ?? ""}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- линии соединений

interface Line {
  id: string;
  d: string;
  color: string;
  through: boolean;
}

/**
 * Рисует соединения поверх схемы: находит точки [data-term] в контейнере и
 * соединяет их кривыми Безье, выходящими из точек в сторону, куда они «смотрят».
 */
export function ConnectionLines({
  container,
  connections,
  index,
  selected,
  onSelect,
  deps,
}: {
  container: RefObject<HTMLDivElement | null>;
  connections: Conn[];
  index: Map<string, TerminalInfo>;
  selected: string | null;
  onSelect: (id: string) => void;
  deps: unknown[];
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const frame = useRef(0);

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const base = el.getBoundingClientRect();
        const pos = new Map<string, { x: number; y: number; dir: number }>();
        el.querySelectorAll<HTMLElement>("[data-term]").forEach((d) => {
          const r = d.getBoundingClientRect();
          if (r.width === 0) return;
          pos.set(d.dataset.term!, { x: r.left + r.width / 2 - base.left, y: r.top + r.height / 2 - base.top, dir: Number(d.dataset.dir) });
        });
        const next: Line[] = [];
        for (const c of connections) {
          const a = pos.get(c.aTerminalId);
          const b = pos.get(c.bTerminalId);
          if (!a || !b) continue;
          const k = Math.max(40, Math.abs(b.x - a.x) / 2);
          const d = `M${a.x},${a.y} C${a.x + a.dir * k},${a.y} ${b.x + b.dir * k},${b.y} ${b.x},${b.y}`;
          const color = index.get(c.aTerminalId)?.color?.hex ?? index.get(c.bTerminalId)?.color?.hex ?? "#64748b";
          next.push({ id: c.id, d, color, through: c.kind === "through" });
        }
        setLines(next);
        setSize({ w: el.scrollWidth, h: el.scrollHeight });
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(frame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections, index, ...deps]);

  return (
    <svg className="pointer-events-none absolute inset-0 hidden md:block" width={size.w} height={size.h} aria-hidden>
      {lines.map((l) => {
        const sel = l.id === selected;
        return (
          <g key={l.id} className="pointer-events-auto cursor-pointer" onClick={() => onSelect(l.id)}>
            <path d={l.d} fill="none" stroke="transparent" strokeWidth={10} />
            <path d={l.d} fill="none" stroke={sel ? "#1f66db" : "#334155"} strokeWidth={sel ? 6 : 3.5} strokeOpacity={l.through ? 0.35 : 0.9} strokeDasharray={l.through ? "5 4" : undefined} />
            <path d={l.d} fill="none" stroke={l.through ? "#e2e8f0" : l.color} strokeWidth={sel ? 3 : 2} strokeDasharray={l.through ? "5 4" : undefined} />
          </g>
        );
      })}
    </svg>
  );
}
