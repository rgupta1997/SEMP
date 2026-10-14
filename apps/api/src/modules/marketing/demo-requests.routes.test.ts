import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';

// The POST captures the lead and sends the visitor one acknowledgement. We find out
// about leads by reading the table at /platform/demo-requests, so there is no second
// mail to us - which makes this one the only thing the visitor ever sees.
//
// What is pinned here is mostly what must NOT happen: the mail may not fail the
// request (the row is already written, and a 500 makes the visitor submit again), and
// it must not become a way to mail a stranger repeatedly.
const envStub = { NODE_ENV: 'test', WEB_APP_URL: 'https://events.sportagon.in' };
vi.mock('../../config/env.js', () => ({ env: envStub, isProduction: false }));

interface SentAck { to: string; leadId: string; appUrl: string }
const acks: SentAck[] = [];
let ackThrows = false;

vi.mock('../comms/email.js', () => ({
  sendDemoRequestAckEmail: async (lead: { id: string; email: string }, appUrl: string) => {
    if (ackThrows) throw new Error('mail down');
    acks.push({ to: lead.email, leadId: lead.id, appUrl });
  },
}));

// What the guard sees: how many OTHER rows share this lead's address inside the window.
let priorWithSameEmail = 0;
const countArgs: unknown[] = [];
let created: Record<string, unknown> | null = null;

const prisma = {
  demo_requests: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      created = data;
      return { id: 'lead-1', created_at: new Date(), status: 'new', ...data };
    },
    count: async (args: unknown) => { countArgs.push(args); return priorWithSameEmail; },
  },
};

const express = (await import('express')).default;
const { makeDemoRequestsRouter } = await import('./demo-requests.routes.js');

const app = express();
app.use(express.json());
app.use('/demo-requests', makeDemoRequestsRouter(prisma as never));
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
afterAll(() => { server.close(); });

function submit(overrides: Record<string, unknown> = {}) {
  return fetch(`http://127.0.0.1:${port}/demo-requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Priya Sharma',
      email: 'priya@example.com',
      phone: '+919876543210',
      organization: 'Northfield School',
      role: 'School',
      city: 'Pune',
      contact_consent: true,
      ...overrides,
    }),
  });
}

describe('POST /demo-requests', () => {
  beforeEach(() => {
    acks.length = 0;
    countArgs.length = 0;
    ackThrows = false;
    priorWithSameEmail = 0;
    created = null;
  });

  it('stores the lead and acknowledges it to the visitor', async () => {
    const res = await submit();

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(created).toMatchObject({ name: 'Priya Sharma', email: 'priya@example.com' });
    expect(acks).toEqual([
      { to: 'priya@example.com', leadId: 'lead-1', appUrl: 'https://events.sportagon.in' },
    ]);
  });

  // The endpoint is public, so the form's checkbox alone proves nothing: a request
  // without the tick is refused and nothing is written.
  it('refuses a request without contact consent', async () => {
    for (const contact_consent of [undefined, false, 'yes']) {
      created = null;
      const res = await submit({ contact_consent });
      expect(res.ok, String(contact_consent)).toBe(false);
      expect(created).toBeNull();
    }
    expect(acks).toHaveLength(0);
  });

  it('checks contact consent but does not try to store it', async () => {
    await submit();
    expect(created).not.toHaveProperty('contact_consent');
  });

  // The whole point of catching: the row exists, so an error here would be a lie that
  // costs us a duplicate submission and a visitor who believes nobody heard them.
  it('still answers 201 when the mail service is down', async () => {
    ackThrows = true;

    const res = await submit();

    expect(res.status).toBe(201);
    expect(created).not.toBeNull();
    expect(acks).toHaveLength(0);
  });

  // Anybody can type anybody's address into a public form, so a repeat inside the
  // window gets no second mail - but it is still recorded, and still triageable.
  it('withholds a repeat acknowledgement without dropping the lead', async () => {
    priorWithSameEmail = 1;

    const res = await submit();

    expect(res.status).toBe(201);
    expect(created).not.toBeNull();
    expect(acks).toHaveLength(0);
  });

  // The guard counts OTHER rows, matched case-insensitively. Both halves have a
  // failure mode that silently disables it: counting its own row suppresses every
  // acknowledgement, and a case-sensitive match lets Priya@ through after priya@.
  it('excludes the new row and ignores case when looking for a repeat', async () => {
    await submit({ email: 'Priya@Example.com' });

    expect(countArgs).toHaveLength(1);
    expect(countArgs[0]).toMatchObject({
      where: {
        id: { not: 'lead-1' },
        email: { equals: 'Priya@Example.com', mode: 'insensitive' },
      },
    });
  });
});
