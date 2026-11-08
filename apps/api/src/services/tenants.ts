import { randomUUID } from "node:crypto";
import {
  CABLE_TYPE_PRESETS,
  COLOR_SCHEME_PRESETS,
  EQUIPMENT_MODEL_PRESETS,
  presetModules,
} from "@vols/shared";
import { withTenant, type Db } from "../db/client.js";
import { colorSchemes, equipmentModels, tenants } from "../db/schema/index.js";
import { createCableType } from "./cable-types.js";

/**
 * Регистрация нового оператора: строка в tenants и стартовые справочники.
 * Работает под ролью приложения: id генерируется заранее, чтобы RLS
 * пропустил вставку в tenants.
 */
export async function provisionTenant(db: Db, input: { name: string; slug: string; id?: string; plan?: "free" | "unlimited" }): Promise<string> {
  const tenantId = input.id ?? randomUUID();
  await withTenant(db, { tenantId }, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: input.name, slug: input.slug, plan: input.plan ?? "free" });

    await tx.insert(colorSchemes).values(
      COLOR_SCHEME_PRESETS.map((s) => ({ tenantId, name: s.name, colors: s.colors })),
    );

    for (const p of CABLE_TYPE_PRESETS) {
      await createCableType(tx, tenantId, {
        name: p.name,
        construction: p.construction,
        fiberStandard: p.fiberStandard,
        attenuation1310DbKm: 0.35,
        attenuation1550DbKm: 0.22,
        modules: presetModules(p),
      });
    }

    await tx.insert(equipmentModels).values(
      EQUIPMENT_MODEL_PRESETS.map((m) => ({
        tenantId,
        kind: m.kind,
        name: m.name,
        portCount: m.portCount ?? null,
        maxSplices: m.maxSplices ?? null,
        cableEntries: m.cableEntries ?? null,
        splitterInputs: m.splitterInputs ?? null,
        splitterOutputs: m.splitterOutputs ?? null,
        insertionLossDb: m.insertionLossDb ?? null,
      })),
    );
  });
  return tenantId;
}
