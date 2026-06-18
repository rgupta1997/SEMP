import { useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useApi, useApiMutation } from '../lib/hooks';
import { Avatar, Button, EmptyState, Modal, SearchInput, Spinner, toast } from './ui';

interface Org { id: string; name: string; short_name?: string | null; city?: string | null; code?: string | null }

// Browse every organization on the platform and request to join one. A request is
// a pending membership the org's owners/admins approve (see PocsPage). Orgs the
// user already belongs to or has a pending request for are excluded from the list.
export function JoinOrgModal({ onClose }: { onClose: () => void }) {
  const { ctx, refresh } = useAuth();
  const { data: orgs = [], isLoading } = useApi<Org[]>('/organizations');
  const [query, setQuery] = useState('');
  // Track ids requested in this session so the row flips to "Requested" instantly,
  // even before the auth context refresh lands.
  const [requested, setRequested] = useState<Set<string>>(new Set());

  const existingIds = useMemo(
    () => new Set((ctx?.organizations ?? []).map((m) => m.organization_id)),
    [ctx?.organizations],
  );

  const join = useApiMutation((orgId: string) => api('POST', `/organizations/${orgId}/join`), ['/auth/me']);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orgs
      .filter((o) => !existingIds.has(o.id))
      .filter((o) => !q || `${o.name} ${o.short_name ?? ''} ${o.city ?? ''} ${o.code ?? ''}`.toLowerCase().includes(q));
  }, [orgs, existingIds, query]);

  return (
    <Modal title="Find an organization" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        Search for an organization and request to join. An owner or admin approves your request before you become a member.
      </p>
      <SearchInput value={query} onChange={setQuery} placeholder="Search by name, city or code…" className="mb-3 w-full" />

      {isLoading ? (
        <Spinner />
      ) : candidates.length === 0 ? (
        <EmptyState icon="🏛" title={orgs.length === 0 ? 'No organizations yet' : 'Nothing to join'}
          description={query ? 'No organizations match your search.' : 'You already belong to (or have requested) every organization.'} />
      ) : (
        <div className="max-h-80 divide-y divide-slate-100 dark:divide-slate-800 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
          {candidates.map((o) => {
            const done = requested.has(o.id);
            return (
              <div key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={o.short_name ?? o.name} size={38} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">{o.name}</div>
                    <div className="truncate text-xs text-slate-500 dark:text-slate-400">{[o.code, o.city].filter(Boolean).join(' · ') || 'Organization'}</div>
                  </div>
                </div>
                {done ? (
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Requested</span>
                ) : (
                  <Button size="sm" variant="outline" disabled={join.isPending}
                    onClick={() => join.mutate(o.id, {
                      onSuccess: () => { setRequested((s) => new Set(s).add(o.id)); refresh(); toast.success('Request sent', 'The organization’s owner will review it.'); },
                      onError: (e: any) => toast.error(e.message),
                    })}>
                    Request to join
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <Button variant="ghost" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}
