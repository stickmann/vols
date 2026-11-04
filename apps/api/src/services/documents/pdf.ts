import { createRequire } from "node:module";
import path from "node:path";
import type { Color } from "@vols/shared";
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";

const require = createRequire(import.meta.url);
const pdfmake = require("pdfmake") as typeof import("pdfmake");

// Шрифт Roboto из пакета pdfmake: в нём есть кириллица. Доступ к файлам и сети — только к этим шрифтам.
const fontDir = path.join(path.dirname(require.resolve("pdfmake/package.json")), "fonts", "Roboto");
pdfmake.setLocalAccessPolicy((p) => path.resolve(p).startsWith(fontDir));
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setFonts({
  Roboto: {
    normal: path.join(fontDir, "Roboto-Regular.ttf"),
    bold: path.join(fontDir, "Roboto-Medium.ttf"),
    italics: path.join(fontDir, "Roboto-Italic.ttf"),
    bolditalics: path.join(fontDir, "Roboto-MediumItalic.ttf"),
  },
});

export async function renderPdf(doc: TDocumentDefinitions): Promise<Buffer> {
  return pdfmake.createPdf(doc).getBuffer();
}

const fmtDate = (d: Date) => d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Общая рамка документа: шапка с оператором и датой, нумерация страниц, стили. */
export function document(opts: {
  title: string;
  operator: string;
  landscape?: boolean;
  content: Content[];
}): TDocumentDefinitions {
  const generated = new Date();
  return {
    pageSize: "A4",
    pageOrientation: opts.landscape ? "landscape" : "portrait",
    pageMargins: [36, 48, 36, 40],
    info: { title: opts.title, creator: "ВОЛС", producer: "ВОЛС" },
    header: (page) =>
      page === 1
        ? ""
        : { text: `${opts.title} · ${opts.operator}`, style: "runningHeader", margin: [36, 20, 36, 0] },
    footer: (page, pages) => ({
      columns: [
        { text: `Сформировано ${fmtDate(generated)}`, style: "footer" },
        { text: `Стр. ${page} из ${pages}`, style: "footer", alignment: "right" },
      ],
      margin: [36, 10, 36, 0],
    }),
    content: [
      { text: opts.operator, style: "operator" },
      { text: opts.title, style: "title" },
      ...opts.content,
    ],
    defaultStyle: { font: "Roboto", fontSize: 9, lineHeight: 1.15, color: "#111827" },
    styles: {
      operator: { fontSize: 9, color: "#6b7280", margin: [0, 0, 0, 2] },
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 12] },
      h2: { fontSize: 11, bold: true, margin: [0, 14, 0, 6] },
      h3: { fontSize: 9.5, bold: true, margin: [0, 8, 0, 4] },
      muted: { color: "#6b7280" },
      th: { bold: true, fillColor: "#f1f5f9", color: "#334155" },
      small: { fontSize: 8 },
      footer: { fontSize: 7.5, color: "#9ca3af" },
      runningHeader: { fontSize: 7.5, color: "#9ca3af" },
    },
  };
}

/** Строки «поле — значение» без рамок. */
export function facts(rows: [string, string | number | null | undefined][]): Content {
  return {
    table: {
      widths: [140, "*"],
      body: rows.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => [
        { text: k, style: "muted" },
        { text: String(v) },
      ]),
    },
    layout: "noBorders",
  };
}

/** Таблица с заголовком и тонкими линиями. */
export function table(widths: (string | number)[], head: string[], rows: TableCell[][], opts: { fontSize?: number } = {}): Content {
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths,
      body: [head.map((h) => ({ text: h, style: "th" })), ...rows],
    },
    layout: {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === 1 || i === node.table.body.length ? 0.8 : 0.3),
      vLineWidth: () => 0,
      hLineColor: () => "#cbd5e1",
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    fontSize: opts.fontSize,
  };
}

/** Цвет волокна/модуля: кружок с кольцевыми метками и название. */
export function colorCell(c: Color | null | undefined, text: string): TableCell {
  if (!c) return { text };
  const marks = Array.from({ length: c.marks }, (_, i) => ({
    type: "line" as const,
    x1: 2.5 + i * 2.5,
    y1: 1.5,
    x2: 2.5 + i * 2.5,
    y2: 7.5,
    lineWidth: 0.8,
    lineColor: "#111827",
  }));
  return {
    columns: [
      { width: 11, canvas: [{ type: "ellipse", x: 4.5, y: 4.5, r1: 4, r2: 4, color: c.hex, lineColor: "#94a3b8", lineWidth: 0.5 }, ...marks], margin: [0, 1, 0, 0] },
      { width: "*", text },
    ],
    columnGap: 3,
  };
}

export const fmtLen = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(3).replace(".", ",")} км` : `${Math.round(m)} м`);
export const fmtDb = (x: number) => x.toFixed(2).replace(".", ",");
