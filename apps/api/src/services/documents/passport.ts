import {
  cableLabel,
  compressRanges,
  connectionByTerminal,
  CONNECTION_KIND_LABELS,
  deviceLabel,
  portLabel,
  TYPICAL_CONNECTION_LOSS,
  type Color,
  type Conn,
  type SplicingData,
} from "@vols/shared";
import { sql } from "drizzle-orm";
import type { Content, TableCell } from "pdfmake/interfaces";
import type { Tx } from "../../db/client.js";
import { getSplicing } from "../splicing.js";
import { colorCell, document, facts, fmtDb, fmtLen, renderPdf, table } from "./pdf.js";

const KIND_TITLE: Record<string, string> = {
  closure: "Паспорт оптической муфты",
  terminal_box: "Паспорт абонентского ящика",
  odf: "Паспорт оптического кросса",
};
const STATUS: Record<string, string> = { planned: "проект", built: "построено", decommissioned: "выведено" };
const SITE_KIND: Record<string, string> = {
  pop: "узел связи",
  pole: "опора",
  manhole: "колодец",
  cabinet: "шкаф",
  building: "здание",
  entrance: "подъезд / ввод",
  point: "точка",
};

export async function operatorName(tx: Tx): Promise<string> {
  const [t] = await tx.execute<{ name: string }>(sql`SELECT name FROM tenants LIMIT 1`);
  return t?.name ?? "";
}

