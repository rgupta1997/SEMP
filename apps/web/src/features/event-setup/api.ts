import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SetupEventType, SetupSteps } from '@semp/shared';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { isStaleApplying } from './status';
import type { CredentialRow, EventSetupDetail, EventSetupListItem } from './types';

export const SETUPS_PATH = '/event-setups';
export const setupPath = (id: string) => `${SETUPS_PATH}/${id}`;

/** How often a setup that is mid-apply is asked how it is getting on. */
export const APPLY_POLL_MS = 2000;
/** ...and once the run looks dead, only now and then, in case it was only slow. */
export const STALE_POLL_MS = 15000;

export const eventSetupApi = {
  create: (body: { label: string; event_type: SetupEventType }) =>
    api<EventSetupDetail>('POST', SETUPS_PATH, body),
  saveSteps: (id: string, steps: SetupSteps) =>
    api<EventSetupDetail>('PUT', `${setupPath(id)}/steps`, { steps }),
  validate: (id: string, body: { file_name: string; sheets: Record<string, string[][]> }) =>
    api<EventSetupDetail>('POST', `${setupPath(id)}/validate`, body),
  apply: (id: string) => api<EventSetupDetail>('POST', `${setupPath(id)}/apply`),
  verify: (id: string) => api<EventSetupDetail>('POST', `${setupPath(id)}/verify`),
  // Not through useApi on purpose: a file of passwords has no business sitting in
  // the query cache for the rest of the session.
  credentials: (id: string) => api<{ rows: CredentialRow[] }>('GET', `${setupPath(id)}/credentials`),
  /** `confirm` is the championship's name (or the setup label) as typed; the API checks it. */
  undo: (id: string, confirm: string) => api<EventSetupDetail>('POST', `${setupPath(id)}/undo`, { confirm }),
  remove: (id: string) => api<void>('DELETE', setupPath(id)),
};

export function useEventSetups() {
  return useApi<EventSetupListItem[]>(SETUPS_PATH, true, {
    // A list with a setup mid-apply keeps itself current; otherwise (or when the
    // only runs left are stale ones that will never move) it sits still.
    refetchInterval: (q: { state: { data?: EventSetupListItem[] } }) =>
      (q.state.data ?? []).some((s) => s.status === 'applying' && !isStaleApplying(s)) ? APPLY_POLL_MS * 2 : false,
  });
}

/**
 * One setup. Polls every two seconds while it is applying and stops by itself the
 * moment it is not; React Query drops the interval when the page unmounts, so
 * leaving mid-apply leaves no timer behind.
 */
export function useEventSetup(id: string | undefined) {
  return useApi<EventSetupDetail>(id ? setupPath(id) : null, !!id, {
    refetchInterval: (q: { state: { data?: EventSetupDetail } }) => {
      const d = q.state.data;
      if (d?.status !== 'applying') return false;
      return isStaleApplying(d) ? STALE_POLL_MS : APPLY_POLL_MS;
    },
  });
}

/**
 * Every mutation on a setup answers with the whole setup. Put that straight into
 * the detail's cache (no second round trip to see what just happened) and mark the
 * list stale so the dashboard is right when the admin goes back to it.
 */
export function useSetupCache() {
  const qc = useQueryClient();
  const put = useCallback((detail: EventSetupDetail) => {
    qc.setQueryData([setupPath(detail.id)], detail);
    void qc.invalidateQueries({ queryKey: [SETUPS_PATH], exact: true });
  }, [qc]);
  /** After a refused or failed request: the setup may have moved (an apply that
   *  no longer validates comes back 409 having set it to 'invalid'), so re-read it. */
  const refresh = useCallback((id: string) => {
    void qc.invalidateQueries({ queryKey: [setupPath(id)], exact: true });
    void qc.invalidateQueries({ queryKey: [SETUPS_PATH], exact: true });
  }, [qc]);
  const forget = useCallback((id: string) => {
    qc.removeQueries({ queryKey: [setupPath(id)], exact: true });
    void qc.invalidateQueries({ queryKey: [SETUPS_PATH], exact: true });
  }, [qc]);
  return { put, refresh, forget };
}
