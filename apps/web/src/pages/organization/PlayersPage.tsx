import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Upload, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useApi, useTableControls } from '../../lib/hooks';
import { usePermissions } from '../../lib/permissions';
import { useWorkspace } from '../../lib/useWorkspace';
import { api } from '../../lib/api';
import { AddPlayersModal } from '../../components/AddPlayersModal';
import {
  Avatar, Badge, BulkBar, Button, Checkbox, EmptyState, ListToolbar, PageHeader, Pagination,
  SearchInput, Spinner, confirmDialog, toast, SURFACE, FilterChips,
} from '../../components/ui';

// The player directory (PG-21).
//
// One row per person, not per team. The Teams page already answers "who is in this
// squad"; this answers "who do we have", which is a different question and the one
// an administrator asks when somebody has to be found, verified or chased.
//
// The Sportagon ID is on every row deliberately. It is what makes this person the
// same person at their next institution, and an administrator who never sees it
// has no way to understand why a transfer keeps their record.
//
// Verification is selectable in bulk because that is the shape of the job: a roll
// import lands hundreds of pending rows at once and confirming them one at a time
// is not a workflow. The server has always taken a list; this screen was the only
// thing insisting on sending one id at a time.

interface Person {
  id: string;
  user_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  member_code: string | null;
  verification: string;
  org_unit_name: string | null;
  sportagon_id: string | null;
  sports: number;
  events: number;
}

const VERIFY_TONE: Record<string, 'green' | 'amber' | 'rose' | 'slate'> = {
  verified: 'green', pending: 'amber', rejected: 'rose', unverified: 'slate',
};

