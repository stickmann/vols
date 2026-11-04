import { sql } from "drizzle-orm";
import type { Content, TableCell } from "pdfmake/interfaces";
import type { Tx } from "../../db/client.js";
import { operatorName } from "./passport.js";
import { document, fmtLen, renderPdf, table } from "./pdf.js";

const STATUS: Record<string, string> = { planned: "проект", built: "построено", decommissioned: "выведено" };

interface Row extends Record<string, unknown> {
  id: string;
  name: string | null;
  typeName: string;
  status: string;
  fiberCount: number;
  usedFibers: number;
  spans: number;
  routeM: number;
  slackM: number;
  totalM: number;
  fromSite: string | null;
  fromEq: string | null;
  toSite: string | null;
  toEq: string | null;
}

/**
 * Кабельный журнал: все кабели оператора с концами, длинами и занятостью волокон.
 * Волокно считается задействованным, если у него есть сварка или подключение (не транзит) хотя бы на одном конце.
 */
export async function cableJournalRows(tx: Tx, status?: string): Promise<Row[]> {
  return tx.execute<Row>(sql`
    SELECT c.id, c.name, t.name AS "typeName", c.status,
           (SELECT count(*)::int FROM cable_type_fibers f WHERE f.cable_type_id = t.id) AS "fiberCount",
           (SELECT count(DISTINCT f.number)::int
              FROM fibers f JOIN cable_spans sp ON sp.id = f.span_id
              JOIN terminals tm ON tm.fiber_id = f.id
              JOIN connections cn ON tm.id IN (cn.a_terminal_id, cn.b_terminal_id) AND cn.kind <> 'through'
             WHERE sp.cable_id = c.id) AS "usedFibers",
           (SELECT count(*)::int FROM cable_spans sp WHERE sp.cable_id = c.id) AS spans,
           coalesce((SELECT sum(r.length_m) FROM cable_spans sp JOIN span_routes x ON x.span_id = sp.id JOIN routes r ON r.id = x.route_id WHERE sp.cable_id = c.id), 0)::float AS "routeM",
           coalesce((SELECT sum(k.length_m) FROM cable_spans sp JOIN cable_slacks k ON k.span_id = sp.id WHERE sp.cable_id = c.id), 0)::float AS "slackM",
           0::float AS "totalM",
           fs.name AS "fromSite", fe.name AS "fromEq", ts.name AS "toSite", te.name AS "toEq"
    FROM cables c
    JOIN cable_types t ON t.id = c.cable_type_id
    LEFT JOIN LATERAL (SELECT * FROM cable_spans WHERE cable_id = c.id ORDER BY seq LIMIT 1) first ON true
    LEFT JOIN LATERAL (SELECT * FROM cable_spans WHERE cable_id = c.id ORDER BY seq DESC LIMIT 1) last ON true
    LEFT JOIN sites fs ON fs.id = first.from_site_id
    LEFT JOIN equipment fe ON fe.id = first.from_equipment_id
    LEFT JOIN sites ts ON ts.id = last.to_site_id
    LEFT JOIN equipment te ON te.id = last.to_equipment_id
    WHERE ${status ? sql`c.status = ${status}::object_status` : sql`true`}
    ORDER BY c.name NULLS LAST, t.name`).then((rows) => rows.map((r) => ({ ...r, totalM: r.routeM + r.slackM })));
}

export async function cableJournalPdf(tx: Tx, status?: string): Promise<{ pdf: Buffer; filename: string }> {
  const rows = await cableJournalRows(tx, status);
  const operator = await operatorName(tx);
  const end = (site: string | null, eq: string | null) => (site ? (eq ? `${site} / ${eq}` : site) : "—");

  const content: Content[] = [];
  content.push({
    text: `${status ? `Статус: ${STATUS[status]}. ` : ""}Кабелей: ${rows.length}, общая длина ${fmtLen(rows.reduce((s, r) => s + r.totalM, 0))}.`,
    style: "muted",
    margin: [0, 0, 0, 8],
  });
  content.push(
    rows.length
      ? table(
          [18, "*", 78, 30, "*", "*", 48, 40, 52, 48, 46],
          ["№", "Кабель", "Марка", "Вол.", "Начало (место / оборудование)", "Конец (место / оборудование)", "По трассе", "Запас", "Всего", "Занято", "Статус"],
          rows.map((r, i): TableCell[] => [
            String(i + 1),
            r.name || "—",
            r.typeName,
            String(r.fiberCount),
            end(r.fromSite, r.fromEq),
            end(r.toSite, r.toEq),
            fmtLen(r.routeM),
            r.slackM ? fmtLen(r.slackM) : "—",
            { text: fmtLen(r.totalM), bold: true },
            `${r.usedFibers} / ${r.fiberCount}`,
            STATUS[r.status] ?? r.status,
          ]),
          { fontSize: 8 },
        )
      : { text: "Кабелей нет.", style: "muted" },
  );

  // Итог по маркам: сколько кабелей и метров каждой марки (для закупки и учёта).
  const byType = new Map<string, { n: number; m: number }>();
  for (const r of rows) {
    const e = byType.get(r.typeName) ?? { n: 0, m: 0 };
    e.n++;
    e.m += r.totalM;
    byType.set(r.typeName, e);
  }
  if (byType.size) {
    content.push({ text: "Итого по маркам", style: "h2" });
    content.push(
      table(
        ["*", 60, 80],
        ["Марка", "Кабелей", "Длина"],
        [...byType.entries()].sort((a, b) => b[1].m - a[1].m).map(([name, e]) => [name, String(e.n), fmtLen(e.m)]),
      ),
    );
  }

  const pdf = await renderPdf(document({ title: "Кабельный журнал", operator, landscape: true, content }));
  return { pdf, filename: `Кабельный журнал${status ? ` (${STATUS[status]})` : ""}.pdf` };
}
