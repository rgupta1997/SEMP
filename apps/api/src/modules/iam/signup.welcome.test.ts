import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';

// Sign-up sends two separate welcomes: the email and the in-app feed entry.
const envStub = { NODE_ENV: 'development', WEB_APP_URL: 'http://localhost:5174/app', MAX_ACCOUNTS_PER_PHONE: 3, JWT_SECRET: 'x'.repeat(48) };
vi.mock('../../config/env.js', () => ({ env: envStub, isProduction: false }));

vi.mock('./accounts.service.js', () => ({
  accountsForSubject: async () => [],
  accountsMatchingPassword: async () => [],
  phoneHasCapacity: async () => true,
}));
vi.mock('./auth-tokens.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth-tokens.service.js')>()),
  consumeById: async () => true,
}));

const sent: string[] = [];
let welcomeThrows = false;
vi.mock('../comms/email.js', () => ({
  sendOtpEmail: async () => undefined,
  sendWelcomeEmail: async () => { if (welcomeThrows) throw new Error('mail down'); sent.push('welcome-email'); },
}));
vi.mock('@semp/notifications/server/notify.js', () => ({
  notify: async (_p: unknown, input: { type: string; userId: string }) => { sent.push(`notify:${input.type}:${input.userId}`); },
}));

const prisma = {
  users: {
    findFirst: async () => null,
    create: async ({ data }: any) => ({ id: 'new-user', name: data.name, email: data.email, is_super_admin: false, organization_id: null }),
  },
};

const express = (await import('express')).default;
const { makeSignInRouter } = await import('./signin.routes.js');
const { signVerificationTicket } = await import('./verification-ticket.js');

const app = express();
app.use(express.json());
app.use('/auth', makeSignInRouter(prisma as never));
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
afterAll(() => { server.close(); });

function signup() {
  return fetch(`http://127.0.0.1:${port}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      phone_token: signVerificationTicket({ purpose: 'verify_phone', tid: 'tp', phone: '+919876543210' } as never),
      email_token: signVerificationTicket({ purpose: 'verify_email', tid: 'te', email: 'neha@example.com' } as never),
      name: 'Neha',
      password: 'secret123',
    }),
  });
}

describe('POST /auth/signup welcomes the new user', () => {
  beforeEach(() => { sent.length = 0; welcomeThrows = false; });

  it('sends the welcome email and the in-app account_created notification', async () => {
    const res = await signup();
    expect(res.status).toBe(201);
    expect(sent).toEqual(['welcome-email', 'notify:account_created:new-user']);
  });

  it('still sends the in-app welcome when the email fails', async () => {
    welcomeThrows = true;
    const res = await signup();
    expect(res.status).toBe(201);
    expect(sent).toEqual(['notify:account_created:new-user']);
  });
});
