import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { withTenant } from "../src/db/client.js";
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
type Op = { id: string; kind: string; title: string; canUndo: boolean; undoneAt: string | null };

const ids = {} as Record<"A" | "B" | "C" | "D" | "odf" | "box" | "k1" | "closure", string>;
const splicing = async (eqId: string) => (await call("GET", `/equipment/${eqId}/splicing`)).body as Splicing;
const port = (s: Splicing, kind: string, role: string, no: number, face: string | null = null) =>
  s.devices.find((d) => d.kind === kind)!.ports.find((p) => p.role === role && p.no === no && p.face === face)!.terminalId;
const fiber = (s: Splicing, side: "a" | "b", n: number) =>
  s.cables.find((c) => c.side === side && c.cableId === ids.k1)!.fibers.find((f) => f.number === n)!.terminalId;

/** Полный снимок сети оператора: все строки всех таблиц, без updated_at. */
const TABLES = ["sites", "routes", "equipment", "cables", "cable_spans", "span_routes", "cable_slacks", "fibers", "terminals", "connections"];
async function snapshot() {
  return withTenant(db.db, { tenantId }, async (tx) => {
    const out: Record<string, unknown> = {};
    for (const t of TABLES) {
      const [r] = await tx.execute<{ rows: unknown }>(sql`
        SELECT coalesce(jsonb_agg(to_jsonb(x) - 'updated_at' ORDER BY x.id), '[]') AS rows FROM ${sql.identifier(t)} x`);
      out[t] = r!.rows;
    }
    return out;
  });
}

const undo = (opId: string) => call("POST", `/operations/${opId}/undo`);

beforeAll(async () => {
  tenantId = await newTenant(db.db);
  const pts: Record<string, [number, number]> = { A: [49.1, 55.8], B: [49.101, 55.8], C: [49.102, 55.8], D: [49.103, 55.8] };
  for (const [k, position] of Object.entries(pts))
    ids[k as "A"] = (await call("POST", "/sites", { kind: k === "A" ? "pop" : "pole", name: k, position })).body.id;
  for (const [a, b] of [["A", "B"], ["B", "C"], ["C", "D"]] as const)
    await call("POST", "/routes", { kind: "aerial", fromSiteId: ids[a], toSiteId: ids[b], coordinates: [pts[a], pts[b]] });
  const models = (await call("GET", "/equipment-models")).body as { id: string; name: string }[];
  const model = (name: string) => models.find((m) => m.name === name)!.id;
  const types = (await call("GET", "/cable-types")).body as { id: string; name: string }[];
  ids.odf = (await call("POST", "/equipment", { siteId: ids.A, modelId: model("Кросс ШКОС 1U, 24 порта"), name: "Кросс" })).body.id;
  ids.box = (await call("POST", "/equipment", { siteId: ids.D, modelId: model("ОРК на 8 абонентов (SC/APC)"), name: "ОРК" })).body.id;
  ids.k1 = (
    await call("POST", "/cables", {
      cableTypeId: types.find((t) => t.name === "ОКСН 1×8")!.id,
      name: "К-1",
      siteIds: [ids.A, ids.B, ids.C, ids.D],
      fromEquipmentId: ids.odf,
      toEquipmentId: ids.box,
      slacks: [{ siteId: ids.C, lengthM: 20 }],
    })
  ).body.id;
  const odf = await splicing(ids.odf);
  await call("POST", "/connections", { equipmentId: ids.odf, aTerminalId: port(odf, "odf", "adapter", 1, "rear"), bTerminalId: fiber(odf, "a", 1) });
  const box = await splicing(ids.box);
  await call("POST", "/connections", { equipmentId: ids.box, aTerminalId: fiber(box, "b", 2), bTerminalId: port(box, "terminal_box", "adapter", 1, "rear") });

  // Муфта в C на транзитном кабеле: волокно 1 → сплиттер → волокно 2 дальше.
  ids.closure = (await call("POST", "/equipment", { siteId: ids.C, modelId: model("Муфта МТОК-Л6 (до 96 сварок)"), name: "М-1" })).body.id;
  await call("POST", "/equipment", { siteId: ids.C, modelId: model("PLC 1:4"), parentId: ids.closure });
  const cable = (await call("GET", `/cables/${ids.k1}`)).body as { spans: { id: string }[] };
  await call("POST", `/equipment/${ids.closure}/cables`, { spanId: cable.spans[0]!.id });
  const s = await splicing(ids.closure);
  for (const n of [1, 2]) {
    const t = s.connections.find((c) => c.kind === "through" && [c.aTerminalId, c.bTerminalId].includes(fiber(s, "b", n)))!;
    await call("DELETE", `/connections/${t.id}`);
  }
  await call("POST", "/connections", { equipmentId: ids.closure, aTerminalId: fiber(s, "b", 1), bTerminalId: port(s, "splitter", "in", 1) });
  await call("POST", "/connections", { equipmentId: ids.closure, aTerminalId: port(s, "splitter", "out", 1), bTerminalId: fiber(s, "a", 2) });
});

