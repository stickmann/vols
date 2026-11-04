import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { cableJournalRows } from "../src/services/documents/journal.js";
import { createDemoNetwork } from "../src/services/demo-network.js";
import { appDb, newTenant, withTenant } from "./helpers.js";

const db = appDb();
const api = buildApp({ db: db.db, devTenantHeader: true });
let tenantId: string;
let net: Awaited<ReturnType<typeof createDemoNetwork>>;

beforeAll(async () => {
  tenantId = await newTenant(db.db);
  net = await withTenant(db.db, { tenantId }, (tx) => createDemoNetwork(tx, tenantId));
});
afterAll(async () => {
  await api.close();
  await db.close();
});

const get = (url: string) => api.inject({ method: "GET", url: `/api/v1${url}`, headers: { "x-tenant-id": tenantId } });

describe("документы", () => {
  it("паспорт муфты — PDF с русским именем файла", async () => {
    const r = await get(`/equipment/${net.equipment.closure}/passport.pdf`);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(r.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect(r.rawPayload.length).toBeGreaterThan(10_000);
    expect(decodeURIComponent(String(r.headers["content-disposition"]).split("UTF-8''")[1]!)).toBe("Паспорт Муфта М-1 — Оп. 2.pdf");
  });

  it("паспорт ящика и кросса строится, для сплиттера — понятный отказ", async () => {
    expect((await get(`/equipment/${net.equipment.box}/passport.pdf`)).statusCode).toBe(200);
    expect((await get(`/equipment/${net.equipment.odf}/passport.pdf`)).statusCode).toBe(200);
    expect((await get(`/equipment/${net.equipment.splitter}/passport.pdf`)).statusCode).toBe(422);
  });

  it("кабельный журнал: концы, длины с запасом и занятость волокон", async () => {
    const rows = await withTenant(db.db, { tenantId }, (tx) => cableJournalRows(tx));
    const trunk = rows.find((r) => r.name === "Магистраль УС1–М1")!;
    const dist = rows.find((r) => r.name === "Распределение М1–ОРК1")!;
    expect(trunk).toMatchObject({ fiberCount: 32, usedFibers: 1, fromSite: "Узел связи №1", fromEq: "Кросс 1", toSite: "Оп. 2", toEq: "Муфта М-1", slackM: 15 });
    expect(trunk.totalM).toBeCloseTo(trunk.routeM + 15, 5);
    expect(dist).toMatchObject({ fiberCount: 8, usedFibers: 8, toEq: "ОРК-1" });

    const r = await get("/reports/cable-journal.pdf?status=built");
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await get("/reports/cable-journal.pdf?status=wrong")).statusCode).toBe(400);
  });
});
