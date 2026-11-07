import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { appDb, newTenant } from "./helpers.js";

const db = appDb();
const api = buildApp({ db: db.db, devTenantHeader: true });
let tenantId: string;
afterAll(async () => {
  await api.close();
  await db.close();
});

const call = async (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) => {
  const res = await api.inject({ method, url: `/api/v1${url}`, headers: { "x-tenant-id": tenantId }, payload: payload as never });
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
};

type Fiber = { terminalId: string; number: number };
type Splicing = {
  cables: { spanId: string; cableId: string; side: "a" | "b"; fibers: Fiber[] }[];
  devices: { id: string; kind: string; ports: { terminalId: string; role: string; no: number; face: string | null }[] }[];
  connections: { id: string; kind: string; aTerminalId: string; bTerminalId: string }[];
};
type Cable = { spans: { id: string; seq: number; fromSiteId: string; toSiteId: string; fromEquipmentId: string | null; toEquipmentId: string | null; routeIds: string[] }[] };
type Impact = { title: string; effects: { kind: string; text: string }[] };

const ids = {} as Record<"A" | "B" | "C" | "D" | "odf" | "box" | "k1" | "closure", string> & Record<string, string>;
const routeIds: string[] = [];
let models: { id: string; name: string }[];
let types: { id: string; name: string }[];
const model = (name: string) => models.find((m) => m.name === name)!.id;
const splicing = async (eqId: string) => (await call("GET", `/equipment/${eqId}/splicing`)).body as Splicing;
const cable = async (id: string) => (await call("GET", `/cables/${id}`)).body as Cable;
const port = (s: Splicing, kind: string, role: string, no: number, face: string | null = null) =>
  s.devices.find((d) => d.kind === kind)!.ports.find((p) => p.role === role && p.no === no && p.face === face)!.terminalId;
const fiber = (s: Splicing, side: "a" | "b", n: number, cableId = ids.k1) =>
  s.cables.find((c) => c.side === side && c.cableId === cableId)!.fibers.find((f) => f.number === n)!.terminalId;

/** Муфта М-1 в C на транзитном кабеле A→D: волокно 1 — на сплиттер, выход 1 — в волокно 2 дальше. */
async function buildClosure(siteKey: string, name: string) {
  const id = (await call("POST", "/equipment", { siteId: ids[siteKey], modelId: model("Муфта МТОК-Л6 (до 96 сварок)"), name })).body.id as string;
  await call("POST", "/equipment", { siteId: ids[siteKey], modelId: model("PLC 1:4"), parentId: id });
  const span = (await cable(ids.k1)).spans.find((sp) => sp.routeIds.length > 1)!.id;
  expect((await call("POST", `/equipment/${id}/cables`, { spanId: span })).status).toBe(201);
  return id;
}

beforeAll(async () => {
  tenantId = await newTenant(db.db);
  const pts: Record<string, [number, number]> = { A: [49.1, 55.8], B: [49.101, 55.8], C: [49.102, 55.8], D: [49.103, 55.8] };
  for (const [k, position] of Object.entries(pts)) ids[k] = (await call("POST", "/sites", { kind: k === "A" ? "pop" : "pole", name: k, position })).body.id;
  for (const [a, b] of [["A", "B"], ["B", "C"], ["C", "D"]] as const) {
    routeIds.push((await call("POST", "/routes", { kind: "aerial", fromSiteId: ids[a], toSiteId: ids[b], coordinates: [pts[a], pts[b]] })).body.id);
  }
  models = (await call("GET", "/equipment-models")).body;
  types = (await call("GET", "/cable-types")).body;
  ids.odf = (await call("POST", "/equipment", { siteId: ids.A, modelId: model("Кросс ШКОС 1U, 24 порта"), name: "Кросс" })).body.id;
  ids.box = (await call("POST", "/equipment", { siteId: ids.D, modelId: model("ОРК на 8 абонентов (SC/APC)"), name: "ОРК" })).body.id;
  ids.k1 = (
    await call("POST", "/cables", {
      cableTypeId: types.find((t) => t.name === "ОКСН 1×8")!.id,
      name: "К-1",
      siteIds: [ids.A, ids.B, ids.C, ids.D],
      fromEquipmentId: ids.odf,
      toEquipmentId: ids.box,
    })
  ).body.id;
  // Концы: кросс ← волокно 1, волокно 2 → ящик.
  const odf = await splicing(ids.odf);
  await call("POST", "/connections", { equipmentId: ids.odf, aTerminalId: port(odf, "odf", "adapter", 1, "rear"), bTerminalId: fiber(odf, "a", 1) });
  const box = await splicing(ids.box);
  await call("POST", "/connections", { equipmentId: ids.box, aTerminalId: fiber(box, "b", 2), bTerminalId: port(box, "terminal_box", "adapter", 1, "rear") });

  ids.closure = await buildClosure("C", "М-1");
});

