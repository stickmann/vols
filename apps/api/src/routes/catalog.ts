import { cableTypeInputSchema } from "@vols/shared";
import { asc, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { withTenant } from "../db/client.js";
import { cableTypeFibers, cableTypeModules, cableTypes, cables, colorSchemes, equipmentModels } from "../db/schema/index.js";
import { createCableType, getCableType, updateCableType } from "../services/cable-types.js";
import { HttpError } from "../errors.js";

const idParams = z.object({ id: z.uuid() });

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  app.get("/color-schemes", async (req) =>
    withTenant(app.db, app.requireContext(req), (tx) => tx.select().from(colorSchemes).orderBy(asc(colorSchemes.name))),
  );

  app.get("/equipment-models", async (req) =>
    withTenant(app.db, app.requireContext(req), (tx) =>
      tx.select().from(equipmentModels).orderBy(asc(equipmentModels.kind), asc(equipmentModels.name)),
    ),
  );

  app.get("/cable-types", async (req) =>
    withTenant(app.db, app.requireContext(req), (tx) =>
      tx
        .select({
          id: cableTypes.id,
          name: cableTypes.name,
          construction: cableTypes.construction,
          fiberStandard: cableTypes.fiberStandard,
          outerDiameterMm: cableTypes.outerDiameterMm,
          fiberCount: sql<number>`(SELECT count(*)::int FROM ${cableTypeFibers} f WHERE f.cable_type_id = "cable_types"."id")`,
          /** Модули для превью: цвет и число волокон по порядку. */
          modules: sql<{ name: string; hex: string; marks: number; fiberCount: number }[]>`(
            SELECT coalesce(jsonb_agg(jsonb_build_object(
              'name', m.color_name, 'hex', m.color_hex, 'marks', m.color_marks, 'fiberCount', m.fiber_count
            ) ORDER BY m.module_no), '[]'::jsonb)
            FROM ${cableTypeModules} m WHERE m.cable_type_id = "cable_types"."id")`,
          inUse: sql<boolean>`EXISTS (SELECT 1 FROM ${cables} c WHERE c.cable_type_id = "cable_types"."id")`,
          updatedAt: cableTypes.updatedAt,
        })
        .from(cableTypes)
        .orderBy(asc(cableTypes.name)),
    ),
  );

  app.get("/cable-types/:id", async (req) => {
    const { id } = idParams.parse(req.params);
    const t = await withTenant(app.db, app.requireContext(req), (tx) => getCableType(tx, id));
    if (!t) throw new HttpError(404, "Тип кабеля не найден");
    return t;
  });

  app.post("/cable-types", async (req, reply) => {
    const input = cableTypeInputSchema.parse(req.body);
    const ctx = app.requireContext(req);
    const t = await withTenant(app.db, ctx, async (tx) => getCableType(tx, await createCableType(tx, ctx.tenantId, input)));
    return reply.code(201).send(t);
  });

  app.put("/cable-types/:id", async (req) => {
    const { id } = idParams.parse(req.params);
    const input = cableTypeInputSchema.parse(req.body);
    const ctx = app.requireContext(req);
    return withTenant(app.db, ctx, async (tx) => {
      const exists = await tx.select({ id: cableTypes.id }).from(cableTypes).where(eq(cableTypes.id, id));
      if (exists.length === 0) throw new HttpError(404, "Тип кабеля не найден");
      await updateCableType(tx, ctx.tenantId, id, input);
      return getCableType(tx, id);
    });
  });

  app.delete("/cable-types/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const deleted = await withTenant(app.db, app.requireContext(req), (tx) =>
      tx.delete(cableTypes).where(eq(cableTypes.id, id)).returning({ id: cableTypes.id }),
    );
    if (deleted.length === 0) throw new HttpError(404, "Тип кабеля не найден");
    return reply.code(204).send();
  });
};
