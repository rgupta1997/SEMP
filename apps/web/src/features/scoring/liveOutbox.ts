/**
 * THE SCORING OUTBOX.
 *
 * Every console writes its state to the server on each tap, and until now that was
 * the ONLY copy of the tap that left React state. A PATCH that failed - the venue's
 * wifi dropping for thirty seconds, the phone waking from sleep, Lambda cold-starting
 * past the gateway's patience - raised a toast and nothing else. The official kept
 * scoring against a local state the server had never seen, and the next reload
 * silently rolled the match back to the last write that happened to land. A whole
 * half of football, gone, with no indication anything had been lost.
 *
 * So the browser gets a write-ahead log of its own. Before a request is made, the
 * body is written SYNCHRONOUSLY to localStorage. It is removed only once the server
 * has acknowledged it. Everything else here follows from those two sentences:
 *
 *   - a refresh, a crash, a killed tab or a dead battery cannot lose a tap, because
 *     the tap was durable before the network was ever involved;
 *   - reopening the console finds the entry still there and replays it;
 *   - a failed send is not an error to report and forget, it is an entry that stays
 *     queued until it lands.
 *
 * ONE ENTRY PER FIXTURE, NOT A QUEUE. Each body the consoles send is a complete
 * snapshot of what the fixture should look like (live_state, live_log and the
 * headline fields), so replaying an old one on top of a newer one would undo
 * scoring. Successive saves are shallow-merged into a single entry instead, which
 * also matches the server's own "only touch fields that were actually sent" rule:
 * a status-only walkover merged over a score keeps both.
 */

import { api, API_BASE } from '../../lib/api';
import { authHeader } from '../../lib/browserStorage';

const PREFIX = 'semp.live.outbox:';
const keyFor = (fixtureId: string) => PREFIX + fixtureId;

/** Older than this and the match is long over - a stale entry is swept, not replayed. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface OutboxEntry {
  /** Bumped on every local change. The acknowledgement carries it back, so a send
   *  that resolves after a newer tap has been staged knows not to clear it. */
  seq: number;
  /** When the most recent local change was made (epoch ms). */
  at: number;
  /** The merged body to PATCH to /fixtures/:id/live. */
  body: Record<string, unknown>;
}

/* ----------------------------- storage ----------------------------- */

export function readOutbox(fixtureId: string): OutboxEntry | null {
  let raw: string | null;
  try { raw = localStorage.getItem(keyFor(fixtureId)); } catch { return null; }
  if (!raw) return null;
  try {
    const e = JSON.parse(raw) as OutboxEntry;
    if (!e || typeof e.seq !== 'number' || !e.body) return null;
    if (Date.now() - e.at > MAX_AGE_MS) { drop(fixtureId); return null; }
    return e;
  } catch {
    // Truncated by a quota error mid-write, or written by an older shape. Either
    // way it can't be replayed, and leaving it would block every future read.
    drop(fixtureId);
    return null;
  }
}

function write(fixtureId: string, e: OutboxEntry): void {
  try {
    localStorage.setItem(keyFor(fixtureId), JSON.stringify(e));
  } catch {
    // Private mode, or the quota is full (a ball-by-ball cricket log is not small).
    // The send still goes out - only the crash-safety net is lost - so say so in the
    // status rather than letting the official believe the tap is safe.
    markStorageFailed(fixtureId);
  }
}

function drop(fixtureId: string): void {
  try { localStorage.removeItem(keyFor(fixtureId)); } catch { /* private mode */ }
}

/** Merge a body into the fixture's pending entry and return the new entry. */
export function stage(fixtureId: string, body: Record<string, unknown>): OutboxEntry {
  const prev = readOutbox(fixtureId);
  const next: OutboxEntry = {
    seq: (prev?.seq ?? 0) + 1,
    at: Date.now(),
    body: { ...(prev?.body ?? {}), ...body },
  };
  write(fixtureId, next);
  notify();
  return next;
}

