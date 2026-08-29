import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useApi, useApiMutation } from '../lib/hooks';
import { Avatar, Badge, Button, Card, Input, Spinner, StatusBadge, toast } from './ui';
import { ApplicationsQueue } from '../pages/organiser/ApplicationsQueue';

interface Invitation {
  id: string;
  org_name: string;
  status: string;
  organizations?: { id: string; name: string; short_name?: string | null; city?: string | null } | null;
  org_unit_id?: string | null;
  org_units?: { id: string; name: string; code: string | null; type: string } | null;
  /** Server-resolved label: the campus for an internal event, the org otherwise. */
  target?: string;
  is_unit?: boolean;
}

/** One of the host's own campuses or batches, as the invite picker offers it. */
interface InvitableUnit {
  key: string;
  unitId: string | null;
  name: string;
  short?: string | null;
  parentName?: string | null;
  invited: boolean;
  invitation_id: string | null;
  status: string | null;
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

  // No query → first 10 orgs; otherwise search the DB (capped so the dropdown stays light).
  const path = debounced
    ? `/organizations?q=${encodeURIComponent(debounced)}&limit=25`
    : '/organizations?limit=10';
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
          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900">
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
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] font-bold ${checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
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

/**
 * The invite list for an INTERNAL championship.
 *
 * A different control, not a different filter, because the question is different.
 * Inviting an organisation is a search over every institution in the country;
 * inviting a campus is a tick-list of the host's own, which is short, known, and
 * wrong to make somebody search for. There is nobody outside to negotiate with, so
 * being invited IS taking part - the campus administrator then builds the squads.
 */
function CampusInvites({ eventId, path }: { eventId: string; path: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useApi<{ intra: boolean; units: InvitableUnit[] }>(
    `/championships/${eventId}/invitable`,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const units = data?.units ?? [];
  const invited = units.filter((u) => u.invited);

  const refresh = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? '').includes(`/championships/${eventId}/`) });

  const invite = async (u: InvitableUnit) => {
    setBusy(u.key);
    try {
      await api('POST', path, { org_unit_id: u.unitId });
      toast.success(`${u.name} is in`);
      refresh();
    } catch (e: any) { toast.error(e?.message ?? `Could not add ${u.name}`); }
    finally { setBusy(null); }
  };

  const withdraw = async (u: InvitableUnit) => {
    if (!u.invitation_id) return;
    setBusy(u.key);
    try {
      await api('DELETE', `${path}/${u.invitation_id}`);
      toast.success(`${u.name} withdrawn`);
      refresh();
    } catch (e: any) {
      // The server refuses once squads exist, and says how many - worth showing.
      toast.error(e?.message ?? `Could not withdraw ${u.name}`);
    } finally { setBusy(null); }
  };

  const inviteAll = async () => {
    const todo = units.filter((u) => !u.invited);
    if (!todo.length) return;
    setBusy('all');
    let sent = 0;
    const failed: string[] = [];
    for (const u of todo) {
      try { await api('POST', path, { org_unit_id: u.unitId }); sent++; } catch { failed.push(u.name); }
    }
    setBusy(null);
    refresh();
    if (failed.length) toast.error(`${sent} added, ${failed.length} could not be`, failed.join(', '));
    else toast.success(`${sent} added`);
  };

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-slate-500 dark:text-slate-400">
          Choose which of your own campuses and batches take part. They are in straight
          away — there is nobody outside the organisation to accept. Each one's
          administrator then builds its squads and enters them; you do not enter rosters.
        </p>
        {units.length > invited.length && (
          <Button onClick={inviteAll} disabled={busy !== null}>
            {busy === 'all' ? 'Adding…' : `+ Add all ${units.length - invited.length}`}
          </Button>
        )}
      </div>

      {units.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-800 dark:text-slate-500">
          Nothing to add yet. Create a campus — and set it Active — on the organisation's
          Campuses &amp; Units screen.
        </div>
      ) : (
        <div className="space-y-2">
          {units.map((u) => (
            <Card key={u.key} className="flex items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={u.name} size={30} />
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800 dark:text-slate-200">{u.name}</div>
                  {u.parentName && <div className="truncate text-xs text-slate-500 dark:text-slate-400">{u.parentName}</div>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* "In", not "Invited". There is no pending state to report - an
                    added campus is taking part - and a badge implying a handshake
                    nobody is waiting on is worse than no badge. */}
                {u.invited && <Badge tone="green">In</Badge>}
                {u.invited ? (
                  <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400"
                    disabled={busy !== null} onClick={() => withdraw(u)}>Remove</Button>
                ) : (
                  <Button size="sm" disabled={busy !== null} onClick={() => invite(u)}>
                    {busy === u.key ? 'Adding…' : '+ Add'}
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

/**
 * Which invite control this championship takes.
 *
 * A wrapper rather than a branch inside one component, because the two panels hold
 * DIFFERENT hooks - the organisation one has picker state and a cancel mutation the
 * campus one has no use for. Branching mid-component meant the early return skipped
 * every hook below it the moment `invitable` resolved, and React counted fewer hooks
 * on that render than the one before: "Rendered fewer hooks than expected".
 *
 * Splitting is the fix rather than hoisting the return, because it is also the
 * honest shape: these are two controls that happen to answer the same question.
 * The one hook here runs unconditionally, so the early return below is safe.
 */
export function InvitePanel({ eventId }: { eventId: string }) {
  const path = `/championships/${eventId}/invitations`;
  // Asked of the server rather than inferred - the shape is a property of the
  // championship, not something the client can work out.
  const { data: invitable, isLoading } = useApi<{ intra: boolean }>(`/championships/${eventId}/invitable`);

  if (isLoading) return <Spinner />;
  return invitable?.intra
    ? <CampusInvites eventId={eventId} path={path} />
    : <OrganisationInvites eventId={eventId} path={path} />;
}

// Host-side invite manager for an OPEN championship: search the master institution
// list and send the request straight to the org. Reused in the create wizard's
// Invite step and the Invite tab.
function OrganisationInvites({ eventId, path }: { eventId: string; path: string }) {
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

      {/* Applications live beside invitations, because they are the same question
          asked from the other side: who is in. They used to sit on a separate
          Entrants tab, which meant an organiser deciding the field had to work in
          two places and could see only half of it in each. */}
      <ApplicationsQueue eventId={eventId} />

      {isLoading ? <Spinner /> : invites.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-800 dark:text-slate-500">
          No organizations yet. Add at least two to auto-generate fixtures - or invite them later.
        </div>
      ) : (
        <div className="space-y-2">
          {invites.map((inv) => (
            <Card key={inv.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-800 dark:text-slate-200">{inv.target ?? inv.organizations?.name ?? inv.org_name}</div>
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