/** Паспорт корпуса: сведения, заведённые кабели, сплиттеры, соединения по кассетам, транзит, свободные волокна. */
export async function passportPdf(tx: Tx, equipmentId: string): Promise<{ pdf: Buffer; filename: string }> {
  const data = (await getSplicing(tx, equipmentId)) as unknown as SplicingData;
  const eq = data.equipment;
  const [site] = await tx.execute<{ address: string | null; lng: number; lat: number }>(sql`
    SELECT address, ST_X(geom) AS lng, ST_Y(geom) AS lat FROM sites WHERE id = ${eq.siteId}`);
  const lengths = new Map(
    (
      await tx.execute<{ spanId: string; lengthM: number }>(sql`
        SELECT sp.id AS "spanId",
               coalesce(sp.measured_length_m::float,
                 coalesce((SELECT sum(r.length_m) FROM span_routes x JOIN routes r ON r.id = x.route_id WHERE x.span_id = sp.id), 0)
                 + coalesce((SELECT sum(k.length_m)::float FROM cable_slacks k WHERE k.span_id = sp.id), 0)) AS "lengthM"
        FROM cable_spans sp WHERE sp.from_equipment_id = ${equipmentId} OR sp.to_equipment_id = ${equipmentId}`)
    ).map((r) => [r.spanId, r.lengthM]),
  );
  const operator = await operatorName(tx);

  const byTerminal = connectionByTerminal(data.connections);
  const perCable = new Map<string, number>();
  for (const c of data.cables) perCable.set(c.cableId, (perCable.get(c.cableId) ?? 0) + 1);

  // Подписи точек для таблиц: кабель, модуль, волокно, цвет.
  const point = new Map<string, { text: string; color: Color | null; cable?: string }>();
  for (const c of data.cables) {
    const name = (perCable.get(c.cableId) ?? 0) > 1 ? `${cableLabel(c)} (${c.side === "b" ? "приход" : "уход"})` : cableLabel(c);
    for (const f of c.fibers ?? []) {
      point.set(f.terminalId, {
        text: `${name} · мод. ${f.module} · вол. ${f.number} — ${f.color.name}${f.color.marks ? ` +${f.color.marks}` : ""}`,
        color: f.color,
        cable: c.spanId,
      });
    }
  }
  for (const d of data.devices) for (const p of d.ports ?? []) point.set(p.terminalId, { text: portLabel(d, p), color: null });

  const splices = data.connections.filter((c) => c.kind !== "through");
  const through = data.connections.filter((c) => c.kind === "through");
  const usedSplices = splices.filter((c) => c.kind === "fusion" || c.kind === "mechanical").length;

  const content: Content[] = [];
  const kindName = { closure: "Муфта", terminal_box: "Абонентский ящик", odf: "Кросс" }[eq.kind] ?? eq.kind;
  content.push(
    facts([
      ["Наименование", eq.name || kindName],
      ["Тип", kindName],
      ["Модель", eq.modelName],
      ["Место установки", `${eq.siteName || "—"} (${SITE_KIND[eq.siteKind] ?? eq.siteKind})`],
      ["Адрес", site?.address],
      ["Координаты", site ? `${site.lat.toFixed(6)}, ${site.lng.toFixed(6)}` : null],
      ["Статус", STATUS[eq.status] ?? eq.status],
      ["Сварок", eq.maxSplices ? `${usedSplices} из ${eq.maxSplices}` : String(usedSplices)],
      ["Кабелей заведено", data.cables.length],
    ]),
  );

  // Кабели
  content.push({ text: "Заведённые кабели", style: "h2" });
  content.push(
    data.cables.length
      ? table(
          [16, "*", 90, 40, "*", 56, 50],
          ["№", "Кабель", "Марка", "Волокон", "Направление", "Длина пролёта", "Свободно"],
          data.cables.map((c, i) => {
            const free = (c.fibers ?? []).filter((f) => !byTerminal.has(f.terminalId)).length;
            return [
              String(i + 1),
              cableLabel(c),
              c.typeName,
              String(c.fibers?.length ?? 0),
              `${c.side === "b" ? "приходит от" : "уходит к"} ${c.otherSiteName || "—"}`,
              fmtLen(lengths.get(c.spanId) ?? 0),
              String(free),
            ];
          }),
        )
      : { text: "Кабели не заведены.", style: "muted" },
  );

  // Сплиттеры
  const splitters = data.devices.filter((d) => d.kind === "splitter");
  if (splitters.length) {
    content.push({ text: "Сплиттеры", style: "h2" });
    content.push(
      table(
        ["*", 90, 60, "*", 60],
        ["Сплиттер", "Модель", "Потери, дБ", "Вход подключён к", "Занято выходов"],
        splitters.map((d) => {
          const ins = (d.ports ?? []).filter((p) => p.role === "in");
          const outs = (d.ports ?? []).filter((p) => p.role === "out");
          const inText = ins
            .map((p) => {
              const c = byTerminal.get(p.terminalId);
              return c ? point.get(c.aTerminalId === p.terminalId ? c.bTerminalId : c.aTerminalId)?.text : "—";
            })
            .join("; ");
          return [
            deviceLabel(d),
            d.modelName,
            d.insertionLossDb != null ? fmtDb(d.insertionLossDb) : "—",
            inText || "—",
            `${outs.filter((p) => byTerminal.has(p.terminalId)).length} из ${outs.length}`,
          ];
        }),
      ),
    );
  }

  // Соединения по кассетам
  content.push({ text: "Соединения", style: "h2" });
  if (splices.length === 0) {
    content.push({ text: "Соединений нет.", style: "muted" });
  } else {
    const groups = new Map<number | null, Conn[]>();
    for (const c of [...splices].sort(byTraySlot)) (groups.get(c.trayNo) ?? groups.set(c.trayNo, []).get(c.trayNo)!).push(c);
    let n = 0;
    for (const [tray, list] of groups) {
      content.push({ text: tray === null ? "Без кассеты" : `Кассета ${tray}`, style: "h3" });
      content.push(
        table(
          [18, 28, "*", "*", 62, 42],
          ["№", "Место", "Откуда", "Куда", "Вид", "Потери, дБ"],
          list.map((c): TableCell[] => {
            const a = point.get(c.aTerminalId);
            const b = point.get(c.bTerminalId);
            return [
              String(++n),
              c.slotNo != null ? String(c.slotNo) : "",
              colorCell(a?.color, a?.text ?? "?"),
              colorCell(b?.color, b?.text ?? "?"),
              CONNECTION_KIND_LABELS[c.kind] ?? c.kind,
              c.lossDb != null ? fmtDb(c.lossDb) : { text: `${fmtDb(TYPICAL_CONNECTION_LOSS[c.kind] ?? 0)} тип.`, style: "muted" },
            ];
          }),
          { fontSize: 8 },
        ),
      );
    }
  }

  // Транзит
  if (through.length) {
    content.push({ text: "Транзит (волокна без разреза)", style: "h2" });
    const perSpan = new Map<string, number[]>();
    for (const c of through) {
      for (const tid of [c.aTerminalId, c.bTerminalId]) {
        const cab = data.cables.find((x) => x.fibers?.some((f) => f.terminalId === tid));
        if (cab?.side === "b") perSpan.set(cab.cableId, [...(perSpan.get(cab.cableId) ?? []), cab.fibers!.find((f) => f.terminalId === tid)!.number]);
      }
    }
    content.push({
      ul: [...perSpan.entries()].map(([cableId, nums]) => {
        const cab = data.cables.find((c) => c.cableId === cableId)!;
        return `${cableLabel(cab)}: волокна ${compressRanges(nums)}`;
      }),
    });
  }

  // Свободные волокна
  const freeRows = data.cables
    .map((c) => ({ c, nums: (c.fibers ?? []).filter((f) => !byTerminal.has(f.terminalId)).map((f) => f.number) }))
    .filter((x) => x.nums.length);
  if (freeRows.length) {
    content.push({ text: "Свободные волокна", style: "h2" });
    content.push({
      ul: freeRows.map(
        ({ c, nums }) =>
          `${(perCable.get(c.cableId) ?? 0) > 1 ? `${cableLabel(c)} (${c.side === "b" ? "приход" : "уход"})` : cableLabel(c)}: ${compressRanges(nums)}`,
      ),
    });
  }

  // Подписи
  content.push({
    margin: [0, 28, 0, 0],
    unbreakable: true,
    columns: [
      signature("Монтаж выполнил"),
      signature("Проверил"),
    ],
    columnGap: 40,
  });

  const title = `${KIND_TITLE[eq.kind] ?? "Паспорт"} «${eq.name || kindName}»`;
  const pdf = await renderPdf(document({ title, operator, content }));
  return { pdf, filename: `${(KIND_TITLE[eq.kind] ?? "Паспорт").split(" ")[0]} ${eq.name || kindName} — ${eq.siteName ?? ""}.pdf`.replace(/[\\/:*?"<>|]/g, "_") };
}

function byTraySlot(a: Conn, b: Conn) {
  const t = (a.trayNo ?? 1e9) - (b.trayNo ?? 1e9);
  return t !== 0 ? t : (a.slotNo ?? 1e9) - (b.slotNo ?? 1e9);
}

function signature(role: string): Content {
  return {
    stack: [
      { text: role, style: "muted" },
      { canvas: [{ type: "line", x1: 0, y1: 22, x2: 220, y2: 22, lineWidth: 0.5, lineColor: "#94a3b8" }] },
      { text: "подпись / ФИО", style: "small", color: "#9ca3af", margin: [0, 2, 0, 12] },
      { canvas: [{ type: "line", x1: 0, y1: 10, x2: 120, y2: 10, lineWidth: 0.5, lineColor: "#94a3b8" }] },
      { text: "дата", style: "small", color: "#9ca3af", margin: [0, 2, 0, 0] },
    ],
  };
}
