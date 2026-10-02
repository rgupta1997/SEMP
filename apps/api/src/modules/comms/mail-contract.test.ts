import { describe, it, expect } from 'vitest';
import { notificationMailData } from './email.js';

// Contract test against the RUNNING mail service.
//
// The templates live in another repository and are shared with other callers, so a
// change there ships to us without a deploy on our side - and because rendering
// happens at send time, it reaches mail we have already queued. The integration guide
// is explicit that GET /templates is authoritative and a copied table is not, so this
// asserts against the endpoint rather than against our reading of the document.
//
// Opt-in behind an explicit flag, not merely behind the credentials being present.
// The credentials now live in apps/api/.env so the app can run, and keying off them
// alone would make the ordinary unit suite fail whenever the mail service is having a
// bad afternoon - a hermetic suite that only tests our code is worth more than that.
//
//   MAIL_CONTRACT_TEST=1 npm run test --workspace @semp/api -- mail-contract
//
// Worth running in CI against the sandbox on a schedule: it is the difference between
// finding out from a test and finding out from a password reset that never arrived.

const URL = process.env.MAIL_API_URL?.replace(/\/+$/, '');
const KEY = process.env.MAIL_API_KEY;
const live = describe.skipIf(!process.env.MAIL_CONTRACT_TEST || !URL || !KEY);

const headers = { 'x-api-key': KEY ?? '', 'content-type': 'application/json' };

/** The preview endpoint runs the same validator a real send does, and mails nobody. */
async function previewStatus(template: string, data: unknown): Promise<number> {
  const res = await fetch(`${URL}/templates/${template}/preview`, {
    method: 'POST', headers, body: JSON.stringify({ data }),
    signal: AbortSignal.timeout(30_000),
  });
  return res.status;
}

live('templates we depend on', () => {
  it('all still exist', async () => {
    const res = await fetch(`${URL}/templates`, { headers, signal: AbortSignal.timeout(30_000) });
    expect(res.status).toBe(200);

    const body = await res.json() as { templates: Array<{ key: string; schema: any }> };
    const keys = body.templates.map((t) => t.key);

    for (const used of ['otp', 'invitation', 'generic-notification']) {
      expect(keys).toContain(used);
    }
  });

  it('otp still requires only `code`, so a signup with no name is still sendable', async () => {
    const res = await fetch(`${URL}/templates`, { headers, signal: AbortSignal.timeout(30_000) });
    const body = await res.json() as { templates: Array<{ key: string; schema: { required: string[] } }> };
    const otp = body.templates.find((t) => t.key === 'otp')!;

    // `name` becoming required would break every signup code, which is issued before
    // the users row exists and therefore has no name to send.
    expect(otp.schema.required).toEqual(['code']);
  });
});

live('payloads we actually send', () => {
  it('accepts the OTP payload for every purpose we map', async () => {
    for (const purpose of ['sign in to Sportagon', 'create your Sportagon account', 'reset your password', 'confirm your email address']) {
      expect(await previewStatus('otp', { code: '482913', ttlMinutes: 10, purpose })).toBe(200);
    }
  });

  it('accepts an OTP with no name, which is the signup case', async () => {
    expect(await previewStatus('otp', { code: '482913', ttlMinutes: 10, purpose: 'sign in to Sportagon' })).toBe(200);
  });

  it('accepts the invitation payload', async () => {
    expect(await previewStatus('invitation', {
      organizationName: 'Delhi Public School', role: 'Organiser',
      acceptUrl: 'https://app.sportagon.in/invites/tok', inviterName: 'Akash', ttlDays: 7,
    })).toBe(200);
  });

  it('accepts a notification built by notificationMailData', async () => {
    const data = notificationMailData({
      subject: 'DPS has been invited to Genesis Sports Fest',
      paragraphs: ['Akash has invited DPS to take part.', 'Accepting enrols your institution.'],
      details: [{ label: 'Championship', value: 'Genesis Sports Fest' }],
      ctaUrl: 'https://app.sportagon.in/organizations/1/invitations',
      ctaLabel: 'View the invitation',
    });

    expect(await previewStatus('generic-notification', data)).toBe(200);
  });

  it('accepts the welcome payload, highlights and all', async () => {
    expect(await previewStatus('welcome', {
      name: 'Akash', ctaUrl: 'https://app.sportagon.in/home', ctaLabel: 'Open Sportagon',
      highlights: [
        'Set up a multi-sport championship in minutes',
        'Auto-generate clash-free fixtures across venues',
        'Live scores, standings and medal tallies - and zero spreadsheets',
      ],
    })).toBe(200);
  });

  // The template caps highlights at five. We send three, but this fails loudly if
  // somebody adds a sixth rather than silently dropping it.
  it('rejects more than five highlights, so our list has room to grow but not silently', async () => {
    expect(await previewStatus('welcome', {
      name: 'Akash', highlights: ['a', 'b', 'c', 'd', 'e', 'f'],
    })).toBe(422);
  });

  // The reason compact()/nonEmpty() exist: every string prop is minLength 1, so a
  // fallback that produced "" would fail the whole send over a field nobody needed.
  it('still rejects the empty string, which is what nonEmpty() guards against', async () => {
    expect(await previewStatus('otp', { code: '482913', name: '', purpose: 'sign in' })).toBe(422);
  });

  it('nonEmpty keeps that payload valid', async () => {
    const data = notificationMailData({
      subject: 'Hello', paragraphs: ['Body'],
      heading: '', greeting: '   ', ctaLabel: '', footnote: '',
    });

    expect(data).not.toHaveProperty('heading');
    expect(await previewStatus('generic-notification', data)).toBe(200);
  });
});
