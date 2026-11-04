import { connectionBatchSchema, connectionInputSchema, connectionPatchSchema, enterCableSchema } from "@vols/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { withTenant, type Tx } from "../db/client.js";
import * as sp from "../services/splicing.js";

const idParams = z.object({ id: z.uuid() });

export const splicingRoutes: FastifyPluginAsync = async (app) => {
  const run = <T>(req: FastifyRequest, fn: (tx: Tx, tenantId: string) => Promise<T>) => {
    const ctx = app.requireContext(req);
    return withTenant(app.db, ctx, (tx) => fn(tx, ctx.tenantId));
  };
  const id = (req: FastifyRequest) => idParams.parse(req.params).id;

  app.get("/equipment/:id/splicing", (req) => run(req, (tx) => sp.getSplicing(tx, id(req))));

  app.post("/equipment/:id/cables", async (req, reply) => {
    const { spanId } = enterCableSchema.parse(req.body);
    const r = await run(req, (tx, t) => sp.enterCable(tx, t, id(req), spanId));
    return reply.code(201).send(r);
  });
  app.delete("/equipment/:id/cables/:spanId", async (req, reply) => {
    const { spanId } = z.object({ spanId: z.uuid() }).parse(req.params);
    await run(req, (tx) => sp.leaveCable(tx, id(req), spanId));
    return reply.code(204).send();
  });

  app.post("/connections", async (req, reply) => {
    const v = connectionInputSchema.parse(req.body);
    const connId = await run(req, (tx, t) => sp.createConnection(tx, t, v));
    return reply.code(201).send({ id: connId });
  });
  app.post("/connections/batch", async (req, reply) => {
    const v = connectionBatchSchema.parse(req.body);
    const ids = await run(req, (tx, t) => sp.createConnections(tx, t, v));
    return reply.code(201).send({ ids });
  });
  app.patch("/connections/:id", async (req, reply) => {
    const v = connectionPatchSchema.parse(req.body);
    await run(req, (tx) => sp.updateConnection(tx, id(req), v));
    return reply.code(204).send();
  });
  app.delete("/connections/:id", async (req, reply) => {
    await run(req, (tx) => sp.deleteConnection(tx, id(req)));
    return reply.code(204).send();
  });
};
