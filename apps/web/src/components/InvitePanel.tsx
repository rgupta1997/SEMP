import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useApi, useApiMutation } from '../lib/hooks';
import { Avatar, Button, Card, Input, Spinner, StatusBadge, toast } from './ui';

interface Invitation {
  id: string;
  org_name: string;
  status: string;
  organizations?: { id: string; name: string; short_name?: string | null; city?: string | null } | null;
}

interface Org { id: string; name: string; short_name?: string | null; city?: string | null }

// Searchable multi-select picker over the master organization list (GET /organizations).
// Server-side typeahead: the first 10 orgs load by default, then the DB is queried as
// the user types (debounced). Already-invited orgs can be hidden via `excludeIds`.
// Picked orgs show as removable chips.
function OrgPicker({ value, onChange, excludeIds }: { value: Org[]; onChange: (o: Org[]) => void; excludeIds?: Set<string> }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Debounce typing so each keystroke doesn't hit the DB.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // No query → first 10 orgs; otherwise search the DB (capped so the dropdown stays
  // light). Always the directory scope - inviting an organisation needs its name and
  // city, never anything behind its tenant boundary (J6-E5-S1).
  const path = debounced
    ? `/organizations?scope=directory&q=${encodeURIComponent(debounced)}&limit=25`
    : '/organizations?scope=directory&limit=10';
  const { data: orgs = [], isFetching } = useApi<Org[]>(path);

  // Close on any click/tap outside the picker, plus Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const selectedIds = useMemo(() => new Set(value.map((o) => o.id)), [value]);

  const results = useMemo(() => {
    const exclude = excludeIds ?? new Set<string>();
    return orgs.filter((o) => !exclude.has(o.id));
  }, [orgs, excludeIds]);

  // Toggle membership in the selection; keep the dropdown open so several can be picked.
  const toggle = (o: Org) =>
    onChange(selectedIds.has(o.id) ? value.filter((x) => x.id !== o.id) : [...value, o]);

  return (
    <div className="relative" ref={rootRef}>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((o) => (
            <span key={o.id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-2.5 pr-1 text-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              {o.short_name || o.name}
              <button
                type="button"
                onClick={() => toggle(o)}
                aria-label={`Remove ${o.name}`}
                className="grid h-4 w-4 place-items-center rounded-full text-brand-500 hover:bg-brand-100 hover:text-brand-700 dark:hover:bg-brand-500/30"
              >×</button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search organizations…"
      />
      {open && (
          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
            {isFetching && results.length === 0 ? (
              <div className="grid h-16 place-items-center"><Spinner /></div>
            ) : results.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-slate-400 dark:text-slate-500">
                {debounced ? 'No organizations match your search.' : 'No organizations in the master list yet.'}
              </p>
            ) : results.map((o) => {
              const checked = selectedIds.has(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/60"
                >
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] font-bold ${checked ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                    {checked ? '✓' : ''}
                  </span>
                  <Avatar name={o.name} size={28} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                      {o.name}{o.short_name ? <span className="ml-1.5 text-slate-400 dark:text-slate-500">({o.short_name})</span> : null}
                    </div>
                    {o.city && <div className="truncate text-xs text-slate-400 dark:text-slate-500">{o.city}</div>}
                  </div>
                </button>
              );
            })}
          </div>
      )}
    </div>
  );
}

// Host-side invite manager: search the master institution list and send the
// request straight to the org. Reused in the create wizard's Invite step and the
// Invite tab.
export function InvitePanel({ eventId }: { eventId: string }) {
  const path = `/championships/${eventId}/invitations`;
  const qc = useQueryClient();
  const { data: invites = [], isLoading } = useApi<Invitation[]>(path);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [inviting, setInviting] = useState(false);

  const cancel = useApiMutation((id: string) => api('DELETE', `${path}/${id}`), [path]);

  // Hide orgs that already have a live invitation so the picker only offers new ones.
  const invitedIds = useMemo(
    () => new Set(invites
      .filter((i) => i.status === 'pending' || i.status === 'accepted')
      .map((i) => i.organizations?.id)
      .filter(Boolean) as string[]),
    [invites],
  );

  const submit = async () => {
    if (orgs.length === 0) { toast.error('Pick at least one organization from the list'); return; }
    setInviting(true);
    const results = await Promise.allSettled(orgs.map((o) => api('POST', path, { organization_id: o.id })));
    await qc.invalidateQueries({ queryKey: [path] });
    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - sent;
    setOrgs([]);
    setInviting(false);
    if (sent > 0) toast.success(`${sent} invitation${sent === 1 ? '' : 's'} sent`);
    if (failed > 0) {
      const firstErr = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason;
      toast.error(sent === 0 ? (firstErr?.message ?? 'Could not send invitations') : `${failed} could not be sent`);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">Search the master list and send the request straight to the organizations. They confirm and add their own teams - you don't enter rosters.</p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[200px] flex-1">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Organizations</span>
          <OrgPicker value={orgs} onChange={setOrgs} excludeIds={invitedIds} />
        </label>
        <Button onClick={submit} disabled={inviting || orgs.length === 0}>
          {inviting ? 'Inviting…' : orgs.length > 1 ? `+ Invite ${orgs.length}` : '+ Invite'}
        </Button>
      </div>

      {isLoading ? <Spinner /> : invites.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          No organizations yet. Add at least two to auto-generate fixtures - or invite them later.
        </div>
      ) : (
        <div className="space-y-2">
          {invites.map((inv) => (
            <Card key={inv.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-800 dark:text-slate-200">{inv.organizations?.name ?? inv.org_name}</div>
                {inv.organizations?.city && <div className="text-xs text-slate-500 dark:text-slate-400">{inv.organizations.city}</div>}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={inv.status} label={inv.status === 'accepted' ? 'Accepted' : undefined} />
                {inv.status === 'pending' && (
                  <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400"
                    onClick={() => cancel.mutate(inv.id, { onSuccess: () => toast.success('Invitation cancelled'), onError: (e: any) => toast.error(e.message) })}
                    disabled={cancel.isPending}>
                    Cancel
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