describe("отмена операций", () => {
  it("удаление муфты с транзитом и сварками отменяется до последней строки", async () => {
    const before = await snapshot();
    // Снимок содержательный: 2 пролёта по 8 волокон, концы волокон и порты, сварки и транзит.
    expect(before.fibers).toHaveLength(16);
    expect((before.terminals as unknown[]).length).toBeGreaterThan(40);
    expect((before.connections as unknown[]).length).toBe(10);
    const del = await call("DELETE", `/equipment/${ids.closure}?force=true`);
    expect(del.status).toBe(200);
    expect((await call("GET", `/cables/${ids.k1}`)).body.spans).toHaveLength(1);
    expect(await snapshot()).not.toEqual(before);

    const r = await undo(del.body.operationId);
    expect(r.status).toBe(200);
    expect(await snapshot()).toEqual(before);
    // И снова работает как обычно: схема муфты на месте, трассировка идёт через сплиттер.
    expect((await splicing(ids.closure)).connections.filter((c) => c.kind === "fusion")).toHaveLength(2);
  });

  it("очистка разварки и вывод транзитного кабеля отменяются", async () => {
    const before = await snapshot();
    const clear = await call("POST", `/equipment/${ids.closure}/clear-splicing`, { restoreThrough: true });
    expect(clear.body).toMatchObject({ deleted: 2, restored: 2 });
    expect((await undo(clear.body.operationId)).status).toBe(200);
    expect(await snapshot()).toEqual(before);

    const incoming = (await splicing(ids.closure)).cables.find((c) => c.side === "b")!.spanId;
    const leave = await call("DELETE", `/equipment/${ids.closure}/cables/${incoming}?force=true`);
    expect(leave.body).toMatchObject({ merged: true });
    expect((await undo(leave.body.operationId)).status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });

  it("удаление места с кабелями, трассами и оборудованием отменяется", async () => {
    const before = await snapshot();
    const del = await call("DELETE", `/sites/${ids.C}?force=true`);
    expect(del.status).toBe(200);
    expect((await call("GET", `/cables/${ids.k1}`)).status).toBe(404);
    expect((await undo(del.body.operationId)).status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });

  it("корзина: список операций, повторная отмена запрещена", async () => {
    const del = await call("DELETE", `/equipment/${ids.closure}?force=true`);
    const list = (await call("GET", "/operations")).body as Op[];
    expect(list[0]).toMatchObject({ id: del.body.operationId, kind: "remove", title: "Удаление муфты «М-1»", canUndo: true });
    expect((await undo(del.body.operationId)).status).toBe(200);
    expect((await undo(del.body.operationId)).status).toBe(409);
    const after = (await call("GET", "/operations")).body as Op[];
    expect(after[0]).toMatchObject({ kind: "undo", title: "Отмена: Удаление муфты «М-1»", canUndo: false });
    expect(after.find((o) => o.id === del.body.operationId)).toMatchObject({ canUndo: false });
    expect(after.find((o) => o.id === del.body.operationId)!.undoneAt).toBeTruthy();
  });

  it("если после операции связанные объекты менялись — отказ с объяснением, данные не тронуты", async () => {
    const del = await call("DELETE", `/equipment/${ids.closure}?force=true`);
    // Кабель снова завели в новую муфту в том же месте — склеенный пролёт изменился.
    const models = (await call("GET", "/equipment-models")).body as { id: string; name: string }[];
    const m2 = (await call("POST", "/equipment", { siteId: ids.C, modelId: models.find((m) => m.name === "Муфта МТОК-Л6 (до 96 сварок)")!.id, name: "М-2" })).body.id;
    const span = (await call("GET", `/cables/${ids.k1}`)).body.spans[0].id;
    await call("POST", `/equipment/${m2}/cables`, { spanId: span });

    const r = await undo(del.body.operationId);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/изменялись связанные объекты/);
    expect((await call("GET", `/cables/${ids.k1}`)).body.spans).toHaveLength(2);
    expect((await splicing(m2)).connections.filter((c) => c.kind === "through")).toHaveLength(8);
  });
});