/** Разрезать транзит волокон 1 и 2 и развести: 1 → вход сплиттера, выход 1 → волокно 2. */
async function spliceSplitter(closureId: string) {
  const s = await splicing(closureId);
  for (const n of [1, 2]) {
    const t = s.connections.find((c) => c.kind === "through" && (c.aTerminalId === fiber(s, "b", n) || c.bTerminalId === fiber(s, "b", n)))!;
    expect((await call("DELETE", `/connections/${t.id}`)).status).toBe(204);
  }
  for (const [a, b] of [
    [fiber(s, "b", 1), port(s, "splitter", "in", 1)],
    [port(s, "splitter", "out", 1), fiber(s, "a", 2)],
  ]) expect((await call("POST", "/connections", { equipmentId: closureId, aTerminalId: a, bTerminalId: b })).status).toBe(201);
}

describe("очистка разварки", () => {
  it("удаляет сварки и возвращает транзит разрезанных волокон", async () => {
    await spliceSplitter(ids.closure);
    let s = await splicing(ids.closure);
    expect(s.connections.filter((c) => c.kind === "fusion")).toHaveLength(2);
    expect(s.connections.filter((c) => c.kind === "through")).toHaveLength(6);

    const r = await call("POST", `/equipment/${ids.closure}/clear-splicing`, { restoreThrough: true });
    expect(r.body).toMatchObject({ deleted: 2, restored: 2 });
    s = await splicing(ids.closure);
    expect(s.connections.every((c) => c.kind === "through")).toBe(true);
    expect(s.connections).toHaveLength(8);
  });

  it("без восстановления транзита волокна остаются разрезанными", async () => {
    await spliceSplitter(ids.closure);
    const r = await call("POST", `/equipment/${ids.closure}/clear-splicing`, { restoreThrough: false });
    expect(r.body).toMatchObject({ deleted: 2, restored: 0 });
    expect((await splicing(ids.closure)).connections).toHaveLength(6);
  });
});

describe("удаление муфты", () => {
  it("последствия перечисляют сплиттер, соединения и транзитный кабель", async () => {
    await call("POST", `/equipment/${ids.closure}/clear-splicing`, { restoreThrough: true });
    await spliceSplitter(ids.closure);
    const imp = (await call("GET", `/equipment/${ids.closure}/impact`)).body as Impact;
    expect(imp.title).toBe("М-1");
    const text = imp.effects.map((e) => e.text).join("\n");
    expect(text).toContain("PLC 1:4");
    expect(text).toContain("2 соединения");
    expect(text).toContain("Транзитные кабели снова пройдут сквозь место без разреза: К-1");
  });

  it("без подтверждения — отказ, с подтверждением — кабель снова целый, концы сохранены", async () => {
    expect((await call("DELETE", `/equipment/${ids.closure}`)).status).toBe(409);
    expect(await cable(ids.k1).then((c) => c.spans)).toHaveLength(2);

    expect((await call("DELETE", `/equipment/${ids.closure}?force=true`)).status).toBe(200);
    const c = await cable(ids.k1);
    expect(c.spans).toHaveLength(1);
    expect(c.spans[0]).toMatchObject({ seq: 1, fromSiteId: ids.A, toSiteId: ids.D, fromEquipmentId: ids.odf, toEquipmentId: ids.box, routeIds });
    // Сварки на кроссе и в ящике переехали на волокна склеенного пролёта.
    const box = await splicing(ids.box);
    expect(box.connections).toHaveLength(1);
    expect(box.connections[0]!.aTerminalId).toBe(fiber(box, "b", 2));
    expect((await splicing(ids.odf)).connections).toHaveLength(1);
    expect((await call("GET", `/equipment/${ids.closure}/splicing`)).status).toBe(404);
  });

  it("трассировка снова идёт от кросса до ящика по целому волокну", async () => {
    const odf = await splicing(ids.odf);
    const t = (await call("POST", "/trace", { terminalId: port(odf, "odf", "adapter", 1, "rear") })).body as { nodes: { siteName: string }[] };
    expect(t.nodes.map((n) => n.siteName)).toContain("D");
  });
});

describe("вывод кабеля из корпуса", () => {
  it("транзитный кабель склеивается; со сварками — только с подтверждением", async () => {
    const m2 = await buildClosure("B", "М-2");
    expect((await cable(ids.k1)).spans).toHaveLength(2);
    await spliceSplitter(m2);
    const s = await splicing(m2);
    const incoming = s.cables.find((c) => c.side === "b")!.spanId;
    expect((await call("DELETE", `/equipment/${m2}/cables/${incoming}`)).status).toBe(409);
    const r = await call("DELETE", `/equipment/${m2}/cables/${incoming}?force=true`);
    expect(r.body).toMatchObject({ merged: true });
    expect((await cable(ids.k1)).spans).toHaveLength(1);
    expect((await splicing(m2)).connections).toHaveLength(0);
    expect((await splicing(ids.box)).connections).toHaveLength(1);
  });
});

