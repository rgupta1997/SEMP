import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Upload, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useApi, useTableControls } from '../../lib/hooks';
import { usePermissions } from '../../lib/permissions';
import { useWorkspace } from '../../lib/useWorkspace';
import { api } from '../../lib/api';
import { AddPlayersModal } from '../../components/AddPlayersModal';
import { pluralise } from '@semp/shared';
import { useOrgUnits, unitPath } from '../../lib/units';
import { titleCase } from '../../lib/format';
import {
  Avatar, Badge, BulkBar, Button, Checkbox, EmptyState, PageHeader, Pagination,
  Modal, SearchInput, Select, cn, confirmDialog, toast, SURFACE, FilterChips,
} from '../../components/ui';
import { DataList, FilterBar, QueryState, SkeletonList, useUrlState } from '../../components/primitives';

// Where somebody is PLACED is now a competitive fact, not filing.
//
// A player can only be picked for the campus or department they belong to, so an
// unplaced person cannot be selected for any intra-organisation squad. That makes
// this column the thing an organiser has to fix before an internal championship can
// be run at all - which is why it is editable in place here, and in bulk, rather
// than only at import time.
/** Add many people to one unit. Additive - it never removes anything they have. */
function addToUnit(orgId: string, unitId: string, userIds: string[]) {
  return api('POST', `/organizations/${orgId}/units/${unitId}/members`, { user_ids: userIds });
}

/** Replace one person's whole set of units. */
function setUnits(orgId: string, userId: string, unitIds: string[]) {
  return api('PUT', `/organizations/${orgId}/people/${userId}/units`, { unit_ids: unitIds });
}

/**
 * Which campuses and departments one person belongs to.
 *
 * A checklist rather than a picker, because the answer is a set: a student is in a
 * campus AND a programme AND an intake year, and each of those makes them eligible
 * for a different squad. Saved as a replace - the dialog shows the complete
 * intended state, so sending deltas from it is how the two drift apart.
 */
