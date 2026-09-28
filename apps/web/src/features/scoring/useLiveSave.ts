/**
 * SAVING A LIVE MATCH, SO THAT IT STAYS SAVED.
 *
 * `useLiveSave` is a drop-in replacement for the `useApiMutation(... PATCH
 * /fixtures/:id/live ...)` that every console used to hold its own copy of. The
 * call shape is deliberately identical - `save.mutate(body, { onSuccess, onError
 * })`, `save.isPending` - so the consoles read the same; what changed is all
 * behind it:
 *
 *   1. THE BODY IS DURABLE BEFORE IT IS SENT. It goes to the outbox
 *      (localStorage) synchronously, and is removed only on a 2xx. See
 *      ./liveOutbox.ts, which has the argument for why, and owns the transport.
 *   2. A FAILED SEND IS RETRIED, not reported and dropped. Every 10 seconds, on
 *      the connection coming back, and on the tab being looked at again.
 *   3. LEAVING WITH SOMETHING UNSENT IS INTERRUPTED - `beforeunload` for a refresh
 *      or a close, plus a keepalive PATCH on the way out regardless.
 *
 * Every hook instance drives the SAME per-fixture sender, so the page, the deck
 * inside it and the admin panel beside it cannot race each other.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  enqueue, flushFixture, getStatus, pendingFixtureIds, readOutbox, sendOnExit,
  setRefreshKeys, setRefresher, subscribeStatus, type SaveStatus,
} from './liveOutbox';

/** How often a stuck entry is retried, and how often a running clock re-asserts itself. */
export const AUTOSAVE_MS = 10_000;

export interface SaveOpts {
  onSuccess?: () => void;
  onError?: (e: any) => void;
  /**
   * An autosave, a retry or a clock heartbeat rather than something the official
   * asked for. It is left out of `isPending`, so a save nobody requested can never
   * grey out a button or a score pad underneath somebody's thumb.
   */
  background?: boolean;
}

export interface LiveSave {
  /** Stage a body and send it. Same signature as the mutation this replaces. */
  mutate: (body: Record<string, unknown>, opts?: SaveOpts) => void;
  /** Send whatever is pending right now; resolves true once the outbox is empty. */
  flush: () => Promise<boolean>;
  /**
   * A save THIS component asked for is still outstanding - the flag the call sites
   * disable their submit buttons on. Deliberately NOT "the sender is busy": the
   * background retry loop and the 10-second autosave run constantly during a live
   * match, and wiring a disabled state to them would make the console flicker
   * between usable and not for the length of the game.
   */
  isPending: boolean;
  status: SaveStatus;
}

export function useLiveSave(fixtureId: string, invalidate: (string | null)[] = []): LiveSave {
  const qc = useQueryClient();
  const status = useSyncExternalStore(subscribeStatus, () => getStatus(fixtureId));
  const [outstanding, setOutstanding] = useState(0);

  // The sender lives outside React, so it is handed the two things only React has:
  // how to refresh the affected queries, and which ones those are. Both are stable
  // across the consoles, which all declare the same paths.
  const keys = useMemo(() => invalidate.filter(Boolean) as string[], [invalidate.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps -- the array literal is new each render, its contents are not
  useEffect(() => {
    setRefresher((ks) => qc.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === 'string'
        && ks.some((k) => (q.queryKey[0] as string) === k || (q.queryKey[0] as string).startsWith(k)),
    }));
  }, [qc]);
  useEffect(() => { setRefreshKeys(fixtureId, keys); }, [fixtureId, keys]);

  const mutate = useCallback((body: Record<string, unknown>, opts?: SaveOpts) => {
    if (opts?.background) { enqueue(fixtureId, body, opts); return; }
    setOutstanding((n) => n + 1);
    const settled = () => setOutstanding((n) => Math.max(0, n - 1));
    enqueue(fixtureId, body, {
      onSuccess: () => { settled(); opts?.onSuccess?.(); },
      onError: (e) => { settled(); opts?.onError?.(e); },
    });
  }, [fixtureId]);

  const flush = useCallback(() => flushFixture(fixtureId), [fixtureId]);

  /* --------- the 10-second autosave, and every other reason to try again --------- */
  useEffect(() => {
    const tick = () => { if (readOutbox(fixtureId)) void flushFixture(fixtureId); };
    // Anything left over from the last visit - a tap made just before the tab was
    // closed, or a whole half stranded by a dead connection - goes out now.
    tick();
    const id = window.setInterval(tick, AUTOSAVE_MS);
    // The connection coming back, or the official looking at the tab again, are
    // better signals than the next tick - retry immediately on either.
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', tick);
      document.removeEventListener('visibilitychange', onVisible);
      // Leaving the console is not leaving the match - an official who switches to
      // the schedule and back must not lose the tap in between.
      tick();
    };
  }, [fixtureId]);

  return { mutate, flush, isPending: outstanding > 0, status };
}

/**
 * Read a fixture's save status without owning the saving - for the console header,
 * which reports on saves a deck several levels down is making.
 */
export function useSaveStatus(fixtureId: string): SaveStatus {
  return useSyncExternalStore(subscribeStatus, () => getStatus(fixtureId));
}

/**
 * THE WAY OUT OF A HALF-SAVED MATCH.
 *
 * Mounted once by the console. Two things happen while something is unsent:
 *
 *   - `beforeunload` puts the browser's own "leave site?" dialog in front of a
 *     refresh, a close or a typed URL. Its wording is the browser's and cannot be
 *     changed, which is why the page also carries a visible save indicator: the
 *     dialog says changes may be lost, the indicator says which ones and offers to
 *     retry them.
 *   - `pagehide` fires a keepalive PATCH, so the common case - the official DOES
 *     mean to leave - still gets the data in, rather than deferring it to whenever
 *     the console is next opened.
 *
 * Both read the whole outbox rather than this fixture alone, so a console left with
 * an unsent tap still guards the tab after the official has navigated away from it.
 */
export function useUnloadGuard(): void {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!pendingFixtureIds().length) return;
      e.preventDefault();
      // Older browsers key off the assignment rather than preventDefault().
      e.returnValue = '';
    };
    const onPageHide = () => { pendingFixtureIds().forEach(sendOnExit); };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);
}

/**
 * AUTOSAVE FOR THE CONSOLES THAT HAVE A SAVE BUTTON.
 *
 * The tap-per-point decks send on every action, so the outbox is the whole story
 * for them. The event consoles are forms: an official types forty swimmers' times
 * into React state and nothing at all reaches the server until they find the Save
 * button. That is the version of this bug that loses the most work, and no amount
 * of retrying a request nobody made will help - so the draft is pushed into the
 * same outbox a couple of seconds after typing stops.
 *
 * `value` is what's being watched; `save` is called with no arguments once it
 * settles. `enabled` must stay false until the OFFICIAL has changed something - the
 * state also changes when the console seeds itself from the server, and autosaving
 * that would write the fixture's own data back to it and, worse, flip a scheduled
 * match to live just because somebody opened its console.
 */
export function useDraftAutosave(value: unknown, save: () => void, enabled = true, delayMs = 2_000): void {
  const saveRef = useRef(save);
  saveRef.current = save;
  const seeded = useRef(false);
  const serialized = JSON.stringify(value ?? null);

  useEffect(() => {
    const first = !seeded.current;
    seeded.current = true;
    if (first || !enabled) return;
    const id = window.setTimeout(() => saveRef.current(), delayMs);
    return () => window.clearTimeout(id);
  }, [serialized, enabled, delayMs]);
}
