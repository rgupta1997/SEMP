import { useMemo, useState } from 'react';
import { Check, Hourglass, Landmark, MapPin, Send } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useApi, useApiMutation } from '../lib/hooks';
import { EmptyState, Modal, SearchInput, toast } from './ui';
import { TeamAvatar } from '../features/schedule/ScheduleParts';
import { PERSONAL_NAVY } from '../features/personal/styles';

interface Org { id: string; name: string; short_name?: string | null; city?: string | null; code?: string | null }

const PILL_PRIMARY = 'inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-black text-slate-950 shadow-lg shadow-[var(--accent)]/20 transition hover:brightness-105 disabled:opacity-60';

// Browse every organization on the platform and request to join one. A request is
// a pending membership the org's owners/admins approve on the Members screen. Orgs the
// user already belongs to or has a pending request for are excluded from the list.
export function JoinOrgModal({ onClose }: { onClose: () => void }) {
  const { ctx, refresh } = useAuth();
  const { data: orgs = [], isLoading } = useApi<Org[]>('/organizations');
  const [query, setQuery] = useState('');
  // Ids requested in this session, so the row flips to "Requested" before the auth refresh lands.
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
    <Modal
      title="Find an organization"
      onClose={onClose}
      bannerTone={PERSONAL_NAVY}
      banner={(
        <span className="flex min-w-0 items-center gap-3 text-white">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-slate-950"><Landmark size={17} aria-hidden /></span>
          <span className="min-w-0">
            <span className="block text-base font-black leading-tight">Join an organization</span>
            <span className="block text-xs text-white/60">An owner or admin approves your request.</span>
          </span>
        </span>
      )}
      footer={<div className="flex w-full justify-end"><button type="button" onClick={onClose} className={PILL_PRIMARY}><Check size={14} aria-hidden />Done</button></div>}
    >
      <SearchInput pill value={query} onChange={setQuery} placeholder="Search by name, city or code" className="mb-3 w-full" autoFocus />

      {isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading">
          {[0, 1, 2, 3].map((i) => <span key={i} className="block h-14 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}
        </div>
      ) : candidates.length === 0 ? (
        <EmptyState compact bare icon={<Landmark size={20} />} title={orgs.length === 0 ? 'No organizations yet' : 'Nothing to join'}
          description={query ? 'No organizations match your search.' : 'You already belong to (or have requested) every organization.'} />
      ) : (
        <>
          <div className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">{candidates.length} organization{candidates.length === 1 ? '' : 's'}</div>
          <div className="space-y-1.5">
            {candidates.map((o) => {
              const done = requested.has(o.id);
              return (
                <div key={o.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-[var(--accent-deep)]/30 dark:border-slate-800">
                  <TeamAvatar name={o.name} short={o.short_name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">{o.name}</span>
                    <span className="flex items-center gap-1 truncate text-xs text-slate-500 dark:text-slate-400">
                      <MapPin size={12} className="shrink-0" aria-hidden />{[o.city, o.code].filter(Boolean).join(' · ') || 'City not set'}
                    </span>
                  </span>
                  {done ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                      <Hourglass size={12} aria-hidden />Requested
                    </span>
                  ) : (
                    <button type="button" disabled={join.isPending}
                      onClick={() => join.mutate(o.id, {
                        onSuccess: () => { setRequested((s) => new Set(s).add(o.id)); refresh(); toast.success('Request sent', 'The organization’s owner will review it.'); },
                        onError: (e: any) => toast.error(e.message),
                      })}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-[var(--accent-deep)] ring-1 ring-[var(--accent-deep)]/40 transition hover:bg-[var(--accent)]/15 disabled:opacity-60 dark:text-[var(--accent)]">
                      <Send size={12} aria-hidden /><span className="max-sm:hidden">Request to join</span><span className="sm:hidden">Join</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
