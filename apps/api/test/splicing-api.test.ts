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

const ids: Record<string, string> = {};
type Splicing = {
  cables: { spanId: string; cableId: string; side: "a" | "b"; fibers: { terminalId: string; number: number; color: { name: string } }[] }[];
  devices: { id: string; kind: string; ports: { terminalId: string; role: string; no: number; face: string | null }[] }[];
  connections: { id: string; kind: string; aTerminalId: string; bTerminalId: string }[];
  candidates: { spanId: string; mode: "end" | "transit" }[];
};
const splicing = async (eqId: string | undefined) => (await call("GET", `/equipment/${eqId}/splicing`)).body as Splicing;

beforeAll(async () => {
  tenantId = await newTenant(db.db);
  const pts: Record<string, [number, number]> = { A: [49.1, 55.8], B: [49.101, 55.8], C: [49.102, 55.8], D: [49.103, 55.8] };
  for (const [k, position] of Object.entries(pts)) ids[k] = (await call("POST", "/sites", { kind: k === "A" ? "pop" : "pole", name: k, position })).body.id;
  for (const [a, b] of [["A", "B"], ["B", "C"], ["C", "D"]] as const) {
    await call("POST", "/routes", { kind: "aerial", fromSiteId: ids[a], toSiteId: ids[b], coordinates: [pts[a], pts[b]] });
  }
  const models = (await call("GET", "/equipment-models")).body as { id: string; kind: string; name: string }[];
  const model = (name: string) => models.find((m) => m.name === name)!.id;
  ids.odf = (await call("POST", "/equipment", { siteId: ids.A, modelId: model("Кросс ШКОС 1U, 24 порта"), name: "Кросс" })).body.id;
  ids.closure = (await call("POST", "/equipment", { siteId: ids.C, modelId: model("Муфта МТОК-Л6 (до 96 сварок)"), name: "М-1" })).body.id;
  ids.splitter = (await call("POST", "/equipment", { siteId: ids.C, modelId: model("PLC 1:4"), parentId: ids.closure })).body.id;
  ids.box = (await call("POST", "/equipment", { siteId: ids.D, modelId: model("ОРК на 8 абонентов (SC/APC)"), name: "ОРК" })).body.id;
  const types = (await call("GET", "/cable-types")).body as { id: string; name: string }[];
  ids.cable = (
    await call("POST", "/cables", {
      cableTypeId: types.find((t) => t.name === "ОКСН 1×8")!.id,
      name: "К-1",
      siteIds: [ids.A, ids.B, ids.C, ids.D],
      fromEquipmentId: ids.odf,
      toEquipmentId: ids.box,
    })
  ).body.id;
});

