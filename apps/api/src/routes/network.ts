import {
  cableInputSchema,
  cablePatchSchema,
  equipmentInputSchema,
  equipmentPatchSchema,
  pathRequestSchema,
  routeInputSchema,
  routePatchSchema,
  siteInputSchema,
  sitePatchSchema,
} from "@vols/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { withTenant, type Tx } from "../db/client.js";
import { HttpError } from "../errors.js";
import * as net from "../services/network.js";
import * as rm from "../services/removal.js";

const idParams = z.object({ id: z.uuid() });
/** force=true — удалить вместе со всем зависимым (после подтверждения в интерфейсе). */
const forceQuery = z.object({ force: z.enum(["true", "false"]).optional() });

export const networkRoutes: FastifyPluginAsync = async (app) => {
  const run = <T>(req: FastifyRequest, fn: (tx: Tx, tenantId: string) => Promise<T>) => {
    const ctx = app.requireContext(req);
    return withTenant(app.db, ctx, (tx) => fn(tx, ctx.tenantId));
  };
  const id = (req: FastifyRequest) => idParams.parse(req.params).id;
  const force = (req: FastifyRequest) => forceQuery.parse(req.query).force === "true";

  // Что будет удалено вместе с объектом — для окна подтверждения.
  app.get("/sites/:id/impact", (req) => run(req, (tx) => rm.siteImpact(tx, id(req))));
  app.get("/routes/:id/impact", (req) => run(req, (tx) => rm.routeImpact(tx, id(req))));
  app.get("/cables/:id/impact", (req) => run(req, (tx) => rm.cableImpact(tx, id(req))));
  app.get("/equipment/:id/impact", (req) => run(req, (tx) => rm.equipmentImpact(tx, id(req))));

  app.get("/network", (req) => run(req, (tx) => net.loadNetwork(tx)));

  app.post("/routing/path", (req) =>
    run(req, async (tx) => {
      const { fromSiteId, toSiteId } = pathRequestSchema.parse(req.body);
      const path = await net.shortestPath(tx, fromSiteId, toSiteId);
      if (!path) throw new HttpError(422, "Между этими местами нет пути по трассам");
      return path;
    }),
  );

  // места
  app.get("/sites/:id", (req) => run(req, (tx) => net.getSite(tx, id(req))));
  app.post("/sites", async (req, reply) => {
    const v = siteInputSchema.parse(req.body);
    const siteId = await run(req, (tx, t) => net.createSite(tx, t, v));
    return reply.code(201).send({ id: siteId });
  });
  app.patch("/sites/:id", async (req, reply) => {
    const v = sitePatchSchema.parse(req.body);
    await run(req, (tx) => net.updateSite(tx, id(req), v));
    return reply.code(204).send();
  });
  app.delete("/sites/:id", async (req, reply) => {
    await run(req, (tx) => (force(req) ? rm.removeSite(tx, id(req)) : net.deleteSite(tx, id(req))));
    return reply.code(204).send();
  });

  // трассы
  app.get("/routes/:id", (req) => run(req, (tx) => net.getRoute(tx, id(req))));
  app.post("/routes", async (req, reply) => {
    const v = routeInputSchema.parse(req.body);
    const routeId = await run(req, (tx, t) => net.createRoute(tx, t, v));
    return reply.code(201).send({ id: routeId });
  });
  app.patch("/routes/:id", async (req, reply) => {
    const v = routePatchSchema.parse(req.body);
    await run(req, (tx) => net.updateRoute(tx, id(req), v));
    return reply.code(204).send();
  });
  app.delete("/routes/:id", async (req, reply) => {
    await run(req, (tx) => (force(req) ? rm.removeRoute(tx, id(req)) : net.deleteRoute(tx, id(req))));
    return reply.code(204).send();
  });

  // оборудование
  app.get("/equipment", (req) =>
    run(req, (tx) => {
      const { kinds } = z.object({ kinds: z.string().optional() }).parse(req.query);
      return net.listEquipment(tx, kinds?.split(",").filter(Boolean));
    }),
  );
  app.post("/equipment", async (req, reply) => {
    const v = equipmentInputSchema.parse(req.body);
    const eqId = await run(req, (tx, t) => net.createEquipment(tx, t, v));
    return reply.code(201).send({ id: eqId });
  });
  app.patch("/equipment/:id", async (req, reply) => {
    const v = equipmentPatchSchema.parse(req.body);
    await run(req, (tx) => net.updateEquipment(tx, id(req), v));
    return reply.code(204).send();
  });
  app.delete("/equipment/:id", async (req, reply) => {
    await run(req, (tx) => (force(req) ? rm.removeEquipment(tx, id(req)) : net.deleteEquipment(tx, id(req))));
    return reply.code(204).send();
  });

  // кабели
  app.get("/cables/:id", (req) => run(req, (tx) => net.getCable(tx, id(req))));
  app.post("/cables", async (req, reply) => {
    const v = cableInputSchema.parse(req.body);
    const cableId = await run(req, (tx, t) => net.createCable(tx, t, v));
    return reply.code(201).send({ id: cableId });
  });
  app.patch("/cables/:id", async (req, reply) => {
    const v = cablePatchSchema.parse(req.body);
    await run(req, (tx) => net.updateCable(tx, id(req), v));
    return reply.code(204).send();
  });
  app.delete("/cables/:id", async (req, reply) => {
    await run(req, (tx) => (force(req) ? rm.removeCable(tx, id(req)) : net.deleteCable(tx, id(req))));
    return reply.code(204).send();
  });
};
