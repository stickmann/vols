import { flattenFibers, type CableTypeInput } from "@vols/shared";
import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { cableTypeFibers, cableTypeModules, cableTypes } from "../db/schema/index.js";

function structureRows(tenantId: string, cableTypeId: string, input: CableTypeInput) {
  const modules = input.modules.map((m, i) => ({
    tenantId,
    cableTypeId,
    moduleNo: i + 1,
    colorName: m.color.name,
    colorHex: m.color.hex,
    colorMarks: m.color.marks,
    fiberCount: m.fibers.length,
  }));
  const fibers = flattenFibers(input.modules).map((f) => ({
    tenantId,
    cableTypeId,
    number: f.number,
    moduleNo: f.module,
    position: f.position,
    colorName: f.color.name,
    colorHex: f.color.hex,
    colorMarks: f.color.marks,
  }));
  return { modules, fibers };
}

function headerRow(input: CableTypeInput) {
  return {
    name: input.name,
    construction: input.construction,
    fiberStandard: input.fiberStandard ?? null,
    attenuation1310DbKm: input.attenuation1310DbKm,
    attenuation1550DbKm: input.attenuation1550DbKm,
    outerDiameterMm: input.outerDiameterMm ?? null,
    notes: input.notes ?? null,
  };
}

/** Создать тип кабеля с полной конструкцией (вход уже провалидирован cableTypeInputSchema). */
export async function createCableType(tx: Tx, tenantId: string, input: CableTypeInput): Promise<string> {
  const [row] = await tx
    .insert(cableTypes)
    .values({ tenantId, ...headerRow(input) })
    .returning({ id: cableTypes.id });
  const id = row!.id;
  const { modules, fibers } = structureRows(tenantId, id, input);
  await tx.insert(cableTypeModules).values(modules);
  await tx.insert(cableTypeFibers).values(fibers);
  return id;
}

/**
 * Полностью заменить тип кабеля. Если по типу уже есть кабели, БД разрешит
 * только смену цветов при той же конструкции — тогда обновляем цвета на месте.
 */
export async function updateCableType(tx: Tx, tenantId: string, id: string, input: CableTypeInput): Promise<void> {
  await tx.update(cableTypes).set(headerRow(input)).where(eq(cableTypes.id, id));
  const { modules, fibers } = structureRows(tenantId, id, input);

  const current = await tx
    .select({ moduleNo: cableTypeModules.moduleNo, fiberCount: cableTypeModules.fiberCount })
    .from(cableTypeModules)
    .where(eq(cableTypeModules.cableTypeId, id))
    .orderBy(asc(cableTypeModules.moduleNo));
  const sameStructure =
    current.length === modules.length && current.every((m, i) => m.fiberCount === modules[i]!.fiberCount);

  if (sameStructure) {
    for (const m of modules) {
      await tx
        .update(cableTypeModules)
        .set({ colorName: m.colorName, colorHex: m.colorHex, colorMarks: m.colorMarks })
        .where(eqModule(id, m.moduleNo));
    }
    for (const f of fibers) {
      await tx
        .update(cableTypeFibers)
        .set({ colorName: f.colorName, colorHex: f.colorHex, colorMarks: f.colorMarks })
        .where(eqFiber(id, f.number));
    }
    return;
  }

  await tx.delete(cableTypeModules).where(eq(cableTypeModules.cableTypeId, id));
  await tx.insert(cableTypeModules).values(modules);
  await tx.insert(cableTypeFibers).values(fibers);
}

const eqModule = (typeId: string, no: number) =>
  and(eq(cableTypeModules.cableTypeId, typeId), eq(cableTypeModules.moduleNo, no));
const eqFiber = (typeId: string, no: number) =>
  and(eq(cableTypeFibers.cableTypeId, typeId), eq(cableTypeFibers.number, no));

export interface CableTypeView extends CableTypeInput {
  id: string;
  fiberCount: number;
  inUse: boolean;
}

export async function getCableType(tx: Tx, id: string): Promise<CableTypeView | null> {
  const t = await tx.query.cableTypes.findFirst({ where: eq(cableTypes.id, id) });
  if (!t) return null;
  const mods = await tx
    .select()
    .from(cableTypeModules)
    .where(eq(cableTypeModules.cableTypeId, id))
    .orderBy(asc(cableTypeModules.moduleNo));
  const fibs = await tx
    .select()
    .from(cableTypeFibers)
    .where(eq(cableTypeFibers.cableTypeId, id))
    .orderBy(asc(cableTypeFibers.number));
  const inUse = (await tx.query.cables.findFirst({ where: (c, { eq }) => eq(c.cableTypeId, id), columns: { id: true } })) != null;

  return {
    id: t.id,
    name: t.name,
    construction: t.construction,
    fiberStandard: t.fiberStandard,
    attenuation1310DbKm: t.attenuation1310DbKm,
    attenuation1550DbKm: t.attenuation1550DbKm,
    outerDiameterMm: t.outerDiameterMm,
    notes: t.notes,
    fiberCount: fibs.length,
    inUse,
    modules: mods.map((m) => ({
      color: { name: m.colorName, hex: m.colorHex, marks: m.colorMarks },
      fibers: fibs
        .filter((f) => f.moduleNo === m.moduleNo)
        .map((f) => ({ name: f.colorName, hex: f.colorHex, marks: f.colorMarks })),
    })),
  };
}
