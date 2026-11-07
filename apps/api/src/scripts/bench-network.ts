/**
 * Генератор крупной сети для замеров производительности (не для продакшена).
 *   pnpm --filter @vols/api bench:network [муфт=300]
 *
 * Звезда магистралей от узла связи: каждая магистраль ОКСН 48 проходит через 10 муфт.
 * В каждой муфте сплиттер 1:8 на своём волокне магистрали, остальные волокна — транзитом;
 * из муфты два распределительных кабеля к двум ящикам по 4 абонента. На узле на каждую
 * магистраль — кросс и OLT, PON-порты разварены на волокна. Создаётся отдельный оператор.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { createDb, withTenant, type Tx } from "../db/client.js";
import { lineString, point, type LngLat } from "../db/geo.js";
import {
  cableSpans,
  cableTypes,
  cables,
  connections,
  equipment,
  equipmentModels,
  fibers,
  routes,
  sites,
  spanRoutes,
  terminals,
} from "../db/schema/index.js";
import { env } from "../env.js";
import { provisionTenant } from "../services/tenants.js";

const CLOSURES = Number(process.argv[2] ?? 300);
const PER_TRUNK = 10;
const STEP_M = 120;

const app = createDb(env.DATABASE_URL, { max: 2 });
const tenantId = await provisionTenant(app.db, { name: `Нагрузочный тест (${CLOSURES} муфт)`, slug: `bench-${randomUUID().slice(0, 8)}` });
const t0 = Date.now();

const ids = await withTenant(app.db, { tenantId }, async (tx) => {
  const model = async (name: string) => (await tx.select({ id: equipmentModels.id }).from(equipmentModels).where(eq(equipmentModels.name, name)))[0]!.id;
  const ctype = async (name: string) => (await tx.select({ id: cableTypes.id }).from(cableTypes).where(eq(cableTypes.name, name)))[0]!.id;
  return {
    olt: await model("OLT 16 PON"),
    odf: await model("Кросс ШКОС 1U, 24 порта"),
    closure: await model("Муфта МТОК-Л6 (до 96 сварок)"),
    splitter: await model("PLC 1:8"),
    box: await model("ОРК на 8 абонентов (SC/APC)"),
    trunk: await ctype("ОКСН 4×12 (48)"),
    drop: await ctype("ОКСН 1×8"),
  };
});

const center: LngLat = [49.12, 55.79];
const offset = ([lng, lat]: LngLat, dx: number, dy: number): LngLat => [
  lng + dx / (111320 * Math.cos((lat * Math.PI) / 180)),
  lat + dy / 110540,
];

const [pop] = await withTenant(app.db, { tenantId }, (tx) =>
  tx.insert(sites).values({ tenantId, kind: "pop", name: "Узел связи", geom: point(center), status: "built" }).returning({ id: sites.id }),
);

const trunksCount = Math.ceil(CLOSURES / PER_TRUNK);
for (let t = 0; t < trunksCount; t++) {
  const n = Math.min(PER_TRUNK, CLOSURES - t * PER_TRUNK);
  await withTenant(app.db, { tenantId }, (tx) => buildTrunk(tx, t, n));
  process.stdout.write(`\rмагистралей: ${t + 1}/${trunksCount}`);
}
console.log(`\nГотово за ${((Date.now() - t0) / 1000).toFixed(1)} с. Оператор: ${tenantId}`);
await app.close();

async function buildTrunk(tx: Tx, t: number, n: number) {
  const angle = (2 * Math.PI * t) / trunksCount;
  const dir: [number, number] = [Math.cos(angle), Math.sin(angle)];
  const along = (d: number, side = 0): LngLat => offset(center, dir[0] * d - dir[1] * side, dir[1] * d + dir[0] * side);

  const ins = <T extends { id: string }>(q: Promise<T[]>) => q.then((r) => r[0]!.id);
  const site = (kind: "pole", name: string, at: LngLat) =>
    ins(tx.insert(sites).values({ tenantId, kind, name, geom: point(at), status: "built" }).returning({ id: sites.id })).then((id) => ({ id, at }));
  const route = (a: { id: string; at: LngLat }, b: { id: string; at: LngLat }) =>
    ins(tx.insert(routes).values({ tenantId, kind: "aerial", fromSiteId: a.id, toSiteId: b.id, geom: lineString([a.at, b.at]), status: "built" }).returning({ id: routes.id }));
  const eqp = (kind: "olt" | "odf" | "closure" | "splitter" | "terminal_box", modelId: string, siteId: string, name: string, parentId?: string) =>
    ins(tx.insert(equipment).values({ tenantId, kind, modelId, siteId, parentId, name, status: "built" }).returning({ id: equipment.id }));

  const popSite = { id: pop!.id, at: center };
  const olt = await eqp("olt", ids.olt, popSite.id, `OLT-${t + 1}`);
  const odf = await eqp("odf", ids.odf, popSite.id, `Кросс ${t + 1}`);
  const trunk = await ins(tx.insert(cables).values({ tenantId, cableTypeId: ids.trunk, name: `Магистраль ${t + 1}`, status: "built" }).returning({ id: cables.id }));

  const closures: { site: { id: string; at: LngLat }; closure: string; splitter: string }[] = [];
  const drops: { spanId: string; box: string; siteId: string }[][] = [];
  const trunkSpans: string[] = [];
  let prev = { site: popSite, eq: odf };
  for (let i = 0; i < n; i++) {
    const s = await site("pole", `М${t + 1}.${i + 1}`, along(STEP_M * (i + 1)));
    const r = await route(prev.site, s);
    const closure = await eqp("closure", ids.closure, s.id, `Муфта ${t + 1}.${i + 1}`);
    const splitter = await eqp("splitter", ids.splitter, s.id, "Сплиттер 1:8", closure);
    const span = await ins(
      tx.insert(cableSpans)
        .values({ tenantId, cableId: trunk, seq: i + 1, fromSiteId: prev.site.id, toSiteId: s.id, fromEquipmentId: prev.eq, toEquipmentId: closure })
        .returning({ id: cableSpans.id }),
    );
    await tx.insert(spanRoutes).values({ tenantId, spanId: span, seq: 1, routeId: r });
    trunkSpans.push(span);
    closures.push({ site: s, closure, splitter });

    const ds = [];
    for (const side of [1, -1]) {
      const bs = await site("pole", `Я${t + 1}.${i + 1}${side > 0 ? "а" : "б"}`, along(STEP_M * (i + 1), side * 50));
      const br = await route(s, bs);
      const box = await eqp("terminal_box", ids.box, bs.id, `ОРК ${t + 1}.${i + 1}${side > 0 ? "а" : "б"}`);
      const cable = await ins(tx.insert(cables).values({ tenantId, cableTypeId: ids.drop, name: `Распр. ${t + 1}.${i + 1}${side > 0 ? "а" : "б"}`, status: "built" }).returning({ id: cables.id }));
      const dspan = await ins(
        tx.insert(cableSpans)
          .values({ tenantId, cableId: cable, seq: 1, fromSiteId: s.id, toSiteId: bs.id, fromEquipmentId: closure, toEquipmentId: box })
          .returning({ id: cableSpans.id }),
      );
      await tx.insert(spanRoutes).values({ tenantId, spanId: dspan, seq: 1, routeId: br });
      ds.push({ spanId: dspan, box, siteId: bs.id });
    }
    drops.push(ds);
    prev = { site: s, eq: closure };
  }

  // Концы волокон и порты одним запросом каждое.
  const spanIds = [...trunkSpans, ...drops.flat().map((d) => d.spanId)];
  const fiberEnds = new Map<string, string>();
  for (const r of await tx
    .select({ id: terminals.id, spanId: fibers.spanId, number: fibers.number, side: terminals.fiberSide })
    .from(terminals)
    .innerJoin(fibers, eq(fibers.id, terminals.fiberId))
    .where(inArray(fibers.spanId, spanIds)))
    fiberEnds.set(`${r.spanId}:${r.number}:${r.side}`, r.id);
  const eqIds = [olt, odf, ...closures.map((c) => c.splitter), ...drops.flat().map((d) => d.box)];
  const ports = new Map<string, string>();
  for (const r of await tx
    .select({ id: terminals.id, eq: terminals.equipmentId, role: terminals.portRole, no: terminals.portNo, face: terminals.portFace })
    .from(terminals)
    .where(and(inArray(terminals.equipmentId, eqIds))))
    ports.set(`${r.eq}:${r.role}:${r.no}:${r.face ?? ""}`, r.id);
  const fe = (span: string, num: number, side: "a" | "b") => fiberEnds.get(`${span}:${num}:${side}`)!;
  const port = (eqId: string, role: string, no: number, face = "") => ports.get(`${eqId}:${role}:${no}:${face}`)!;

  type C = typeof connections.$inferInsert;
  const conns: C[] = [];
  const c = (siteId: string, equipmentId: string, kind: C["kind"], a: string, b: string, slot?: number): C => ({
    tenantId, siteId, equipmentId, kind, aTerminalId: a, bTerminalId: b,
    trayNo: slot ? Math.ceil(slot / 24) : null, slotNo: slot ?? null, lossDb: kind === "fusion" ? 0.03 : null,
  });
  // Узел: PON i → кросс i (лицевая) → тыл → волокно i магистрали.
  for (let i = 1; i <= n; i++) {
    conns.push(c(popSite.id, odf, "patch", port(olt, "pon", i), port(odf, "adapter", i, "front")));
    conns.push(c(popSite.id, odf, "fusion", port(odf, "adapter", i, "rear"), fe(trunkSpans[0]!, i, "a"), i));
  }
  for (let i = 0; i < n; i++) {
    const { site: s, closure, splitter } = closures[i]!;
    let slot = 0;
    // Волокно i+1 — на сплиттер, волокна дальше по магистрали — транзитом в следующий пролёт.
    conns.push(c(s.id, closure, "fusion", fe(trunkSpans[i]!, i + 1, "b"), port(splitter, "in", 1), ++slot));
    if (i + 1 < n) for (let f = i + 2; f <= 48; f++) conns.push(c(s.id, closure, "through", fe(trunkSpans[i]!, f, "b"), fe(trunkSpans[i + 1]!, f, "a")));
    drops[i]!.forEach((d, k) => {
      for (let f = 1; f <= 4; f++) {
        conns.push(c(s.id, closure, "fusion", port(splitter, "out", k * 4 + f), fe(d.spanId, f, "a"), ++slot));
        conns.push(c(d.siteId, d.box, "fusion", fe(d.spanId, f, "b"), port(d.box, "adapter", f, "rear"), f));
      }
    });
  }
  for (let i = 0; i < conns.length; i += 500) await tx.insert(connections).values(conns.slice(i, i + 500));
}