describe("кабель, разрезанный в двух муфтах", () => {
  it("удаление первой муфты не ломает транзит во второй, номера пролётов подряд", async () => {
    const mb = await buildClosure("B", "М-Б");
    const mc = await buildClosure("C", "М-В");
    let c = await cable(ids.k1);
    expect(c.spans.map((s) => s.seq)).toEqual([1, 2, 3]);
    expect((await splicing(mc)).connections.filter((x) => x.kind === "through")).toHaveLength(8);

    expect((await call("DELETE", `/equipment/${mb}?force=true`)).status).toBe(200);
    c = await cable(ids.k1);
    expect(c.spans.map((s) => [s.seq, s.fromSiteId, s.toSiteId])).toEqual([
      [1, ids.A, ids.C],
      [2, ids.C, ids.D],
    ]);
    const s = await splicing(mc);
    expect(s.connections.filter((x) => x.kind === "through")).toHaveLength(8);
    // Транзит во второй муфте соединяет волокна нового первого пролёта со вторым.
    expect(s.cables.find((x) => x.side === "b")!.spanId).toBe(c.spans[0]!.id);

    expect((await call("DELETE", `/equipment/${mc}?force=true`)).status).toBe(200);
    expect((await cable(ids.k1)).spans).toHaveLength(1);
    expect((await splicing(ids.box)).connections).toHaveLength(1);
  });
});

describe("удаление трассы, кабеля и места", () => {
  it("трасса — вместе с проложенными по ней кабелями", async () => {
    const k2 = (await call("POST", "/cables", { cableTypeId: types.find((t) => t.name === "ОКСН 1×8")!.id, name: "К-2", siteIds: [ids.C, ids.D] })).body.id;
    const imp = (await call("GET", `/routes/${routeIds[2]}/impact`)).body as Impact;
    expect(imp.effects.map((e) => e.text).join("\n")).toMatch(/К-1.*К-2|К-2.*К-1/);
    expect((await call("DELETE", `/routes/${routeIds[2]}`)).status).toBe(409);
    expect((await call("DELETE", `/routes/${routeIds[2]}?force=true`)).status).toBe(200);
    expect((await call("GET", `/cables/${k2}`)).status).toBe(404);
    expect((await call("GET", `/cables/${ids.k1}`)).status).toBe(404);
    expect((await splicing(ids.box)).connections).toHaveLength(0);
  });

  it("кабель со сварками — с подтверждением", async () => {
    const k3 = (await call("POST", "/cables", { cableTypeId: types.find((t) => t.name === "ОКСН 1×8")!.id, name: "К-3", siteIds: [ids.A, ids.B], fromEquipmentId: ids.odf })).body.id;
    const odf = await splicing(ids.odf);
    await call("POST", "/connections", { equipmentId: ids.odf, aTerminalId: port(odf, "odf", "adapter", 2, "rear"), bTerminalId: fiber(odf, "a", 1, k3) });
    expect((await call("GET", `/cables/${k3}/impact`)).body.effects.map((e: { text: string }) => e.text)).toContain("1 соединение на его волокнах");
    expect((await call("DELETE", `/cables/${k3}`)).status).toBe(409);
    expect((await call("DELETE", `/cables/${k3}?force=true`)).status).toBe(200);
    expect((await splicing(ids.odf)).connections).toHaveLength(0);
  });

  it("место — с оборудованием, трассами и кабелями", async () => {
    const k4 = (await call("POST", "/cables", { cableTypeId: types.find((t) => t.name === "ОКСН 1×8")!.id, name: "К-4", siteIds: [ids.A, ids.B, ids.C], fromEquipmentId: ids.odf })).body.id;
    const imp = (await call("GET", `/sites/${ids.A}/impact`)).body as Impact;
    const text = imp.effects.map((e) => e.text).join("\n");
    expect(text).toContain("Кросс");
    expect(text).toContain("К-4");
    expect((await call("DELETE", `/sites/${ids.A}`)).status).toBe(409);
    expect((await call("DELETE", `/sites/${ids.A}?force=true`)).status).toBe(200);
    expect((await call("GET", `/sites/${ids.A}`)).status).toBe(404);
    expect((await call("GET", `/cables/${k4}`)).status).toBe(404);
    expect((await call("GET", `/routes/${routeIds[0]}`)).status).toBe(404);
    expect((await call("GET", `/routes/${routeIds[1]}`)).status).toBe(200);
  });
});
