import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { withTenant, type Tx } from "../db/client.js";
import * as auth from "../services/auth/auth.js";
import { ROLES } from "../services/auth/roles.js";
import { deliver, inviteMail, resetMail } from "../services/mail.js";

const role = z.enum(ROLES);

/** Участники оператора, приглашения и настройки. Право — администратор (см. roles.ts). */
export const userRoutes: FastifyPluginAsync = async (app) => {
  const run = <T>(req: FastifyRequest, fn: (tx: Tx) => Promise<T>) => withTenant(app.db, app.requireContext(req), fn);
  const userId = (req: FastifyRequest) => z.object({ userId: z.uuid() }).parse(req.params).userId;

  app.get("/users", async (req) => {
    const ctx = app.requireContext(req);
    return {
      members: await run(req, (tx) => auth.listMembers(tx)),
      invites: await auth.listInvites(app.db, ctx.tenantId),
    };
  });

  app.post("/invites", async (req, reply) => {
    const ctx = app.requireContext(req);
    const v = z.object({ email: z.email().max(200), role }).parse(req.body);
    const r = await auth.createInvite(app.db, ctx.tenantId, ctx.userId ?? null, ctx.role, v.email, v.role, {
      requireVerified: app.mailer.enabled,
    });
    const me = ctx.userId ? await auth.me(app.db, { sessionId: "", userId: ctx.userId, tenantId: ctx.tenantId, pending2fa: false }) : null;
    const sent = await deliver(
      app.mailer,
      inviteMail({
        to: v.email,
        tenantName: me?.tenant?.name ?? "",
        inviterName: me?.user.name ?? null,
        role: v.role,
        url: `${app.mailer.publicUrl}/invite/${r.token}`,
        days: r.expiresInDays,
      }),
      app.log,
    );
    return reply.code(201).send({ ...r, ...sent });
  });

  app.delete("/invites/:id", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    await auth.revokeInvite(app.db, app.requireContext(req).tenantId, id);
    return reply.code(204).send();
  });

  app.patch("/members/:userId", async (req) => {
    const v = z.object({ role }).parse(req.body);
    const ctx = app.requireContext(req);
    await run(req, (tx) => auth.setMemberRole(tx, ctx.role, userId(req), v.role));
    return { ok: true };
  });

  app.delete("/members/:userId", async (req, reply) => {
    const ctx = app.requireContext(req);
    await run(req, (tx) => auth.removeMember(tx, ctx.role, userId(req)));
    return reply.code(204).send();
  });

  app.post("/members/:userId/reset-link", async (req) => {
    const ctx = app.requireContext(req);
    const r = await auth.createResetLink(app.db, ctx.tenantId, ctx.userId ?? null, userId(req));
    const sent = await deliver(
      app.mailer,
      resetMail({ to: r.email, name: r.name, url: `${app.mailer.publicUrl}/reset/${r.token}`, hours: r.expiresInHours, byAdmin: true }),
      app.log,
    );
    return { token: r.token, expiresInHours: r.expiresInHours, ...sent };
  });

  app.patch("/tenant", async (req) => {
    const v = z.object({ name: z.string().trim().min(1).max(200).optional(), require2fa: z.boolean().optional() }).parse(req.body);
    await run(req, (tx) => auth.updateTenant(tx, v));
    return { ok: true };
  });
};