const FILTERS = [
  { key: 'all', label: 'Everyone' },
  { key: 'pending', label: 'Awaiting verification' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
] as const;

export function PlayersPage() {
  const { ctx } = useAuth();
  const navigate = useNavigate();
  const { orgId: routeOrgId } = useParams();
  const orgId = routeOrgId ?? ctx?.organization?.id ?? ctx?.user.organization_id ?? '';
  const canManage = usePermissions().canManageOrg(orgId);
  const ws = useWorkspace();

  const { data: people = [], isLoading, refetch } = useApi<Person[]>(orgId ? `/organizations/${orgId}/people` : null);
  const [filter, setFilter] = useState<string>('all');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const counts = useMemo(() => ({
    all: people.length,
    pending: people.filter((p) => p.verification === 'pending').length,
    verified: people.filter((p) => p.verification === 'verified').length,
    rejected: people.filter((p) => p.verification === 'rejected').length,
  }), [people]);

  const rows = useMemo(
    () => people.filter((p) => filter === 'all' || p.verification === filter),
    [people, filter],
  );

  const tc = useTableControls(rows, {
    search: (p) => [p.name, p.email, p.phone, p.member_code, p.sportagon_id, p.org_unit_name]
      .filter(Boolean).join(' '),
    sorts: { name: (a, b) => (a.name ?? '').localeCompare(b.name ?? '') },
    initialSort: 'name',
    pageSize: 20,
  });

  // A selection has to mean the rows it was made on. After a refetch - or after
  // somebody is verified out of the filter they were selected under - an id that
  // no longer exists here would silently ride along into the next bulk action.
  useEffect(() => {
    setSelected((s) => {
      if (s.size === 0) return s;
      const live = new Set(people.map((p) => p.id));
      const next = new Set([...s].filter((id) => live.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [people]);

  // The header checkbox means EVERY row this filter and search match, not the
  // twenty of them this page happens to show. It used to mean the page, with a
  // "select all 50" link beside it - and the first person to use it read the 50,
  // believed it, and verified the page. A count on screen that is not the count
  // the button acts on is not a nicety to get wrong.
  const allIds = tc.all.map((p) => p.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const pageSelected = tc.view.length > 0 && tc.view.every((p) => selected.has(p.id));

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allIds));
  const selectPage = () => setSelected(new Set(tc.view.map((p) => p.id)));

  /**
   * One call whether it is one person or four hundred: the endpoint has always
   * taken a list, audits each transition separately, and reports how many it
   * actually changed rather than how many were asked for.
   */
  async function review(ids: string[], verification: 'verified' | 'rejected', subject: string) {
    const ok = await confirmDialog({
      title: verification === 'verified' ? `Verify ${subject}?` : `Reject ${subject}?`,
      message: verification === 'verified'
        ? `${subject} will be confirmed as belonging to your organisation. Every verification is recorded against your name.`
        : `${subject} will be marked as not belonging to your organisation. They keep their account and their record; they simply are not yours.`,
      confirmLabel: verification === 'verified' ? 'Verify' : 'Reject',
      tone: verification === 'verified' ? 'primary' : 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api<{ requested: number; matched: number; changed: number; already: number }>(
        'POST', `/organizations/${orgId}/people/verify`, { member_ids: ids, verification },
      );
      // Said plainly rather than folded into the count: somebody who selected 50
      // and changed 19 must be told what happened to the other 31, and an id the
      // server could not match at all is a bug worth surfacing, not swallowing.
      const missed = ids.length - res.matched;
      toast.success(
        `${res.changed} of ${ids.length} ${ids.length === 1 ? 'person' : 'people'} ${verification === 'verified' ? 'verified' : 'rejected'}`,
        [
          res.already ? `${res.already} ${res.already === 1 ? 'was' : 'were'} already ${verification}.` : null,
          missed > 0 ? `${missed} could not be found in this organisation.` : null,
        ].filter(Boolean).join(' ') || undefined,
      );
      setSelected(new Set());
      await refetch();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Named in the confirmation so the number being acted on is stated once more,
  // in the one place that cannot be misread as a link to something else.
  const selectedLabel = selected.size === tc.total && tc.total > 0
    ? `all ${tc.total} ${tc.total === 1 ? 'person' : 'people'} matching this view`
    : `${selected.size} ${selected.size === 1 ? 'person' : 'people'}`;

  if (isLoading) return <Spinner />;

  return (
    <div className="pb-20">
      <PageHeader title="Players" subtitle="Everyone who belongs to this organisation, and what they have played.">
        {canManage && (
          <>
            <Button variant="outline" onClick={() => navigate(`/organizations/${orgId}/students/import`)}>
              <Upload size={15} /> Bulk upload
            </Button>
            <Button onClick={() => setAdding(true)}>
              <UserPlus size={15} /> Add player
            </Button>
          </>
        )}
      </PageHeader>

      <FilterChips
        value={filter}
        onChange={(v) => { setFilter(v); setSelected(new Set()); }}
        options={FILTERS.map((f) => ({ key: f.key, label: f.label, count: counts[f.key as keyof typeof counts] }))}
      />

      {people.length === 0 ? (
        <EmptyState
          icon={<Users size={24} />}
          title="Nobody here yet"
          description="Import a roll, or add people one at a time. Anyone signing up on your email domain lands here too."
          action={canManage ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setAdding(true)}>Add a player</Button>
              <Button variant="outline" onClick={() => navigate(`/organizations/${orgId}/students/import`)}>Import a roll</Button>
            </div>
          ) : undefined}
        />
      ) : tc.total === 0 ? (
        <EmptyState icon={<Users size={24} />} title="Nobody matches" description="Try another filter, or a different search." />
      ) : (
        <>
          <ListToolbar>
            <SearchInput
              value={tc.query}
              onChange={tc.setQuery}
              placeholder="Search by name, ID, email or roll number…"
              className="w-full sm:w-96"
            />
          </ListToolbar>

          {canManage && (
            <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
              {/* Both narrowings are offered as ACTIONS, and neither is a bare
                  number that could be mistaken for what is already selected. */}
              {!allSelected && (
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(allIds))}>
                  Select all {tc.total}
                </Button>
              )}
              {!pageSelected && tc.pageCount > 1 && (
                <Button size="sm" variant="ghost" onClick={selectPage}>
                  Just this page
                </Button>
              )}
              <Button size="sm" disabled={busy} onClick={() => review([...selected], 'verified', selectedLabel)}>
                Verify {selected.size}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => review([...selected], 'rejected', selectedLabel)}>
                Reject {selected.size}
              </Button>
            </BulkBar>
          )}

          <div className={`overflow-x-auto ${SURFACE}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left font-mono text-[9px] uppercase tracking-[0.13em] text-slate-500 dark:border-slate-800">
                  {canManage && (
                    <th className="w-px px-4 py-3">
                      <Checkbox checked={allSelected} indeterminate={selected.size > 0} onChange={toggleAll} />
                    </th>
                  )}
                  <th className="px-4 py-3">Player</th>
                  <th className="px-4 py-3">Sportagon ID</th>
                  <th className="px-4 py-3">Programme</th>
                  <th className="px-4 py-3 text-right">Sports</th>
                  <th className="px-4 py-3 text-right">Events</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {tc.view.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${selected.has(p.id) ? 'bg-brand-50/60 dark:bg-brand-500/10' : ''}`}
                  >
                    {canManage && (
                      <td className="px-4 py-3">
                        <Checkbox checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={p.name ?? '?'} size={32} />
                        <div className="min-w-0">
                          <Link
                            to={`/organizations/${orgId}/people/${p.user_id}`}
                            className="truncate font-semibold text-slate-900 hover:text-brand-600 dark:text-slate-100"
                          >
                            {p.name ?? 'Unnamed'}
                          </Link>
                          <div className="truncate text-xs text-slate-500">
                            {p.member_code ? `${p.member_code} · ` : ''}{p.email ?? p.phone ?? 'No contact'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-slate-600 dark:text-slate-300">
                      {p.sportagon_id ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {p.org_unit_name ?? <span className="text-slate-400">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[13px] text-slate-700 dark:text-slate-300">{p.sports}</td>
                    <td className="px-4 py-3 text-right font-mono text-[13px] text-slate-700 dark:text-slate-300">{p.events}</td>
                    <td className="px-4 py-3">
                      <Badge tone={VERIFY_TONE[p.verification] ?? 'slate'}>{p.verification}</Badge>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {p.verification === 'pending' ? (
                          <>
                            <Button size="sm" variant="outline" disabled={busy}
                              onClick={() => review([p.id], 'verified', `“${p.name ?? 'this person'}”`)}>Verify</Button>
                            <Button size="sm" variant="ghost" disabled={busy}
                              onClick={() => review([p.id], 'rejected', `“${p.name ?? 'this person'}”`)}>Reject</Button>
                          </>
                        ) : null}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={tc.page} pageCount={tc.pageCount} total={tc.total} pageSize={tc.pageSize} onPage={tc.setPage} />
        </>
      )}

      {adding && (
        <AddPlayersModal
          orgId={orgId}
          // Not judged until the entitlement snapshot has actually arrived - a
          // capability note shown while it loads accuses a plan of lacking
          // something it may well have.
          canBulk={ws.loading || ws.granted.has('bulk_player_upload')}
          onClose={() => setAdding(false)}
          onAdded={() => { refetch(); }}
        />
      )}
    </div>
  );
}