function PlacementModal({ orgId, person, units, labels, onClose, onSaved }: {
  orgId: string;
  person: Person;
  units: Array<{ id: string; name: string; type: string; parent: { name: string } | null }>;
  labels: { campus: string; department: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set(person.units.map((u) => u.id)));
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => setChosen((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const save = async () => {
    setBusy(true);
    try {
      await setUnits(orgId, person.user_id, [...chosen]);
      toast.success(`${person.name ?? 'Placement'} updated`);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save that placement');
    } finally { setBusy(false); }
  };

  return (
    <Modal
      title={`Where does ${person.name ?? 'this person'} belong?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
        Tick every {labels.campus.toLowerCase()} and {labels.department.toLowerCase()} they are part of.
        They can be picked for a squad of any of them, and only those.
      </p>
      {units.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No {labels.campus.toLowerCase()} exists yet — add one on the Campuses &amp; Units screen.
        </p>
      ) : (
        <div className="grid max-h-[24rem] gap-1 overflow-y-auto">
          {units.map((u) => (
            <label
              key={u.id}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13.5px] transition',
                chosen.has(u.id)
                  ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/25'
                  : 'border-slate-200 dark:border-slate-800',
                u.parent && 'ml-5',
              )}
            >
              <input type="checkbox" className="accent-brand-600" checked={chosen.has(u.id)} onChange={() => toggle(u.id)} />
              <span className="min-w-0">
                <span className="block font-medium text-slate-800 dark:text-slate-100">{u.name}</span>
                <span className="block font-mono text-[9px] uppercase tracking-[0.12em] text-slate-400">
                  {u.type === 'campus' ? labels.campus : `${labels.department} · ${u.parent?.name ?? ''}`}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}

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
  /** Every campus and department this person belongs to - placement is a set. */
  units: Array<{ id: string; name: string | null; type: string | null }>;
  org_unit_names: string | null;
  sportagon_id: string | null;
  sports: number;
  /** Which sports they have played for this institution - the sport filter reads this. */
  sport_names: string[];
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
  // PER ACTION, not one `canManage`.
  //
  // This screen used to gate everything on `canManageOrg` - `org.manage` - which a
  // Sports Admin does not hold, so the whole of Players was read-only for the role
  // whose description is "runs sport day to day ... people, teams, events". The nav
  // offered it and every control on it was hidden. The catalogue already splits these
  // three, and they are genuinely different risks: `people.import` is a file that can
  // create hundreds against a duplicate-matching rule, `people.verify` decides who is
  // a real member of the institution, and `people.edit` is one row at a time.
  const perms = usePermissions();
  const canEditPeople = perms.hasOrgPermission('people.edit', orgId);
  const canImport = perms.hasOrgPermission('people.import', orgId);
  const canVerify = perms.hasOrgPermission('people.verify', orgId);
  // Selection exists to drive the bulk bar, so the checkbox column and the Actions
  // column appear when there is at least one bulk action behind them. Without this a
  // reader gets two empty columns and a table that reflows for nothing.
  const canSelect = canVerify || canEditPeople;
  const ws = useWorkspace();

  const { data: people = [], isLoading, isError, error, refetch } = useApi<Person[]>(orgId ? `/organizations/${orgId}/people` : null);
  const { flat: unitOptions, labels: unitLabels } = useOrgUnits(orgId);
  const [placing, setPlacing] = useState<Person | null>(null);
  // FILTERS THAT MATCH THE QUESTION THIS SCREEN ANSWERS.
  //
  // There was a third dropdown here, "All sports", and it was the wrong axis. This
  // is the people directory - it answers "who belongs to this institution, and
  // where do they sit in it", which is the question asked when somebody has to be
  // found, verified, chased or picked. Sport is a fact about PARTICIPATION, it
  // belongs to the records surfaces, and as a filter here it competed for width
  // with the two axes that do matter. Sport names are still searchable, so nothing
  // became unreachable - it stopped being a dropdown.
  //
  // Campus and batch are the two, and they are in the URL rather than in useState:
  // opening a player and pressing Back returned you to an unfiltered list at page
  // one, which on a 200-person roll means finding your place again by hand.
  const [filter, setFilter] = useUrlState<string>('status', 'all');
  const [campusId, setCampusId] = useUrlState<string>('campus', '');
  const [deptId, setDeptId] = useUrlState<string>('batch', '');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const campuses = useMemo(() => unitOptions.filter((u) => u.type === 'campus'), [unitOptions]);
  // Departments narrow to the chosen campus, so the second dropdown never offers a
  // batch that would return nobody once the first one is set.
  const departments = useMemo(
    () => unitOptions.filter((u) => u.type === 'department' && (!campusId || u.parent?.id === campusId)),
    [unitOptions, campusId],
  );

  // A person placed in a batch is in its campus whether or not somebody also ticked
  // the campus itself - placement is entered per unit, and a campus filter that
  // missed the batches under it would report an empty campus that is full.
  const campusOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of unitOptions) m.set(u.id, u.type === 'campus' ? u.id : (u.parent?.id ?? u.id));
    return m;
  }, [unitOptions]);

  // Everything except the verification chips, so the chip counts describe the list
  // the chips are sitting on rather than the whole roll.
  const scoped = useMemo(() => people.filter((p) => {
    if (campusId && !p.units.some((u) => campusOf.get(u.id) === campusId)) return false;
    if (deptId && !p.units.some((u) => u.id === deptId)) return false;
    return true;
  }), [people, campusId, deptId, campusOf]);

  // Shown on the Filters button so the count is never a mystery, and cleared in
  // one place rather than by resetting each dropdown to its own "All".
  const activeFilters = (campusId ? 1 : 0) + (deptId ? 1 : 0);
  const clearFilters = () => { setCampusId(''); setDeptId(''); setSelected(new Set()); };

  const counts = useMemo(() => ({
    all: scoped.length,
    pending: scoped.filter((p) => p.verification === 'pending').length,
    verified: scoped.filter((p) => p.verification === 'verified').length,
    rejected: scoped.filter((p) => p.verification === 'rejected').length,
  }), [scoped]);

  const rows = useMemo(
    () => scoped.filter((p) => filter === 'all' || p.verification === filter),
    [scoped, filter],
  );

  const tc = useTableControls(rows, {
    search: (p) => [p.name, p.email, p.phone, p.member_code, p.sportagon_id, p.org_unit_names, (p.sport_names ?? []).join(' ')]
      .filter(Boolean).join(' '),
    sorts: { name: (a, b) => (a.name ?? '').localeCompare(b.name ?? '') },
    initialSort: 'name',
    pageSize: 20,
  });

  // A batch belongs to one campus, so a campus change can leave the second dropdown
  // holding a batch that is no longer on offer - and a filter pair that cannot match
  // anything reads as "nobody here" rather than as a stale control.
  useEffect(() => {
    if (deptId && !departments.some((d) => d.id === deptId)) setDeptId('');
  }, [departments, deptId]);

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

  // A page-wide `<Spinner/>` for a screen whose shape is entirely known, and no
  // branch at all for a failed request - `people` fell through to [] and the
  // honest-looking "Nobody here yet" was rendered over a roll of two hundred.
  if (isLoading || isError) {
    return (
      <div>
        <PageHeader title="Players" subtitle="Everyone who belongs to this organisation." />
        <QueryState query={{ isLoading, isError, error, refetch }} errorTitle="Could not load the directory"
          skeleton={<SkeletonList rows={8} />}>
          <span />
        </QueryState>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Players" subtitle="Everyone who belongs to this organisation, and what they have played.">
        {canImport && (
          // Icon-only below sm: two full-width buttons under the title cost a whole
          // row of a 390px screen, and "Bulk upload" is not a word anybody needs
          // read to them next to an upload arrow.
          <Button variant="outline" aria-label="Bulk upload" onClick={() => navigate(`/organizations/${orgId}/students/import`)}>
            <Upload size={15} /> <span className="hidden sm:inline">Bulk upload</span>
          </Button>
        )}
        {canEditPeople && (
          <Button onClick={() => setAdding(true)}>
            <UserPlus size={15} /> <span className="hidden sm:inline">Add Person</span><span className="sm:hidden">Add</span>
          </Button>
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
          action={canEditPeople || canImport ? (
            <div className="flex flex-wrap justify-center gap-2">
              {canEditPeople && <Button onClick={() => setAdding(true)}>Add a player</Button>}
              {canImport && (
                <Button variant="outline" onClick={() => navigate(`/organizations/${orgId}/students/import`)}>Import a roll</Button>
              )}
            </div>
          ) : undefined}
        />
      ) : tc.total === 0 ? (
        <EmptyState icon={<Users size={24} />} title="Nobody matches" description="Try another filter, or a different search." />
      ) : (
        <>
          <FilterBar
            activeCount={activeFilters}
            onClear={clearFilters}
            search={
              <SearchInput
                value={tc.query}
                onChange={tc.setQuery}
                placeholder="Search name, ID, email, sport…"
                className="w-full"
              />
            }
          >
            {/* The org's own nouns, not ours: a college reads "Batch" here and a
                company reads "Department", from the same two dropdowns. Each is
                offered only when the structure actually has that level. */}
            {campuses.length > 0 && (
              <Select
                value={campusId}
                onChange={(e) => { setCampusId(e.target.value); setSelected(new Set()); }}
                className="w-auto"
                aria-label={`Filter by ${unitLabels.campus.toLowerCase()}`}
              >
                <option value="">All {pluralise(unitLabels.campus).toLowerCase()}</option>
                {campuses.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            )}
            {departments.length > 0 && (
              <Select
                value={deptId}
                onChange={(e) => { setDeptId(e.target.value); setSelected(new Set()); }}
                className="w-auto"
                aria-label={`Filter by ${unitLabels.department.toLowerCase()}`}
              >
                <option value="">All {pluralise(unitLabels.department).toLowerCase()}</option>
                {departments.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            )}
          </FilterBar>

          {canSelect && (
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
              {canVerify && (
                <>
                  <Button size="sm" disabled={busy} onClick={() => review([...selected], 'verified', selectedLabel)}>
                    Verify {selected.size}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => review([...selected], 'rejected', selectedLabel)}>
                    Reject {selected.size}
                  </Button>
                </>
              )}
              {/* Placing a whole intake at once. The commonest shape of this job is
                  "these 120 people are all Bangalore", and doing it a row at a time
                  is how it does not get done.

                  ADD, not move: somebody already in a department stays in it and
                  gains the campus too. Removing is a per-person act, done from the
                  row, because "take 120 people out of something" is rarely what
                  anybody means and is expensive to undo. */}
              {canEditPeople && unitOptions.length > 0 && (
                <Select
                  aria-label={`Add ${selected.size} to a ${unitLabels.campus.toLowerCase()}`}
                  className="min-w-[11rem] text-[13px]"
                  value=""
                  disabled={busy}
                  onChange={async (e) => {
                    const unitId = e.target.value;
                    if (!unitId) return;                    // the placeholder
                    const ids = [...selected];
                    setBusy(true);
                    try {
                      const r: any = await addToUnit(orgId, unitId, ids);
                      toast.success(`Added ${r?.added ?? ids.length} ${(r?.added ?? ids.length) === 1 ? 'person' : 'people'}`);
                      setSelected(new Set());
                      await refetch();
                    } catch (err: any) {
                      toast.error(err?.message ?? 'Could not add those people');
                    } finally { setBusy(false); }
                  }}
                >
                  <option value="">Add {selected.size} to…</option>
                  {unitOptions.map((u) => (
                    <option key={u.id} value={u.id}>{unitPath(u, u.parent)}</option>
                  ))}
                </Select>
              )}
            </BulkBar>
          )}

          {/* ONE COLUMN SPEC, TWO SHAPES.
              This was a seven-column <table> in an `overflow-x-auto` div, which is
              not a mobile treatment - it is a desktop table you have to drag
              sideways, and the two columns that matter on a phone (status, and the
              Verify/Reject buttons) were the two furthest off-screen. `DataList`
              renders the same records as stacked cards below sm and as this table
              at sm+, from one spec, so the two cannot disagree about what a row
              contains. */}
          <DataList
            rows={tc.view}
            rowKey={(row) => row.id}
            caption="People in this organisation"
            columns={[
              ...(canSelect ? [{
                key: 'select',
                header: <Checkbox checked={allSelected} indeterminate={selected.size > 0} onChange={toggleAll} />,
                className: 'w-px',
                // Selection is a bulk-action affordance and belongs to the table;
                // on a phone the card itself is the target, so it is desktop-only.
                desktopOnly: true,
                render: (row: Person) => <Checkbox checked={selected.has(row.id)} onChange={() => toggle(row.id)} />,
              }] : []),
              {
                key: 'player',
                header: 'Person',
                primary: true,
                render: (row: Person) => (
                  <div className="flex items-center gap-3">
                    <Avatar name={row.name ?? '?'} size={32} />
                    <div className="min-w-0">
                      <Link
                        to={`/organizations/${orgId}/people/${row.user_id}`}
                        className="truncate font-semibold text-slate-900 hover:text-brand-600 dark:text-slate-100"
                      >
                        {row.name ?? 'Unnamed'}
                      </Link>
                      <div className="t-meta truncate">
                        {row.member_code ? `${row.member_code} · ` : ''}{row.email ?? row.phone ?? 'No contact'}
                      </div>
                    </div>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (row: Person) => <Badge tone={VERIFY_TONE[row.verification] ?? 'slate'}>{titleCase(row.verification)}</Badge>,
              },
              {
                key: 'units',
                header: `${unitLabels.campus} & ${unitLabels.department}`,
                render: (row: Person) => (
                  /* Chips rather than a dropdown: a person is in SEVERAL units, and
                     a single-value control cannot show that, let alone edit it. */
                  <div className="flex flex-wrap items-center gap-1.5">
                    {row.units.length === 0
                      ? <span className="text-slate-400">Not placed</span>
                      : row.units.map((u) => (
                        <span key={u.id} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {u.name}
                        </span>
                      ))}
                    {canEditPeople && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(e) => { e.stopPropagation(); setPlacing(row); }}
                        className="tap text-xs font-semibold text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400"
                      >Edit</button>
                    )}
                  </div>
                ),
              },
              {
                key: 'sportagon',
                header: 'Sportagon ID',
                render: (row: Person) => (
                  <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                    {row.sportagon_id ?? <span className="text-slate-400">—</span>}
                  </span>
                ),
              },
              {
                key: 'sports',
                header: 'Sports',
                align: 'right' as const,
                // A count with no context is a desktop column, not a phone field:
                // "Sports 0" spends a whole card row saying nothing the reader can
                // act on. Both live on the player's own page.
                desktopOnly: true,
                render: (row: Person) => <span className="t-num font-mono text-[13px] text-slate-700 dark:text-slate-300">{row.sports}</span>,
              },
              {
                key: 'events',
                header: 'Events',
                align: 'right' as const,
                desktopOnly: true,
                render: (row: Person) => <span className="t-num font-mono text-[13px] text-slate-700 dark:text-slate-300">{row.events}</span>,
              },
              ...(canVerify ? [{
                key: 'actions',
                header: '',
                align: 'right' as const,
                className: 'w-px',
                actions: true,
                render: (row: Person) => (row.verification === 'pending' ? (
                  <div className="flex flex-1 items-center gap-2 sm:justify-end">
                    <Button size="sm" variant="outline" className="flex-1 sm:flex-none" disabled={busy}
                      onClick={() => review([row.id], 'verified', `“${row.name ?? 'this person'}”`)}>Verify</Button>
                    <Button size="sm" variant="ghost" className="flex-1 sm:flex-none" disabled={busy}
                      onClick={() => review([row.id], 'rejected', `“${row.name ?? 'this person'}”`)}>Reject</Button>
                  </div>
                ) : null),
              }] : []),
            ]}
          />
          <Pagination page={tc.page} pageCount={tc.pageCount} total={tc.total} pageSize={tc.pageSize} onPage={tc.setPage} />
        </>
      )}

      {placing && (
        <PlacementModal
          orgId={orgId}
          person={placing}
          units={unitOptions}
          labels={unitLabels}
          onClose={() => setPlacing(null)}
          onSaved={() => { setPlacing(null); refetch(); }}
        />
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