/**
 * Acknowledge a send. Clears the entry only if nothing has been staged since it
 * left - otherwise the taps that merged in behind it would be thrown away by their
 * own predecessor's success.
 */
export function acknowledge(fixtureId: string, sentSeq: number): void {
  const cur = readOutbox(fixtureId);
  if (cur && cur.seq > sentSeq) return;
  drop(fixtureId);
  notify();
}

/** Every fixture with something still unsent - used to warn on the way out. */
export function pendingFixtureIds(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
  } catch { /* private mode */ }
  return out.filter((id) => readOutbox(id) !== null);
}

/* ----------------------------- observable status ----------------------------- */
/**
 * The page header wants to say "Saved 12:04" or "Unsaved - retrying" while the save
 * itself belongs to a console component several levels down, so the status lives
 * here rather than in either of them and both subscribe to it.
 */

export interface SaveStatus {
  /** A request is in the air right now. */
  sending: boolean;
  /** Something is staged and not yet acknowledged. */
  unsaved: boolean;
  /** The last attempt came back an error (or never reached a server). */
  failed: boolean;
  /** Epoch ms of the last acknowledged write, or null if nothing has landed yet. */
  savedAt: number | null;
  /** localStorage refused the write - the crash-safety net is off for this fixture. */
  storageFailed: boolean;
  /** When the oldest unsent change was made, so "unsaved for 2 min" can be said. */
  unsavedSince: number | null;
}

const IDLE: SaveStatus = {
  sending: false, unsaved: false, failed: false, savedAt: null, storageFailed: false, unsavedSince: null,
};

const statuses = new Map<string, SaveStatus>();
const listeners = new Set<() => void>();

function notify(): void { listeners.forEach((fn) => fn()); }

export function subscribeStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * The current status, as one stable object per (fixture, state) so React's
 * `useSyncExternalStore` doesn't loop: it compares snapshots by identity, so a
 * fresh object on every read would be an infinite re-render.
 */
export function getStatus(fixtureId: string): SaveStatus {
  const entry = readOutbox(fixtureId);
  const unsaved = entry !== null;
  const unsavedSince = entry?.at ?? null;
  const s = statuses.get(fixtureId);
  if (!s) {
    if (!unsaved) return IDLE;
    const seeded = { ...IDLE, unsaved, unsavedSince };
    statuses.set(fixtureId, seeded);
    return seeded;
  }
  // The stored status and the outbox can disagree for one render - another tab
  // acknowledged the entry, say. The outbox is the fact, so it wins.
  if (s.unsaved === unsaved && s.unsavedSince === unsavedSince) return s;
  const merged = { ...s, unsaved, unsavedSince };
  statuses.set(fixtureId, merged);
  return merged;
}

export function setStatus(fixtureId: string, patch: Partial<SaveStatus>): void {
  statuses.set(fixtureId, { ...getStatus(fixtureId), ...patch });
  notify();
}

function markStorageFailed(fixtureId: string): void {
  statuses.set(fixtureId, { ...(statuses.get(fixtureId) ?? IDLE), storageFailed: true });
}

/* ----------------------------- the sender ----------------------------- */
/**
 * ONE SENDER PER FIXTURE, NOT ONE PER COMPONENT.
 *
 * The console mounts several things that save - the page itself, the deck inside
 * it, an admin panel beside it - and each holds its own `useLiveSave`. If each also
 * held its own "am I sending?" flag they would happily PATCH the same fixture at
 * the same time, and two overlapping writes can resolve out of order: the older
 * snapshot lands last and un-scores the most recent points. That is precisely the
 * class of bug this whole file exists to remove, so the in-flight flag, the queue
 * of callers waiting on an acknowledgement and the send loop all live here, keyed
 * by fixture, and every hook instance drives the same one.
 */

type Waiter = { seq: number; onSuccess?: () => void; onError?: (e: unknown) => void };

const inFlight = new Set<string>();
const waiters = new Map<string, Waiter[]>();
/** The query paths to refresh after an acknowledged write, as the consoles declare them. */
const refreshKeys = new Map<string, string[]>();
/** Set once by the first mounted hook - there is a single QueryClient in the app. */
let refresh: ((keys: string[]) => void) | null = null;

