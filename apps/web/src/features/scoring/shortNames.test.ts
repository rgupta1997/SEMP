import { describe, expect, it } from 'vitest';
import { shortNames } from './TeamDeck';

describe('shortNames with shirt numbers', () => {
  it('keeps the number in front when a shared surname needs an initial', () => {
    expect(shortNames(['#11 Priya Sharma', '#4 Rohit Sharma'])).toEqual(['#11 P. Sharma', '#4 R. Sharma']);
  });

  it('keeps the number when a long name shortens to its surname', () => {
    expect(shortNames(['#7 Venkatesh Ramaswamy'])).toEqual(['#7 Ramaswamy']);
  });

  it('prints a name that fits whole, number included, and leaves names without one alone', () => {
    expect(shortNames(['#10 Priya Nair', 'Rahul Iyer'])).toEqual(['#10 Priya Nair', 'Rahul Iyer']);
  });

  it('still sets a trailing (sub) tag aside', () => {
    expect(shortNames(['#12 Ananya Sharma (sub)', '#3 Kabir Sharma'])).toEqual(['#12 A. Sharma (sub)', '#3 K. Sharma']);
  });
});
