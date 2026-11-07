import { objectStatuses } from "@vols/shared";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { withTenant } from "../db/client.js";

// Генератор PDF со шрифтами занимает ~30 МБ памяти, а документы нужны редко:
// загружаем его при первом запросе документа, а не при старте.
const passport = () => import("../services/documents/passport.js");
const journal = () => import("../services/documents/journal.js");

const sendPdf = (reply: FastifyReply, { pdf, filename }: { pdf: Buffer; filename: string }) =>
  reply
    .type("application/pdf")
    // ASCII-запасное имя и полное UTF-8 имя по RFC 5987
    .header("content-disposition", `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    .send(pdf);

export const documentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/equipment/:id/passport.pdf", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { passportPdf } = await passport();
    return sendPdf(reply, await withTenant(app.db, app.requireContext(req), (tx) => passportPdf(tx, id)));
  });

  app.get("/reports/cable-journal.pdf", async (req, reply) => {
    const { status } = z.object({ status: z.enum(objectStatuses).optional() }).parse(req.query);
    const { cableJournalPdf } = await journal();
    return sendPdf(reply, await withTenant(app.db, app.requireContext(req), (tx) => cableJournalPdf(tx, status)));
  });
};
