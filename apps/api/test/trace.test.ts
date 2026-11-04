import type { TraceResult } from "@vols/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { terminals } from "../src/db/schema/index.js";
import { createDemoNetwork } from "../src/services/demo-network.js";
import { appDb, newTenant, withTenant } from "./helpers.js";

const db = appDb();
const api = buildApp({ db: db.db, devTenantHeader: true });
let tenantId: string;
let net: Awaited<ReturnType<typeof createDemoNetwork>>;
let pon1: string;
let boxFront: (n: number) => Promise<string>;

const post = async (url: string, payload: unknown) => {
  const r = await api.inject({ method: "POST", url: `/api/v1${url}`, headers: { "x-tenant-id": tenantId }, payload: payload as never });
  return { status: r.statusCode, body: r.json() };
};

beforeAll(async () => {
  tenantId = await newTenant(db.db);
  await withTenant(db.db, { tenantId }, async (tx) => {
    net = await createDemoNetwork(tx, tenantId);
  });
  const port = (eq_: string, role: "pon" | "adapter", no: number, face?: "front") =>
    withTenant(db.db, { tenantId }, async (tx) => {
      const [t] = await tx
        .select({ id: terminals.id })
        .from(terminals)
        .where(and(eq(terminals.equipmentId, eq_), eq(terminals.portRole, role), eq(terminals.portNo, no), face ? eq(terminals.portFace, face) : sql`true`));
      return t!.id;
    });
  pon1 = await port(net.equipment.olt, "pon", 1);
  boxFront = (n) => port(net.equipment.box, "adapter", n, "front");
});
afterAll(async () => {
  await api.close();
  await db.close();
});

describe("трассировка", () => {
  it("от PON-порта: через сплиттер 1:8 до восьми абонентских портов ящика", async () => {
    const r = await post("/trace", { terminalId: pon1 });
    expect(r.status).toBe(200);
    const t = r.body as TraceResult;
    const leaves = t.leaves.map((i) => t.nodes[i]!);
    expect(leaves).toHaveLength(8);
    expect(leaves.every((l) => l.end === "subscriber_port")).toBe(true);
    // патч 0.3 + 4 сварки по 0.05 + сплиттер 10.5 + ~450 м волокна
    const loss = leaves[0]!.loss[1490];
    expect(loss).toBeGreaterThan(11);
    expect(loss).toBeLessThan(11.3);
    expect(leaves[0]!.loss[1310]).toBeGreaterThan(loss);
    expect(t.spans.map((s) => s.spanId).sort()).toEqual([net.spans.s1, net.spans.s2].sort());
    expect(t.spans.find((s) => s.spanId === net.spans.s2)!.fibers).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("от абонентского порта вверх: только до своего PON, не в соседние выходы сплиттера", async () => {
    const t = (await post("/trace", { terminalId: await boxFront(3) })).body as TraceResult;
    const leaves = t.leaves.map((i) => t.nodes[i]!);
    expect(leaves).toHaveLength(1);
    expect(leaves[0]).toMatchObject({ end: "olt", terminalId: pon1 });
    expect(t.nodes.some((n) => n.label.includes("выход 4"))).toBe(false);
  });

  it("неразваренный конец волокна — отдельная конечная точка", async () => {
    // волокно 2 магистрали со стороны узла не заведено никуда, кроме кросса без сварки
    const [f2] = await withTenant(db.db, { tenantId }, (tx) =>
      tx.execute<{ id: string }>(sql`
        SELECT t.id FROM terminals t JOIN fibers f ON f.id = t.fiber_id
        WHERE f.span_id = ${net.spans.s1} AND f.number = 2 AND t.fiber_side = 'a'`),
    );
    const t = (await post("/trace", { terminalId: f2!.id })).body as TraceResult;
    expect(t.leaves.map((i) => t.nodes[i]!.end)).toEqual(["open_fiber"]);
  });
});

describe("поиск места по рефлектометру", () => {
  it("на трассе, в запасе и за концом линии", async () => {
    const leaf = await boxFront(1);
    const routes = await withTenant(db.db, { tenantId }, (tx) =>
      tx.execute<{ len: number }>(sql`SELECT r.length_m AS len FROM span_routes x JOIN routes r ON r.id = x.route_id WHERE x.span_id = ${net.spans.s1} ORDER BY x.seq`),
    );
    const firstLeg = routes[0]!.len;
    const trunkRoutes = routes.reduce((s, r) => s + r.len, 0);

    const onRoute = (await post("/trace/locate", { terminalId: pon1, leafTerminalId: leaf, distanceM: firstLeg + 10 })).body;
    expect(onRoute.description).toMatch(/«Оп\. 1» → «Оп\. 2», 10 м от «Оп\. 1»/);
    expect(onRoute.position[0]).toBeGreaterThan(49.1095);

    const inSlack = (await post("/trace/locate", { terminalId: pon1, leafTerminalId: leaf, distanceM: trunkRoutes + 5 })).body;
    expect(inSlack.description).toMatch(/В запасе кабеля «Магистраль УС1–М1» в месте «Оп\. 2»/);

    const second = (await post("/trace/locate", { terminalId: pon1, leafTerminalId: leaf, distanceM: trunkRoutes + 15 + 20 })).body;
    expect(second.description).toMatch(/«Оп\. 2» → «Оп\. 3», 20 м от «Оп\. 2»/);

    const beyond = (await post("/trace/locate", { terminalId: pon1, leafTerminalId: leaf, distanceM: 5000 })).body;
    expect(beyond.beyond).toBe(true);
  });
});
