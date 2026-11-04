import { objectStatuses } from "@vols/shared";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { withTenant } from "../db/client.js";
import { cableJournalPdf } from "../services/documents/journal.js";
import { passportPdf } from "../services/documents/passport.js";

const sendPdf = (reply: FastifyReply, { pdf, filename }: { pdf: Buffer; filename: string }) =>
  reply
    .type("application/pdf")
    // ASCII-запасное имя и полное UTF-8 имя по RFC 5987
    .header("content-disposition", `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    .send(pdf);

export const documentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/equipment/:id/passport.pdf", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return sendPdf(reply, await withTenant(app.db, app.requireContext(req), (tx) => passportPdf(tx, id)));
  });

  app.get("/reports/cable-journal.pdf", async (req, reply) => {
    const { status } = z.object({ status: z.enum(objectStatuses).optional() }).parse(req.query);
    return sendPdf(reply, await withTenant(app.db, app.requireContext(req), (tx) => cableJournalPdf(tx, status)));
  });
};
