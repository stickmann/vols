import { and, eq } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { lineString, point, type LngLat } from "../db/geo.js";
import {
  cableSlacks,
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

/**
 * Небольшая демонстрационная сеть: узел связи с OLT и кроссом, четыре опоры,
 * муфта со сплиттером 1:8 и абонентский ящик. Всё разварено от PON-порта до ящика.
 */
export async function createDemoNetwork(tx: Tx, tenantId: string) {
  const model = async (kind: (typeof equipmentModels.$inferSelect)["kind"], name: string) => {
    const [m] = await tx
      .select({ id: equipmentModels.id })
      .from(equipmentModels)
      .where(and(eq(equipmentModels.kind, kind), eq(equipmentModels.name, name)));
    if (!m) throw new Error(`Нет модели ${name}`);
    return m.id;
  };
  const cableType = async (name: string) => {
    const [t] = await tx.select({ id: cableTypes.id }).from(cableTypes).where(eq(cableTypes.name, name));
    if (!t) throw new Error(`Нет типа кабеля ${name}`);
    return t.id;
  };

  const site = async (kind: (typeof sites.$inferSelect)["kind"], name: string, at: LngLat) => {
    const [s] = await tx
      .insert(sites)
      .values({ tenantId, kind, name, geom: point(at), status: "built" })
      .returning({ id: sites.id });
    return { id: s!.id, at };
  };

  const route = async (a: { id: string; at: LngLat }, b: { id: string; at: LngLat }) => {
    const [r] = await tx
      .insert(routes)
      .values({ tenantId, kind: "aerial", fromSiteId: a.id, toSiteId: b.id, geom: lineString([a.at, b.at]), status: "built" })
      .returning({ id: routes.id });
    return r!.id;
  };

  const eq_ = async (kind: (typeof equipment.$inferSelect)["kind"], modelName: string, siteId: string, name: string, parentId?: string) => {
    const [e] = await tx
      .insert(equipment)
      .values({ tenantId, kind, modelId: await model(kind, modelName), siteId, parentId, name, status: "built" })
      .returning({ id: equipment.id });
    return e!.id;
  };

  const port = async (equipmentId: string, role: "in" | "out" | "adapter" | "pon", no: number, face?: "rear" | "front") => {
    const [t] = await tx
      .select({ id: terminals.id })
      .from(terminals)
      .where(
        and(
          eq(terminals.equipmentId, equipmentId),
          eq(terminals.portRole, role),
          eq(terminals.portNo, no),
          face ? eq(terminals.portFace, face) : undefined,
        ),
      );
    return t!.id;
  };

  const fiberEnd = async (spanId: string, number: number, side: "a" | "b") => {
    const [t] = await tx
      .select({ id: terminals.id })
      .from(terminals)
      .innerJoin(fibers, eq(fibers.id, terminals.fiberId))
      .where(and(eq(fibers.spanId, spanId), eq(fibers.number, number), eq(terminals.fiberSide, side)));
    return t!.id;
  };

  const connect = (siteId: string, equipmentId: string, kind: "fusion" | "patch", a: string, b: string) =>
    tx.insert(connections).values({ tenantId, siteId, equipmentId, kind, aTerminalId: a, bTerminalId: b });

  // Координаты: условный квартал, улица с запада на восток.
  const pop = await site("pop", "Узел связи №1", [49.1080, 55.7960]);
  const p1 = await site("pole", "Оп. 1", [49.1095, 55.7962]);
  const p2 = await site("pole", "Оп. 2", [49.1112, 55.7964]);
  const p3 = await site("pole", "Оп. 3", [49.1129, 55.7966]);
  const p4 = await site("pole", "Оп. 4", [49.1146, 55.7968]);

  const r1 = await route(pop, p1);
  const r2 = await route(p1, p2);
  const r3 = await route(p2, p3);
  const r4 = await route(p3, p4);

  const olt = await eq_("olt", "OLT 8 PON", pop.id, "OLT-1");
  const odf = await eq_("odf", "Кросс ШКОС 1U, 24 порта", pop.id, "Кросс 1");
  const closure = await eq_("closure", "Муфта МТОК-Л6 (до 96 сварок)", p2.id, "Муфта М-1");
  const splitter = await eq_("splitter", "PLC 1:8", p2.id, "Сплиттер 1:8", closure);
  const box = await eq_("terminal_box", "ОРК на 8 абонентов (SC/APC)", p4.id, "ОРК-1");

  const trunk = await tx
    .insert(cables)
    .values({ tenantId, cableTypeId: await cableType("ОКСН 4×8 (32)"), name: "Магистраль УС1–М1", status: "built" })
    .returning({ id: cables.id });
  const drop = await tx
    .insert(cables)
    .values({ tenantId, cableTypeId: await cableType("ОКСН 1×8"), name: "Распределение М1–ОРК1", status: "built" })
    .returning({ id: cables.id });

  const [s1] = await tx
    .insert(cableSpans)
    .values({ tenantId, cableId: trunk[0]!.id, seq: 1, fromSiteId: pop.id, toSiteId: p2.id, fromEquipmentId: odf, toEquipmentId: closure })
    .returning({ id: cableSpans.id });
  const [s2] = await tx
    .insert(cableSpans)
    .values({ tenantId, cableId: drop[0]!.id, seq: 1, fromSiteId: p2.id, toSiteId: p4.id, fromEquipmentId: closure, toEquipmentId: box })
    .returning({ id: cableSpans.id });

  await tx.insert(spanRoutes).values([
    { tenantId, spanId: s1!.id, seq: 1, routeId: r1 },
    { tenantId, spanId: s1!.id, seq: 2, routeId: r2 },
    { tenantId, spanId: s2!.id, seq: 1, routeId: r3 },
    { tenantId, spanId: s2!.id, seq: 2, routeId: r4 },
  ]);
  await tx.insert(cableSlacks).values([
    { tenantId, spanId: s1!.id, siteId: p2.id, lengthM: 15 },
    { tenantId, spanId: s2!.id, siteId: p4.id, lengthM: 10 },
  ]);

  // Узел: PON 1 → патч-корд → кросс 1 → пигтейл → волокно 1 магистрали.
  await connect(pop.id, odf, "patch", await port(olt, "pon", 1), await port(odf, "adapter", 1, "front"));
  await connect(pop.id, odf, "fusion", await port(odf, "adapter", 1, "rear"), await fiberEnd(s1!.id, 1, "a"));
  // Муфта: волокно 1 магистрали → вход сплиттера, выходы 1..8 → волокна распределительного кабеля.
  await connect(p2.id, closure, "fusion", await fiberEnd(s1!.id, 1, "b"), await port(splitter, "in", 1));
  for (let n = 1; n <= 8; n++) {
    await connect(p2.id, closure, "fusion", await port(splitter, "out", n), await fiberEnd(s2!.id, n, "a"));
  }
  // Ящик: волокна 1..8 → адаптеры 1..8.
  for (let n = 1; n <= 8; n++) {
    await connect(p4.id, box, "fusion", await fiberEnd(s2!.id, n, "b"), await port(box, "adapter", n, "rear"));
  }

  return { sites: { pop, p1, p2, p3, p4 }, equipment: { olt, odf, closure, splitter, box }, spans: { s1: s1!.id, s2: s2!.id } };
}
