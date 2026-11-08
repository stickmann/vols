import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connections, auditLog, spanRoutes } from "../src/db/schema/index.js";
import { appDb, builder, newTenant, withTenant } from "./helpers.js";
import { expectPgError } from "./pg-error.js";

const app = appDb();
let tenantId: string;
const userId = "00000000-0000-4000-8000-000000000002";
const tx = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(app.db, { tenantId, userId }, fn);

beforeAll(async () => {
  tenantId = await newTenant(app.db);
});
afterAll(() => app.close());

describe("ограничения топологии на уровне БД", () => {
  it("запрещает транзит между первым и третьим пролётами одного кабеля", async () => {
    const n = await tx(async (t) => {
      const b = builder(t, tenantId);
      const a = await b.site([49.8, 55.8]);
      const junction = await b.site([49.801, 55.8]);
      const c = await b.site([49.802, 55.8]);
      const cable = await b.cable("ОКСН 1×8");
      const first = await b.span({ cableId: cable, seq: 1, from: a, to: junction });
      await b.span({ cableId: cable, seq: 2, from: junction, to: c });
      // Третий пролёт возвращается в junction: у концов есть общая точка,
      // поэтому старая проверка ошибочно принимала транзит 1 -> 3.
      const third = await b.span({ cableId: cable, seq: 3, from: c, to: junction });
      return { junction, first, third };
    });

    await expectPgError(
      tx(async (t) => {
        const b = builder(t, tenantId);
        await t.insert(connections).values({
          tenantId,
          siteId: n.junction,
          kind: "through",
          aTerminalId: await b.fiberEnd(n.first, 1, "b"),
          bTerminalId: await b.fiberEnd(n.third, 1, "b"),
        });
      }),
      "23514",
      /соседних пролётов/,
    );
  });

  it("запрещает соединение splitter output-output", async () => {
    const n = await tx(async (t) => {
      const b = builder(t, tenantId);
      const site = await b.site([49.81, 55.8]);
      const splitter = await b.equipment("splitter", "PLC 1:4", site);
      return { site, splitter };
    });

    await expectPgError(
      tx(async (t) => {
        const b = builder(t, tenantId);
        await t.insert(connections).values({
          tenantId,
          siteId: n.site,
          equipmentId: n.splitter,
          kind: "fusion",
          aTerminalId: await b.port(n.splitter, "out", 1),
          bTerminalId: await b.port(n.splitter, "out", 2),
        });
      }),
      "23514",
      /вход сплиттера со входом/,
    );
  });


  it("проверяет reversed и конечные точки последовательности трасс", async () => {
    const n = await tx(async (t) => {
      const b = builder(t, tenantId);
      const a = await b.site([49.82, 55.8]);
      const z = await b.site([49.821, 55.8]);
      const route = await b.route(a, z, [[49.82, 55.8], [49.821, 55.8]]);
      const cable = await b.cable("ОКСН 1×8");
      const span = await b.span({ cableId: cable, from: a, to: z });
      return { a, z, route, span };
    });

    await expectPgError(
      tx((t) =>
        t.insert(spanRoutes).values({
          tenantId,
          spanId: n.span,
          seq: 1,
          routeId: n.route.id,
          reversed: true,
        }),
      ),
      "23514",
      /начальное и конечное места/,
    );
  });

  it("не разрешает прямую подделку строк журнала от имени роли приложения", async () => {
    await expectPgError(
      tx((t) =>
        t.insert(auditLog).values({
          tenantId,
          userId,
          tableName: "sites",
          rowId: "00000000-0000-4000-8000-000000000003",
          action: "insert",
        }),
      ),
      "42501",
    );
  });
});
