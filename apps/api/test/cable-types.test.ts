import { CABLE_TYPE_PRESETS, presetModules, type CableTypeInput } from "@vols/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { cableTypeFibers, cableTypeModules, cables, fibers } from "../src/db/schema/index.js";
import { createCableType, getCableType, updateCableType } from "../src/services/cable-types.js";
import { appDb, builder, newTenant, withTenant } from "./helpers.js";
import { expectPgError } from "./pg-error.js";

const app = appDb();
let tenantId: string;

const c = (name: string, hex: string, marks = 0) => ({ name, hex, marks });
const red = c("Красный", "#e02b2b");
const green = c("Зелёный", "#17a81a");
const blue = c("Синий", "#1f6fd0");
const natural = c("Натуральный", "#e8e0c8");

/** Нестандартный кабель: модули разного размера и кордель-заполнитель. */
const custom: CableTypeInput = {
  name: "Свой кабель 2+0+3",
  construction: "aerial",
  attenuation1310DbKm: 0.36,
  attenuation1550DbKm: 0.22,
  modules: [
    { color: red, fibers: [blue, green] },
    { color: natural, fibers: [] },
    { color: green, fibers: [red, c("Красный", "#e02b2b", 1), blue] },
  ],
};

beforeAll(async () => {
  tenantId = await newTenant(app.db);
});
afterAll(() => app.close());

const tx = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(app.db, { tenantId }, fn);

describe("справочник кабелей", () => {
  it("хранит конструкцию: каждый модуль со своим цветом и числом волокон, у каждого волокна свой цвет", async () => {
    const view = await tx(async (t) => getCableType(t, await createCableType(t, tenantId, custom)));
    expect(view!.fiberCount).toBe(5);
    expect(view!.modules.map((m) => [m.color.name, m.fibers.length])).toEqual([
      ["Красный", 2],
      ["Натуральный", 0],
      ["Зелёный", 3],
    ]);
    expect(view!.modules[2]!.fibers[1]).toEqual({ name: "Красный", hex: "#e02b2b", marks: 1 });
  });

  it("волокна пролёта создаются по конструкции типа", async () => {
    const rows = await tx(async (t) => {
      const typeId = await createCableType(t, tenantId, { ...custom, name: "Свой кабель для пролёта" });
      const b = builder(t, tenantId);
      const [cab] = await t.insert(cables).values({ tenantId, cableTypeId: typeId }).returning();
      const spanId = await b.span({ cableId: cab!.id, from: await b.site([49, 55]), to: await b.site([49.001, 55]) });
      return t.select().from(fibers).where(eq(fibers.spanId, spanId)).orderBy(fibers.number);
    });
    expect(rows.map((f) => [f.number, f.moduleNo, f.position])).toEqual([
      [1, 1, 1],
      [2, 1, 2],
      [3, 3, 1],
      [4, 3, 2],
      [5, 3, 3],
    ]);
  });

  it("БД не примет рассогласованную конструкцию (проверка в конце транзакции)", async () => {
    await expectPgError(
      tx(async (t) => {
        const id = await createCableType(t, tenantId, { ...custom, name: "Битый" });
        await t.delete(cableTypeFibers).where(sql`${cableTypeFibers.cableTypeId} = ${id} AND ${cableTypeFibers.number} = 5`);
      }),
      "23514",
      /модуль 3/,
    );
  });

  it("у используемого типа можно менять цвета, но не конструкцию", async () => {
    const typeId = await tx(async (t) => {
      const id = await createCableType(t, tenantId, { ...custom, name: "Используемый" });
      await t.insert(cables).values({ tenantId, cableTypeId: id });
      return id;
    });

    const recolored = structuredClone(custom);
    recolored.name = "Используемый";
    recolored.modules[0]!.color = c("Жёлтый", "#f2d024");
    await tx((t) => updateCableType(t, tenantId, typeId, recolored));
    const view = await tx((t) => getCableType(t, typeId));
    expect(view!.modules[0]!.color.name).toBe("Жёлтый");
    expect(view!.inUse).toBe(true);

    const restructured = structuredClone(recolored);
    restructured.modules[0]!.fibers.push(red);
    await expectPgError(tx((t) => updateCableType(t, tenantId, typeId, restructured)), "23503", /используется/);
  });

  it("неиспользуемый тип можно перестроить полностью", async () => {
    const typeId = await tx((t) => createCableType(t, tenantId, { ...custom, name: "Перестраиваемый" }));
    const preset = CABLE_TYPE_PRESETS.find((p) => p.modulesCount === 4 && p.fibersPerModule === 8)!;
    await tx((t) =>
      updateCableType(t, tenantId, typeId, { ...custom, name: "Перестраиваемый", modules: presetModules(preset) }),
    );
    const mods = await tx((t) => t.select().from(cableTypeModules).where(eq(cableTypeModules.cableTypeId, typeId)));
    expect(mods).toHaveLength(4);
  });
});

describe("API справочника кабелей", () => {
  const api = buildApp({ db: app.db, devTenantHeader: true });
  afterAll(() => api.close());
  const headers = () => ({ "x-tenant-id": tenantId });

  it("создаёт, читает, обновляет и удаляет тип кабеля", async () => {
    const created = await api.inject({ method: "POST", url: "/api/v1/cable-types", headers: headers(), payload: { ...custom, name: "API кабель" } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const list = await api.inject({ method: "GET", url: "/api/v1/cable-types", headers: headers() });
    const item = list.json().find((t: { id: string }) => t.id === id);
    expect(item).toMatchObject({ fiberCount: 5, inUse: false });
    expect(item.modules.map((m: { fiberCount: number }) => m.fiberCount)).toEqual([2, 0, 3]);

    const updated = await api.inject({
      method: "PUT",
      url: `/api/v1/cable-types/${id}`,
      headers: headers(),
      payload: { ...custom, name: "API кабель", modules: [{ color: blue, fibers: [blue, red, green, natural] }] },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().fiberCount).toBe(4);

    const del = await api.inject({ method: "DELETE", url: `/api/v1/cable-types/${id}`, headers: headers() });
    expect(del.statusCode).toBe(204);
    const gone = await api.inject({ method: "GET", url: `/api/v1/cable-types/${id}`, headers: headers() });
    expect(gone.statusCode).toBe(404);
  });

  it("отклоняет некорректную конструкцию и запросы без оператора", async () => {
    const bad = await api.inject({
      method: "POST",
      url: "/api/v1/cable-types",
      headers: headers(),
      payload: { name: "Пустой", construction: "aerial", modules: [{ color: red, fibers: [] }] },
    });
    expect(bad.statusCode).toBe(400);
    const anon = await api.inject({ method: "GET", url: "/api/v1/cable-types" });
    expect(anon.statusCode).toBe(401);
  });

  it("дубликат имени — 409", async () => {
    const payload = { ...custom, name: "Дубль" };
    expect((await api.inject({ method: "POST", url: "/api/v1/cable-types", headers: headers(), payload })).statusCode).toBe(201);
    expect((await api.inject({ method: "POST", url: "/api/v1/cable-types", headers: headers(), payload })).statusCode).toBe(409);
  });
});