export function setRefresher(fn: (keys: string[]) => void): void { refresh = fn; }
export function setRefreshKeys(fixtureId: string, keys: string[]): void {
  if (keys.length) refreshKeys.set(fixtureId, keys);
}

function settle(fixtureId: string, upToSeq: number, err?: unknown): void {
  const all = waiters.get(fixtureId) ?? [];
  const done = all.filter((w) => w.seq <= upToSeq);
  waiters.set(fixtureId, all.filter((w) => w.seq > upToSeq));
  done.forEach((w) => (err === undefined ? w.onSuccess?.() : w.onError?.(err)));
}

/**
 * Send whatever is staged, then - if taps merged in while the request was away -
 * send again. The loop is what stops a fast scorer on a slow connection building a
 * backlog: everything that arrived during the last request goes out as one body.
 *
 * Resolves true when the outbox is empty, false when the entry is still stuck.
 */
export async function flushFixture(fixtureId: string): Promise<boolean> {
  if (inFlight.has(fixtureId)) return false;
  for (;;) {
    const entry = readOutbox(fixtureId);
    if (!entry) { setStatus(fixtureId, { sending: false }); return true; }
    inFlight.add(fixtureId);
    setStatus(fixtureId, { sending: true });
    try {
      await api('PATCH', `/fixtures/${fixtureId}/live`, entry.body);
      acknowledge(fixtureId, entry.seq);
      setStatus(fixtureId, { sending: false, failed: false, savedAt: Date.now() });
      // Everything staged at or before the acknowledged seq was inside that body,
      // so every caller still waiting on one of those taps has been served.
      settle(fixtureId, entry.seq);
      const keys = refreshKeys.get(fixtureId);
      if (refresh && keys?.length) refresh(keys);
    } catch (e) {
      // THE ENTRY STAYS IN THE OUTBOX. The caller is told, so it can un-busy its
      // button and show the message - but the data is no longer the caller's
      // problem, because the retry loop owns it from here.
      setStatus(fixtureId, { sending: false, failed: true });
      // EVERY waiter, not just the ones inside this body: a caller staged after the
      // request left would otherwise sit disabled until the next 10-second retry,
      // with its button spinning over a network that is plainly down. They are all
      // told the same true thing - this attempt failed, the data is still queued.
      settle(fixtureId, Number.POSITIVE_INFINITY, e);
      inFlight.delete(fixtureId);
      return false;
    }
    inFlight.delete(fixtureId);
    // A tap that landed while the request was out has already bumped the entry.
    if (!readOutbox(fixtureId)) return true;
  }
}

/** Stage a body, register any caller waiting on it, and start the sender. */
export function enqueue(
  fixtureId: string,
  body: Record<string, unknown>,
  opts?: { onSuccess?: () => void; onError?: (e: unknown) => void },
): void {
  const entry = stage(fixtureId, body);
  if (opts?.onSuccess || opts?.onError) {
    waiters.set(fixtureId, [...(waiters.get(fixtureId) ?? []), { seq: entry.seq, ...opts }]);
  }
  void flushFixture(fixtureId);
}

/* ----------------------------- last-ditch send ----------------------------- */

/**
 * Send whatever is pending on the way out of the page.
 *
 * `keepalive` is the only way a request survives the document being torn down - an
 * ordinary fetch started in `pagehide` is cancelled along with the page. It is
 * capped at 64KB across all in-flight keepalive requests, which a long cricket log
 * can exceed, so this is a best effort ON TOP OF the outbox and never instead of
 * it: if it doesn't get through, the entry is still on disk for the next load.
 */
export function sendOnExit(fixtureId: string): void {
  const entry = readOutbox(fixtureId);
  if (!entry) return;
  try {
    void fetch(`${API_BASE}/fixtures/${fixtureId}/live`, {
      method: 'PATCH',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(entry.body),
    });
  } catch { /* nothing more to try - the entry stays staged for the next load */ }
}
