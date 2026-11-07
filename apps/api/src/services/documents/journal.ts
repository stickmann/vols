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
  // Всё агрегируется одним проходом по таблицам, без подзапроса на каждый кабель.
  return tx.execute<Row>(sql`
    WITH span_len AS (
      SELECT sp.cable_id, sum(r.length_m)::float AS route_m
      FROM cable_spans sp JOIN span_routes x ON x.span_id = sp.id JOIN routes r ON r.id = x.route_id
      GROUP BY sp.cable_id
    ), slack AS (
      SELECT sp.cable_id, sum(k.length_m)::float AS slack_m
      FROM cable_spans sp JOIN cable_slacks k ON k.span_id = sp.id
      GROUP BY sp.cable_id
    ), spans AS (
      SELECT cable_id, count(*)::int AS n FROM cable_spans GROUP BY cable_id
    ), used AS (
      SELECT sp.cable_id, count(DISTINCT f.number)::int AS n
      FROM connections cn
      CROSS JOIN LATERAL (VALUES (cn.a_terminal_id), (cn.b_terminal_id)) e(terminal_id)
      JOIN terminals tm ON tm.id = e.terminal_id
      JOIN fibers f ON f.id = tm.fiber_id
      JOIN cable_spans sp ON sp.id = f.span_id
      WHERE cn.kind <> 'through'
      GROUP BY sp.cable_id
    ), type_fibers AS (
      SELECT cable_type_id, count(*)::int AS n FROM cable_type_fibers GROUP BY cable_type_id
    )
    SELECT c.id, c.name, t.name AS "typeName", c.status,
           coalesce(tf.n, 0) AS "fiberCount",
           coalesce(used.n, 0) AS "usedFibers",
           coalesce(spans.n, 0) AS spans,
           coalesce(span_len.route_m, 0) AS "routeM",
           coalesce(slack.slack_m, 0) AS "slackM",
           0::float AS "totalM",
           fs.name AS "fromSite", fe.name AS "fromEq", ts.name AS "toSite", te.name AS "toEq"
    FROM cables c
    JOIN cable_types t ON t.id = c.cable_type_id
    LEFT JOIN type_fibers tf ON tf.cable_type_id = t.id
    LEFT JOIN used ON used.cable_id = c.id
    LEFT JOIN spans ON spans.cable_id = c.id
    LEFT JOIN span_len ON span_len.cable_id = c.id
    LEFT JOIN slack ON slack.cable_id = c.id
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
