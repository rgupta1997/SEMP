import { describe, expect, it } from 'vitest';
import { readUndoTrail, redoLast, redoTarget, sealUndoTrail, undoLast, UNDO_TRAIL_MAX, type UndoEntry } from './undo-trail.js';

type Ev = { t: string; n: number };
const log: Ev[] = [{ t: 'point', n: 1 }, { t: 'point', n: 2 }, { t: 'let', n: 3 }];

describe('undo trail', () => {
  it('undo moves the last action onto the trail, with its label, redoable', () => {
    const r = undoLast(log, [], 'Let - rally replayed', 'T1')!;
    expect(r.log).toEqual(log.slice(0, 2));
    expect(r.trail).toEqual([{ event: log[2], label: 'Let - rally replayed', undoneAt: 'T1', open: true }]);
    expect(undoLast([], [], 'x')).toBeNull();
  });

  it('redo puts the latest undone action back and records when', () => {
    const a = undoLast(log, [], 'Let', 'T1')!;
    const b = undoLast(a.log, a.trail, 'Point 2', 'T2')!;
    const c = redoLast(b.log, b.trail, 'T3')!;
    expect(c.log).toEqual(log.slice(0, 2));
    expect(c.trail[1]).toMatchObject({ label: 'Point 2', redoneAt: 'T3', open: false });
    const d = redoLast(c.log, c.trail, 'T4')!;
    expect(d.log).toEqual(log);
    expect(redoTarget(d.trail)).toBeNull();
  });

  it('a new action closes every pending redo but keeps the record', () => {
    const a = undoLast(log, [], 'Let', 'T1')!;
    const sealed = sealUndoTrail(a.trail);
    expect(redoTarget(sealed)).toBeNull();
    expect(sealed[0]).toMatchObject({ label: 'Let', undoneAt: 'T1', open: false });
    expect(redoLast(a.log, sealed)).toBeNull();
    const untouched: UndoEntry<Ev>[] = [];
    expect(sealUndoTrail(untouched)).toBe(untouched);
  });

  it('reads a stored trail tolerantly and keeps it bounded', () => {
    expect(readUndoTrail([{ event: 1, label: 'x', undoneAt: 'T' }, { label: 'no event' }, null, 'junk'])).toHaveLength(1);
    expect(readUndoTrail(undefined)).toEqual([]);
    let r = { log: Array.from({ length: UNDO_TRAIL_MAX + 5 }, (_, n) => ({ t: 'p', n })), trail: [] as UndoEntry<Ev>[] };
    for (let i = 0; i < UNDO_TRAIL_MAX + 5; i++) r = undoLast(r.log, r.trail, 'p')!;
    expect(r.trail).toHaveLength(UNDO_TRAIL_MAX);
  });
});
