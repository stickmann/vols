import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { appDb, newTenant } from "./helpers.js";

const db = appDb();
const api = buildApp({ db: db.db, devTenantHeader: true });
let tenantId: string;

beforeAll(async () => {
  tenantId = await newTenant(db.db);
});
afterAll(async () => {
  await api.close();
  await db.close();
});

const call = async (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) => {
  const res = await api.inject({ method, url: `/api/v1${url}`, headers: { "x-tenant-id": tenantId }, payload: payload as never });
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
};

describe("API сети", () => {
  const P = { a: [49.1, 55.8], b: [49.101, 55.8], c: [49.102, 55.8], d: [49.101, 55.801] } as const;
  const ids: Record<string, string> = {};

  it("создаёт места и трассы, отдаёт сеть как GeoJSON", async () => {
    for (const [k, position] of Object.entries(P)) {
      const r = await call("POST", "/sites", { kind: k === "a" ? "pop" : "pole", name: k.toUpperCase(), position });
      expect(r.status).toBe(201);
      ids[k] = r.body.id;
    }
    for (const [from, to] of [["a", "b"], ["b", "c"], ["b", "d"]] as const) {
      const r = await call("POST", "/routes", {
        kind: "aerial",
        fromSiteId: ids[from],
        toSiteId: ids[to],
        coordinates: [P[from], P[to]],
      });
      expect(r.status).toBe(201);
      ids[`${from}${to}`] = r.body.id;
    }
    const net = await call("GET", "/network");
    expect(net.body.sites.features).toHaveLength(4);
    expect(net.body.routes.features).toHaveLength(3);
    expect(net.body.routes.features[0].properties.lengthM).toBeGreaterThan(50);
  });

  it("ищет кратчайший путь по трассам", async () => {
    const r = await call("POST", "/routing/path", { fromSiteId: ids.a, toSiteId: ids.c });
    expect(r.status).toBe(200);
    expect(r.body.siteIds).toEqual([ids.a, ids.b, ids.c]);
    expect(r.body.routeIds).toEqual([ids.ab, ids.bc]);
    const none = await call("POST", "/sites", { kind: "pole", position: [49.2, 55.9] });
    expect((await call("POST", "/routing/path", { fromSiteId: ids.a, toSiteId: none.body.id })).status).toBe(422);
  });

  it("прокладывает кабель по пути, в том числе против направления трассы", async () => {
    const types = await call("GET", "/cable-types");
    const type = types.body.find((t: { name: string }) => t.name === "ОКСН 1×8");
    const models = await call("GET", "/equipment-models");
    const closureModel = models.body.find((m: { kind: string }) => m.kind === "closure");
    const closure = await call("POST", "/equipment", { siteId: ids.c, modelId: closureModel.id, name: "М-1" });
    expect(closure.status).toBe(201);

    const cab = await call("POST", "/cables", {
      cableTypeId: type.id,
      name: "К-1",
      siteIds: [ids.c, ids.b, ids.a],
      fromEquipmentId: closure.body.id,
      slacks: [{ siteId: ids.b, lengthM: 20 }],
    });
    expect(cab.status).toBe(201);
    ids.cable = cab.body.id;

    const detail = await call("GET", `/cables/${ids.cable}`);
    expect(detail.body.fiberCount).toBe(8);
    expect(detail.body.spans[0]).toMatchObject({ fromEquipmentName: "М-1", slackM: 20, routeIds: [ids.bc, ids.ab] });

    const net = await call("GET", "/network");
    const f = net.body.cables.features[0];
    expect(f.geometry.type).toBe("LineString");
    expect(f.geometry.coordinates[0][0]).toBeCloseTo(P.c[0], 6);
    expect(f.properties.lengthM).toBeGreaterThan(detail.body.spans[0].routeLengthM);
  });

  it("не прокладывает кабель там, где нет трассы, и не ставит в начало чужое оборудование", async () => {
    const types = await call("GET", "/cable-types");
    const cableTypeId = types.body[0].id;
    expect((await call("POST", "/cables", { cableTypeId, siteIds: [ids.a, ids.c] })).status).toBe(422);
    const site = await call("GET", `/sites/${ids.c}`);
    const r = await call("POST", "/cables", { cableTypeId, siteIds: [ids.a, ids.b], fromEquipmentId: site.body.equipment[0].id });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/другом месте/);
  });

  it("не удаляет используемые объекты и объясняет почему", async () => {
    const route = await call("DELETE", `/routes/${ids.ab}`);
    expect(route.status).toBe(409);
    expect(route.body.error).toMatch(/кабелей: 1/);
    const site = await call("DELETE", `/sites/${ids.b}`);
    expect(site.status).toBe(409);
    const eq = (await call("GET", `/sites/${ids.c}`)).body.equipment[0];
    expect((await call("DELETE", `/equipment/${eq.id}`)).status).toBe(409);
  });

  it("перенос места двигает трассы, удаление идёт сверху вниз", async () => {
    expect((await call("PATCH", `/sites/${ids.d}`, { position: [49.1012, 55.8015], name: "D2" })).status).toBe(204);
    const route = await call("GET", `/routes/${ids.bd}`);
    expect(route.body.geometry.coordinates.at(-1)[1]).toBeCloseTo(55.8015, 6);
    expect(route.body.toName).toBe("D2");

    expect((await call("DELETE", `/cables/${ids.cable}`)).status).toBe(204);
    expect((await call("DELETE", `/routes/${ids.ab}`)).status).toBe(204);
    expect((await call("DELETE", `/sites/${ids.a}`)).status).toBe(204);
  });
});
