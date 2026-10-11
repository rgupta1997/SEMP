import { Router } from 'express';
import { createDemoRequestSchema, updateDemoRequestSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { NotFoundError } from '../../shared/errors.js';
import { sendDemoRequestAckEmail, type DemoRequestMail } from '../comms/email.js';

/**
 * How long one email address stays acknowledged for.
 *
 * The POST is public and unauthenticated, so the address the acknowledgement goes to
 * is chosen by an anonymous caller - which, left alone, makes this endpoint a way to
 * send Sportagon-branded mail to any address, as often as you like, by submitting the
 * form with somebody else's email in it.
 *
 * The guard holds back only that mail. The row is still written, and so still shows up
 * on /platform/demo-requests, because a real enquiry must never be dropped on
 * suspicion - and a second enquiry from the same person inside a day is answered by
 * the same human anyway, so the second acknowledgement would say nothing the first
 * one did not.
 */
const ACK_WINDOW_MS = 24 * 60 * 60 * 1000;

async function acknowledge(prisma: Prisma, lead: DemoRequestMail): Promise<void> {
  const alreadyMailed = await prisma.demo_requests.count({
    where: {
      // The lead's own row is already written by this point, so it has to be excluded
      // or every acknowledgement would count itself and none would ever be sent.
      id: { not: lead.id },
      // Case-insensitively: the form takes whatever was typed, so the same mailbox
      // reaches us as both Priya@ and priya@ and a case-sensitive match would let the
      // second one straight through the guard.
      email: { equals: lead.email, mode: 'insensitive' },
      created_at: { gte: new Date(Date.now() - ACK_WINDOW_MS) },
    },
  });
  if (alreadyMailed > 0) return;

  await sendDemoRequestAckEmail(lead, env.WEB_APP_URL);
}

// "Book a demo" leads from the public landing page.
//
// This router is mounted BEFORE the global requireAuth gate, so the create route
// is reachable by anonymous visitors. Read/triage/delete are restricted to
// platform super-admins via requireSuperAdmin (which itself rejects anonymous and
// non-admin callers), so no other authenticated user can see captured leads.
export function makeDemoRequestsRouter(prisma: Prisma): Router {
  const router = Router();

  // Public: capture a lead. The RESPONSE is a bare ok - it never echoes stored data
  // back to the anonymous caller. (The acknowledgement mail below is a different
  // thing entirely, and goes to the address rather than to the caller.)
  router.post('/', validateBody(createDemoRequestSchema), asyncHandler(async (req, res) => {
    const lead = await prisma.demo_requests.create({ data: req.body });

    // The row is the record - we read it at /platform/demo-requests - and this mail is
    // only the visitor's half of it. It runs AFTER the write and is not allowed to
    // fail the request: the lead is already captured, so throwing here would answer a
    // stored lead with an error, and the visitor, correctly reading that as "it did
    // not go through", would submit again. A mail outage would cost us duplicate rows
    // and a visitor who believes we never heard from them.
    //
    // Logged rather than swallowed silently: with no outbox (see mail-client.ts) this
    // line is the only trace that someone was told nothing.
    try {
      await acknowledge(prisma, lead);
    } catch (err) {
      console.error(`[demo-request] acknowledgement email failed for ${lead.id}:`, err);
    }

    res.status(201).json({ ok: true });
  }));

  // Admin: newest-first list of all leads, with the triaging admin's name.
  router.get('/', requireSuperAdmin, asyncHandler(async (_req, res) => {
    const rows = await prisma.demo_requests.findMany({
      orderBy: { created_at: 'desc' },
      include: { users: { select: { id: true, name: true } } },
    });
    res.json(rows);
  }));

  // Admin: move a lead through its lifecycle / annotate it. Records who triaged it.
  router.patch('/:id', requireSuperAdmin, validateBody(updateDemoRequestSchema), asyncHandler(async (req, res) => {
    const existing = await prisma.demo_requests.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Demo request');
    const updated = await prisma.demo_requests.update({
      where: { id: req.params.id },
      data: { ...req.body, handled_by: req.user!.id, updated_at: new Date() },
      include: { users: { select: { id: true, name: true } } },
    });
    res.json(updated);
  }));

  // Admin: drop a lead.
  router.delete('/:id', requireSuperAdmin, asyncHandler(async (req, res) => {
    const existing = await prisma.demo_requests.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Demo request');
    await prisma.demo_requests.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }));

  return router;
}
