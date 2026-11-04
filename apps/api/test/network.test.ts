import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, cableSpans, connections, equipment, routes, sites, terminals } from "../src/db/schema/index.js";
import { point } from "../src/db/geo.js";
import { createDemoNetwork } from "../src/services/demo-network.js";
import { appDb, builder, newTenant, withTenant } from "./helpers.js";
import { expectPgError } from "./pg-error.js";

const app = appDb();
let tenantId: string;
const userId = "00000000-0000-4000-8000-000000000001";
const tx = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(app.db, { tenantId, userId }, fn);

beforeAll(async () => {
  tenantId = await newTenant(app.db);
});
afterAll(() => app.close());

describe("трассы", () => {
  it("концы трассы прилипают к местам и двигаются вместе с ними", async () => {
    const res = await tx(async (t) => {
      const b = builder(t, tenantId);
      const a = await b.site([49.1, 55.8]);
      const c = await b.site([49.101, 55.8]);
      // Рисуем линию «мимо» мест — триггер притянет концы.
      const r = await b.route(a, c, [[49.0999, 55.8001], [49.1005, 55.8003], [49.1011, 55.7999]]);
      const [snapped] = await t.execute<{ ok: boolean }>(sql`
        SELECT ST_Equals(ST_StartPoint(r.geom), sa.geom) AND ST_Equals(ST_EndPoint(r.geom), sc.geom) AS ok
        FROM routes r JOIN sites sa ON sa.id = r.from_site_id JOIN sites sc ON sc.id = r.to_site_id
        WHERE r.id = ${r.id}`);
      await t.update(sites).set({ geom: point([49.102, 55.8]) }).where(eq(sites.id, c));
      const [moved] = await t.select({ lengthM: routes.lengthM }).from(routes).where(eq(routes.id, r.id));
      return { snapped: snapped!.ok, before: r.lengthM, after: moved!.lengthM };
    });
    expect(res.snapped).toBe(true);
    expect(res.after).toBeGreaterThan(res.before + 50);
  });
});

describe("оборудование и порты", () => {
  it("порты создаются по модели", async () => {
    const counts = await tx(async (t) => {
      const b = builder(t, tenantId);
      const s = await b.site([49.2, 55.8]);
      const closure = await b.equipment("closure", "Муфта МТОК-Л6 (до 96 сварок)", s);
      const spl = await b.equipment("splitter", "PLC 1:8", s, closure);
      const odf = await b.equipment("odf", "Кросс ШКОС 1U, 24 порта", s);
      const count = async (id: string) =>
        (await t.select().from(terminals).where(eq(terminals.equipmentId, id))).length;
      return { closure: await count(closure), splitter: await count(spl), odf: await count(odf) };
    });
    expect(counts).toEqual({ closure: 0, splitter: 9, odf: 48 });
  });

  it("вложенное оборудование должно быть в том же месте, что и корпус", async () => {
    await expectPgError(
      tx(async (t) => {
        const b = builder(t, tenantId);
        const closure = await b.equipment("closure", "Муфта МТОК-Л6 (до 96 сварок)", await b.site([49.3, 55.8]));
        await b.equipment("splitter", "PLC 1:8", await b.site([49.31, 55.8]), closure);
      }),
      "23503",
    );
  });

  it("перенос муфты переносит вложенный сплиттер и его порты", async () => {
    const res = await tx(async (t) => {
      const b = builder(t, tenantId);
      const s1 = await b.site([49.4, 55.8]);
      const s2 = await b.site([49.41, 55.8]);
      const closure = await b.equipment("closure", "Муфта МТОК-Л6 (до 96 сварок)", s1);
      const spl = await b.equipment("splitter", "PLC 1:4", s1, closure);
      await t.update(equipment).set({ siteId: s2 }).where(eq(equipment.id, closure));
      const [e] = await t.select().from(equipment).where(eq(equipment.id, spl));
      const ports = await t.select().from(terminals).where(eq(terminals.equipmentId, spl));
      return { s2, splSite: e!.siteId, portSites: [...new Set(ports.map((p) => p.siteId))] };
    });
    expect(res.splSite).toBe(res.s2);
    expect(res.portSites).toEqual([res.s2]);
  });
});

