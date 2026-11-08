// The undo trail: every Undo a scoring console makes, kept beside the action log.
// The log itself stays clean (stats, standings and records read it), so an undone
// action leaves the log and lands here, with what the log said about it.

export interface UndoEntry<T = unknown> {
  /** The action that was undone, exactly as it was logged. */
  event: T;
  /** How the log described it when it was undone ("Point to IIMK"). */
  label: string;
  undoneAt: string;
  redoneAt?: string;
  /** Can still be redone: nothing new has been recorded since. */
  open?: boolean;
}

/** Oldest entries drop off past this, so a long match can't grow the record without end. */
export const UNDO_TRAIL_MAX = 200;

/** A stored trail, tolerating anything malformed. */
export function readUndoTrail<T = unknown>(raw: unknown): UndoEntry<T>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is UndoEntry<T> =>
    !!e && typeof e === 'object' && 'event' in e && typeof (e as UndoEntry).undoneAt === 'string'
    && typeof (e as UndoEntry).label === 'string');
}

const cap = <T>(trail: UndoEntry<T>[]) => (trail.length > UNDO_TRAIL_MAX ? trail.slice(-UNDO_TRAIL_MAX) : trail);

/** Put an undone action on the trail, redoable. For consoles whose last action isn't simply the log's tail. */
export function recordUndo<T>(trail: UndoEntry<T>[], event: T, label: string, at = new Date().toISOString()): UndoEntry<T>[] {
  return cap([...trail, { event, label, undoneAt: at, open: true }]);
}

/** Undo the last action: it leaves the log and goes on the trail, redoable. */
export function undoLast<T>(log: T[], trail: UndoEntry<T>[], label: string, at = new Date().toISOString()):
  { log: T[]; trail: UndoEntry<T>[] } | null {
  if (!log.length) return null;
  return { log: log.slice(0, -1), trail: recordUndo(trail, log[log.length - 1], label, at) };
}

/** The action Redo would bring back: the most recent undo with nothing recorded since. */
export function redoTarget<T>(trail: UndoEntry<T>[]): UndoEntry<T> | null {
  for (let i = trail.length - 1; i >= 0; i--) if (trail[i].open) return trail[i];
  return null;
}

/** Take the next redo: the action to put back, and the trail marked redone. */
export function takeRedo<T>(trail: UndoEntry<T>[], at = new Date().toISOString()): { event: T; trail: UndoEntry<T>[] } | null {
  const target = redoTarget(trail);
  if (!target) return null;
  const i = trail.lastIndexOf(target);
  const next = trail.slice();
  next[i] = { ...target, open: false, redoneAt: at };
  return { event: target.event, trail: next };
}

/** Redo: the latest open undo goes back on the log, and the trail says so. */
export function redoLast<T>(log: T[], trail: UndoEntry<T>[], at = new Date().toISOString()):
  { log: T[]; trail: UndoEntry<T>[] } | null {
  const r = takeRedo(trail, at);
  return r ? { log: [...log, r.event], trail: r.trail } : null;
}

/** A new action: nothing undone before it can be redone any more. Same array when nothing changes. */
export function sealUndoTrail<T>(trail: UndoEntry<T>[]): UndoEntry<T>[] {
  return trail.some((e) => e.open) ? trail.map((e) => (e.open ? { ...e, open: false } : e)) : trail;
}
