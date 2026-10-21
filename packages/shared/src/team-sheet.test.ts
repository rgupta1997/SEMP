import { describe, it, expect } from 'vitest';
import { defaultSideSheet, matchdaySquad, readTeamSheet, sheetOrder, substitute, usualSide } from './team-sheet.js';

const squad = Array.from({ length: 20 }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}`, jersey: i + 1, role: 'player' }));

describe('team sheet', () => {
  it('knows the usual side for team sports, and none for others', () => {
    expect(usualSide('Football')).toEqual({ onField: 11, bench: 7 });
    expect(usualSide('soccer')?.onField).toBe(11);
    expect(usualSide('Netball')?.onField).toBe(7);
    expect(usualSide('Boxing')).toBeNull();
    expect(usualSide('Chess')).toBeNull();
  });

  it('pre-fills 11 playing, 7 on the bench, the rest out', () => {
    const s = defaultSideSheet(squad, usualSide('football')!);
    expect(s.playing).toHaveLength(11);
    expect(s.bench).toHaveLength(7);
    expect(s.playing[0]).toBe('p1');
    expect(s.bench[0]).toBe('p12');
  });

  it('puts the captain and vice first, then shirt numbers', () => {
    const order = sheetOrder([
      { id: 'a', name: 'A', jersey: 9, role: 'player' },
      { id: 'b', name: 'B', jersey: 30, role: 'captain' },
      { id: 'c', name: 'C', jersey: null, role: 'player' },
      { id: 'd', name: 'D', jersey: 4, role: 'vice_captain' },
    ]).map((p) => p.id);
    expect(order).toEqual(['b', 'd', 'a', 'c']);
  });

  it('a short squad just plays who it has', () => {
    const s = defaultSideSheet(squad.slice(0, 8), usualSide('football')!);
    expect(s.playing).toHaveLength(8);
    expect(s.bench).toEqual([]);
  });

  it('the pickers offer playing then bench; the whole squad with no sheet', () => {
    expect(matchdaySquad(squad, null)).toHaveLength(20);
    const picked = matchdaySquad(squad, { playing: ['p3', 'p1'], bench: ['p9', 'gone'] }).map((p) => p.id);
    expect(picked).toEqual(['p3', 'p1', 'p9']);
  });

  it('a substitution swaps a sub onto the field, in the same slot, and the other to the bench', () => {
    const s = substitute({ playing: ['p1', 'p2', 'p3'], bench: ['s1', 's2'] }, 's1', 'p2');
    expect(s).toEqual({ playing: ['p1', 's1', 'p3'], bench: ['s2', 'p2'] });
  });

  it('reads a stored sheet defensively', () => {
    expect(readTeamSheet({})).toBeNull();
    expect(readTeamSheet({ teamSheet: { A: { playing: ['x', 3], bench: null }, B: {} } }))
      .toEqual({ A: { playing: ['x'], bench: [] }, B: { playing: [], bench: [] } });
  });
});