describe("пролёты и соединения", () => {
  it("демо-сеть строится целиком: волокна, концы, сварки", async () => {
    const res = await tx(async (t) => {
      const net = await createDemoNetwork(t, tenantId);
      const ends = await t
        .select()
        .from(terminals)
        .where(and(eq(terminals.kind, "fiber_end"), eq(terminals.equipmentId, net.equipment.closure)));
      const conns = await t.select().from(connections).where(eq(connections.equipmentId, net.equipment.closure));
      return { ends: ends.length, conns: conns.length };
    });
    // В муфте: концы b 32 волокон магистрали + концы a 8 волокон распределения; сварок 1 + 8.
    expect(res).toEqual({ ends: 40, conns: 9 });
  });

  async function twoSpans() {
    return tx(async (t) => {
      const b = builder(t, tenantId);
      const a = await b.site([49.5, 55.8]);
      const m = await b.site([49.501, 55.8]);
      const z = await b.site([49.502, 55.8]);
      const closure = await b.equipment("closure", "Муфта МТОК-Л6 (до 96 сварок)", m);
      const cab = await b.cable("ОКСН 1×8");
      const other = await b.cable("ОКСН 1×8");
      const s1 = await b.span({ cableId: cab, seq: 1, from: a, to: m, toEq: closure });
      const s2 = await b.span({ cableId: cab, seq: 2, from: m, to: z, fromEq: closure });
      const s3 = await b.span({ cableId: other, from: m, to: z, fromEq: closure });
      return { a, m, z, closure, s1, s2, s3 };
    });
  }

  it("точка подключения участвует только в одном соединении", async () => {
    const n = await twoSpans();
    await tx(async (t) => {
      const b = builder(t, tenantId);
      await t.insert(connections).values({
        tenantId, siteId: n.m, equipmentId: n.closure, kind: "fusion",
        aTerminalId: await b.fiberEnd(n.s1, 1, "b"), bTerminalId: await b.fiberEnd(n.s3, 1, "a"),
      });
    });
    // Тот же конец, но в колонке b другой записи — уникальные индексы этого не ловят, ловит триггер.
    await expectPgError(
      tx(async (t) => {
        const b = builder(t, tenantId);
        await t.insert(connections).values({
          tenantId, siteId: n.m, equipmentId: n.closure, kind: "fusion",
          aTerminalId: await b.fiberEnd(n.s3, 2, "a"), bTerminalId: await b.fiberEnd(n.s1, 1, "b"),
        });
      }),
      "23505",
    );
  });

  it("соединять можно только точки в месте соединения", async () => {
    const n = await twoSpans();
    await expectPgError(
      tx(async (t) => {
        const b = builder(t, tenantId);
        await t.insert(connections).values({
          tenantId, siteId: n.m, kind: "fusion",
          aTerminalId: await b.fiberEnd(n.s1, 1, "a"), bTerminalId: await b.fiberEnd(n.s3, 1, "a"),
        });
      }),
      "23514",
      /месте соединения/,
    );
  });

  it("транзит — только одно и то же волокно соседних пролётов одного кабеля", async () => {
    const n = await twoSpans();
    await tx(async (t) => {
      const b = builder(t, tenantId);
      await t.insert(connections).values({
        tenantId, siteId: n.m, equipmentId: n.closure, kind: "through",
        aTerminalId: await b.fiberEnd(n.s1, 5, "b"), bTerminalId: await b.fiberEnd(n.s2, 5, "a"),
      });
    });
    await expectPgError(
      tx(async (t) => {
        const b = builder(t, tenantId);
        await t.insert(connections).values({
          tenantId, siteId: n.m, equipmentId: n.closure, kind: "through",
          aTerminalId: await b.fiberEnd(n.s1, 6, "b"), bTerminalId: await b.fiberEnd(n.s3, 6, "a"),
        });
      }),
      "23514",
      /Транзит/,
    );
  });

  it("нельзя увести конец пролёта, пока на нём есть соединения", async () => {
    const n = await twoSpans();
    await tx(async (t) => {
      const b = builder(t, tenantId);
      await t.insert(connections).values({
        tenantId, siteId: n.m, equipmentId: n.closure, kind: "fusion",
        aTerminalId: await b.fiberEnd(n.s1, 1, "b"), bTerminalId: await b.fiberEnd(n.s3, 1, "a"),
      });
    });
    await expectPgError(
      tx(async (t) => {
        const elsewhere = await builder(t, tenantId).site([49.6, 55.8]);
        await t.update(cableSpans).set({ toSiteId: elsewhere, toEquipmentId: null }).where(eq(cableSpans.id, n.s1));
      }),
      "23514",
      /Сначала разъедините/,
    );
  });

  it("патч-корд нельзя подключить к стороне под сварку", async () => {
    await expectPgError(
      tx(async (t) => {
        const b = builder(t, tenantId);
        const s = await b.site([49.7, 55.8], "pop");
        const olt = await b.equipment("olt", "OLT 8 PON", s);
        const odf = await b.equipment("odf", "Кросс ШКОС 1U, 24 порта", s);
        await t.insert(connections).values({
          tenantId, siteId: s, kind: "patch",
          aTerminalId: await b.port(olt, "pon", 1), bTerminalId: await b.port(odf, "adapter", 1, "rear"),
        });
      }),
      "23514",
      /front/,
    );
  });

  it("изменения пишутся в журнал с пользователем", async () => {
    const rows = await tx((t) =>
      t.select().from(auditLog).where(and(eq(auditLog.tableName, "connections"), eq(auditLog.userId, userId))),
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
