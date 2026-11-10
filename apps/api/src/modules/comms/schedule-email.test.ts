import { describe, it, expect } from 'vitest';
import { renderScheduleLiveEmail } from './schedule-live.template.js';
import { ineligibleReason } from './schedule-email.service.js';

const vars = {
  event_name: 'Inter IIM v1',
  event_dates: '12 – 14 Dec 2026',
  event_venue: 'IIM Bangalore',
  stat_1_value: '6', stat_1_label: 'Sports',
  stat_2_value: '12', stat_2_label: 'Teams',
  stat_3_value: '24', stat_3_label: 'Matches',
  first_name: 'Rohit',
  schedule_link: 'https://events.sportagon.in/login?next=%2Fchampionships%2Fabc%2Fschedule',
  organiser_name: 'Sportagon',
};

describe('renderScheduleLiveEmail', () => {
  it('fills every placeholder - nothing left unresolved', () => {
    const { html } = renderScheduleLiveEmail(vars);
    expect(html).not.toMatch(/\{\{\w+\}\}/);
    expect(html).toContain('Inter IIM v1');
    expect(html).toContain('Hi Rohit,');
  });

  it('leaves the schedule link unescaped but escapes text fields', () => {
    const { html } = renderScheduleLiveEmail({ ...vars, organiser_name: 'Tom & Jerry' });
    expect(html).toContain('href="https://events.sportagon.in/login?next=%2Fchampionships%2Fabc%2Fschedule"');
    expect(html).toContain('Tom &amp; Jerry');
    expect(html).not.toContain('Tom & Jerry');
  });

  it('builds a plain-text alternative with the link', () => {
    const { text } = renderScheduleLiveEmail(vars);
    expect(text).toContain('the fixtures are live');
    expect(text).toContain(vars.schedule_link);
  });

  it('throws on an unknown placeholder rather than mailing a literal', () => {
    // @ts-expect-error - intentionally missing fields
    expect(() => renderScheduleLiveEmail({ first_name: 'X' })).toThrow();
  });
});

describe('ineligibleReason', () => {
  it('passes a real address', () => {
    expect(ineligibleReason('rohit@sportagon.in')).toBeUndefined();
    expect(ineligibleReason('a.b@iimb.ac.in')).toBeUndefined();
  });
  it('rejects empty, placeholder and demo addresses', () => {
    expect(ineligibleReason(null)).toBe('no_email');
    expect(ineligibleReason('')).toBe('no_email');
    expect(ineligibleReason('mohit-927@placeholder.invalid')).toBe('placeholder');
    expect(ineligibleReason('cricket@sportagondemo.demo')).toBe('demo');
    expect(ineligibleReason('owner@tnu.demo')).toBe('demo');
  });
});
