import { describe, expect, it } from 'vitest';
import { assertSportIssue } from './issue-access.js';

describe('who may issue certificates for an event', () => {
  it("the institution's issuer and an overall organiser are not limited", () => {
    expect(() => assertSportIssue('issuer', 'organising')).not.toThrow();
    expect(() => assertSportIssue('all', 'officials')).not.toThrow();
    expect(() => assertSportIssue('all', 'winners')).not.toThrow();
  });
  it('a sport organiser issues their own sport', () => {
    expect(() => assertSportIssue(['cricket'], 'winners', 'cricket')).not.toThrow();
    expect(() => assertSportIssue(['cricket'], 'awards', 'cricket')).not.toThrow();
  });
  it('but not another sport, or no sport at all', () => {
    expect(() => assertSportIssue(['cricket'], 'winners', 'football')).toThrow(/sports you organise/);
    expect(() => assertSportIssue(['cricket'], 'participation', null)).toThrow(/sports you organise/);
  });
  it('and not the event-wide categories', () => {
    expect(() => assertSportIssue(['cricket'], 'organising', 'cricket')).toThrow(/overall organiser/);
    expect(() => assertSportIssue(['cricket'], 'officials', 'cricket')).toThrow(/overall organiser/);
  });
});
