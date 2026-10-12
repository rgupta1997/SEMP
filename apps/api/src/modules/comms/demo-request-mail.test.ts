import { describe, it, expect, vi } from 'vitest';

// Nothing here sends anything - this is the pure body builder - but email.ts reaches
// config/env.ts through mail-client.ts, which parses the real environment at import
// time and would fail the suite on a missing DATABASE_URL before an assertion ran.
// Stubbed so these stay hermetic.
vi.mock('../../config/env.js', () => ({ env: { MAIL_TRANSPORT: 'console' }, isProduction: false }));

import { demoRequestAckMail, notificationMailData, type DemoRequestMail } from './email.js';

// What `generic-notification` will and will not accept, asserted without the service.
//
// Every rule checked here fails the same way in production - a 422 that rejects the
// WHOLE mail - and each one is likelier the more the visitor filled in, so the person
// who told us the most would be the one who hears nothing back. Worth pinning
// hermetically rather than leaving to the opt-in contract suite in
// mail-contract.test.ts, which only runs against a live service.

const APP_URL = 'https://events.sportagon.in';

/** Every field this mail can show, all answered. */
const full: DemoRequestMail = {
  id: 'lead-1',
  name: 'Priya Sharma',
  email: 'priya@example.com',
  organization: 'Northfield School',
  role: 'School',
  city: 'Pune',
  event_date: 'mid-January',
  sport_count: 6,
  participant_count: 900,
};

/** Only what the form marks required. */
const minimal: DemoRequestMail = {
  id: 'lead-2',
  name: 'Ravi',
  email: 'ravi@example.com',
  organization: 'Acme Sports Club',
  role: 'Sports club or academy',
};

describe('the demo-request acknowledgement', () => {
  it('never exceeds the ten rows the template allows', () => {
    const data = notificationMailData(demoRequestAckMail(full, APP_URL)) as { details?: unknown[] };
    expect(data.details!.length).toBeLessThanOrEqual(10);
  });

  // A number here is a 422, and `participant_count: 900` arrives as a number.
  it('sends every detail value as a string', () => {
    const data = notificationMailData(demoRequestAckMail(full, APP_URL)) as {
      details: Array<{ label: string; value: unknown }>;
    };
    for (const row of data.details) expect(typeof row.value).toBe('string');
  });

  // Every string prop is minLength 1, so an unanswered optional must be ABSENT, not "".
  it('drops unanswered fields rather than sending empty strings', () => {
    const data = notificationMailData(demoRequestAckMail(minimal, APP_URL)) as {
      details?: Array<{ label: string; value: string }>;
      paragraphs: string[];
    };
    for (const row of data.details ?? []) expect(row.value).not.toBe('');
    for (const p of data.paragraphs) expect(p).not.toBe('');
    expect(data.paragraphs.length).toBeGreaterThan(0);
  });

  it('greets by first name, and greets a one-word name too', () => {
    expect(demoRequestAckMail(full, APP_URL).greeting).toBe('Hi Priya,');
    expect(demoRequestAckMail(minimal, APP_URL).greeting).toBe('Hi Ravi,');
  });

  it('falls back to a plain greeting rather than rendering an empty name', () => {
    const data = notificationMailData(demoRequestAckMail({ ...full, name: '   ' }, APP_URL));
    expect(data.greeting).toBe('Hi there,');
  });

  // The whole point of the mail: it has to say a person is coming, and when.
  it('promises a specialist within one working day, as the landing page does', () => {
    const body = demoRequestAckMail(full, APP_URL).paragraphs.join(' ');
    expect(body).toMatch(/specialists? will reach out/i);
    expect(body).toMatch(/one working day/i);
  });

  // This mail goes to an address an anonymous caller typed, so it must carry only what
  // that caller already told us - never anything read from another row.
  it('echoes only what the visitor submitted', () => {
    const values = demoRequestAckMail(full, APP_URL).details!.map((d) => d.value);
    for (const v of values) {
      expect([
        full.organization, full.role, full.city, full.event_date,
        String(full.sport_count), String(full.participant_count),
      ]).toContain(v);
    }
  });

  it('tells a stranger why they got it', () => {
    expect(demoRequestAckMail(full, APP_URL).footnote).toMatch(/if that was not you/i);
  });

  // A genuine zero is an answer ("no sports decided yet"), not a blank.
  it('keeps a zero rather than dropping it as falsy', () => {
    const data = notificationMailData(demoRequestAckMail({ ...full, sport_count: 0 }, APP_URL)) as {
      details: Array<{ label: string; value: string }>;
    };
    expect(data.details.find((d) => d.label === 'Sports')?.value).toBe('0');
  });
});
