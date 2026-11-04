import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { withTenant } from "../db/client.js";
import { locate, trace } from "../services/trace.js";

const traceSchema = z.object({ terminalId: z.uuid() });
const locateSchema = z.object({ terminalId: z.uuid(), leafTerminalId: z.uuid(), distanceM: z.number().min(0).max(200000) });

export const traceRoutes: FastifyPluginAsync = async (app) => {
  app.post("/trace", (req) => {
    const { terminalId } = traceSchema.parse(req.body);
    return withTenant(app.db, app.requireContext(req), (tx) => trace(tx, terminalId));
  });
  app.post("/trace/locate", (req) => {
    const v = locateSchema.parse(req.body);
    return withTenant(app.db, app.requireContext(req), (tx) => locate(tx, v.terminalId, v.leafTerminalId, v.distanceM));
  });
};