describe("разварка", () => {
  it("схема ящика: заведённый кабель с цветами волокон и порты адаптеров", async () => {
    const s = await splicing(ids.box);
    expect(s.cables).toHaveLength(1);
    expect(s.cables[0]!.side).toBe("b");
    expect(s.cables[0]!.fibers).toHaveLength(8);
    expect(s.cables[0]!.fibers[0]!.color.name).toBe("Красный");
    expect(s.devices[0]!.ports.filter((p) => p.face === "rear")).toHaveLength(8);
  });

  it("соединение по умолчанию — сварка", async () => {
    const box = await splicing(ids.box);
    const rear1 = box.devices[0]!.ports.find((p) => p.no === 1 && p.face === "rear")!;
    const r = await call("POST", "/connections", { equipmentId: ids.box, aTerminalId: box.cables[0]!.fibers[0]!.terminalId, bTerminalId: rear1.terminalId });
    expect(r.status).toBe(201);

    const s2 = await splicing(ids.box);
    expect(s2.connections).toMatchObject([{ kind: "fusion" }]);
  });

  it("пакетная сварка — всё или ничего", async () => {
    const box = await splicing(ids.box);
    const fib = box.cables[0]!.fibers;
    const rear = (n: number) => box.devices[0]!.ports.find((p) => p.no === n && p.face === "rear")!.terminalId;
    // волокно 1 уже сварено — вся пачка должна откатиться
    const bad = await call("POST", "/connections/batch", {
      equipmentId: ids.box,
      pairs: [2, 3, 1].map((n) => ({ aTerminalId: fib[n - 1]!.terminalId, bTerminalId: rear(n + 4) })),
    });
    expect(bad.status).toBe(409);
    expect((await splicing(ids.box)).connections).toHaveLength(1);
    const ok = await call("POST", "/connections/batch", {
      equipmentId: ids.box,
      pairs: [2, 3].map((n) => ({ aTerminalId: fib[n - 1]!.terminalId, bTerminalId: rear(n) })),
    });
    expect(ok.status).toBe(201);
    expect((await splicing(ids.box)).connections).toHaveLength(3);
  });

  it("транзитный кабель заводится в муфту: пролёт режется, волокна идут транзитом, дальние сварки сохраняются", async () => {
    const before = await splicing(ids.closure);
    const cand = before.candidates.find((c) => c.mode === "transit")!;
    expect(cand).toBeDefined();
    const r = await call("POST", `/equipment/${ids.closure}/cables`, { spanId: cand.spanId });
    expect(r.status).toBe(201);
    expect(r.body.split).toBe(true);

    const s = await splicing(ids.closure);
    expect(s.cables.map((c) => c.side).sort()).toEqual(["a", "b"]);
    expect(s.connections.filter((c) => c.kind === "through")).toHaveLength(8);
    expect(s.candidates).toHaveLength(0);

    const cable = (await call("GET", `/cables/${ids.cable}`)).body;
    expect(cable.spans).toHaveLength(2);
    expect(cable.spans[0]).toMatchObject({ toSiteId: ids.C, toEquipmentId: ids.closure });
    expect(cable.spans[1]).toMatchObject({ fromSiteId: ids.C, toEquipmentId: ids.box, routeIds: [expect.any(String)] });

    // Сварки в ящике остались на месте и указывают на волокна второго пролёта.
    const box = await splicing(ids.box);
    expect(box.connections).toHaveLength(3);
    expect(box.cables[0]!.spanId).toBe(cable.spans[1].id);
    const boxFiber1 = box.cables[0]!.fibers[0]!.terminalId;
    expect(box.connections.some((c) => [c.aTerminalId, c.bTerminalId].includes(boxFiber1))).toBe(true);
  });

  it("волокно разрезается и разваривается через сплиттер", async () => {
    const s = await splicing(ids.closure);
    const incoming = s.cables.find((c) => c.side === "b")!; // пролёт, пришедший из узла
    const outgoing = s.cables.find((c) => c.side === "a")!;
    const f4in = incoming.fibers[3]!.terminalId;
    const f4out = outgoing.fibers[3]!.terminalId;
    const through = s.connections.find((c) => c.kind === "through" && [c.aTerminalId, c.bTerminalId].includes(f4in))!;

    // пока волокно идёт транзитом, сварить его нельзя
    const spl = s.devices.find((d) => d.kind === "splitter")!;
    const spIn = spl.ports.find((p) => p.role === "in")!.terminalId;
    expect((await call("POST", "/connections", { equipmentId: ids.closure, aTerminalId: f4in, bTerminalId: spIn })).status).toBe(409);

    expect((await call("DELETE", `/connections/${through.id}`)).status).toBe(204);
    expect((await call("POST", "/connections", { equipmentId: ids.closure, aTerminalId: f4in, bTerminalId: spIn, lossDb: 0.03, trayNo: 1 })).status).toBe(201);
    const spOut1 = spl.ports.find((p) => p.role === "out" && p.no === 1)!.terminalId;
    expect((await call("POST", "/connections", { equipmentId: ids.closure, aTerminalId: spOut1, bTerminalId: f4out })).status).toBe(201);

    const after = await splicing(ids.closure);
    expect(after.connections.filter((c) => c.kind === "through")).toHaveLength(7);
    expect(after.connections.filter((c) => c.kind === "fusion")).toHaveLength(2);
  });

  it("транзит нельзя превратить в сварку правкой, а сварку можно сделать механической", async () => {
    const s = await splicing(ids.closure);
    const through = s.connections.find((c) => c.kind === "through")!;
    expect((await call("PATCH", `/connections/${through.id}`, { kind: "fusion" })).status).toBe(422);
    const fusion = s.connections.find((c) => c.kind === "fusion")!;
    expect((await call("PATCH", `/connections/${fusion.id}`, { kind: "mechanical", lossDb: 0.2 })).status).toBe(204);
  });

  it("кабель с соединениями нельзя вывести из корпуса; разварку ведут только в корпусах", async () => {
    const s = await splicing(ids.closure);
    expect((await call("DELETE", `/equipment/${ids.closure}/cables/${s.cables[0]!.spanId}`)).status).toBe(409);
    expect((await call("GET", `/equipment/${ids.splitter}/splicing`)).status).toBe(422);
  });
});
