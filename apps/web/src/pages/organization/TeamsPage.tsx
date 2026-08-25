import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { titleCase } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { api } from '../../lib/api';
import { useFilterBar, usePageFilters } from '../../lib/filters';
import { useApi, useApiMutation, useTableControls } from '../../lib/hooks';
import { Button, Card, Checkbox, EmptyState, Field, Input, ListToolbar, Modal, PageHeader, Pagination, SearchInput, Select, Skeleton, SortDirButton, Spinner, StatusBadge } from '../../components/ui';

// A roster can be entered into several championships; these read its team_entries.
function teamEntries(team: any): any[] { return team.team_entries ?? []; }
function teamChampIds(team: any): string[] { return teamEntries(team).map((e: any) => e.championship_id); }
function teamChampNames(team: any): string { return teamEntries(team).map((e: any) => e.championships?.name).filter(Boolean).join(' '); }
function teamTournaments(team: any): { id: string; name: string }[] {
  const map = new Map<string, string>();
  for (const e of teamEntries(team)) {
    const t = e.tournament_disciplines?.tournament_sports?.tournaments;
    if (t?.id && t?.name) map.set(t.id, t.name);
  }
  return [...map.entries()].map(([id, name]) => ({ id, name }));
}

function drawLabel(d: any): string {
  const tournament = d.tournament_sports?.tournaments?.name;
  const sport = d.tournament_sports?.sports?.name ?? 'Sport';
  const disc = d.disciplines?.name;
  const sportDisc = disc ? `${sport} · ${disc}` : sport;
  return tournament ? `${tournament} · ${sportDisc}` : sportDisc;
}

// Discipline meta shown in team-entry pickers: squad range + (effective) format.
function squadText(d: any): string {
  const min = d.squad_min ?? d.disciplines?.squad_min ?? 1;
  const max = d.squad_max ?? d.disciplines?.squad_max ?? 15;
  return `squad ${min}–${max}`;
}
function drawFormatName(d: any, formats: any[]): string | null {
  const id = d.format_id ?? d.tournament_sports?.format_id;
  return formats.find((f) => f.id === id)?.name ?? null;
}

// Enter one team for every selected discipline in a single action.
function BulkCreateTeamsModal({ approved, organization, defaultEnrollmentId, onClose }:
  { approved: any[]; organization: any; defaultEnrollmentId?: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [enrollmentId, setEnrollmentId] = useState(defaultEnrollmentId ?? approved[0]?.id ?? '');
  const enrollment = approved.find((e) => e.id === enrollmentId);
  const eventId = enrollment?.championship_id;
  const { data: draws = [], isLoading } = useApi<any[]>(eventId ? `/championships/${eventId}/draws` : null);
  const { data: formats = [] } = useApi<any[]>('/tournament-formats');
  const { data: existing = [] } = useApi<any[]>(organization?.id ? `/teams?organization_id=${organization.id}` : null);

  // Don't offer draws this organization has already entered for this championship.
  const takenDrawIds = useMemo(
    () => new Set(
      existing
        .flatMap((t: any) => (t.team_entries ?? []) as any[])
        .filter((e) => e.championship_id === eventId)
        .map((e) => e.tournament_discipline_id)
        .filter(Boolean),
    ),
    [existing, eventId],
  );
  const available = useMemo(() => draws.filter((d) => !takenDrawIds.has(d.id)), [draws, takenDrawIds]);
  const tournamentNames = useMemo(
    () => [...new Set(draws.map((d) => d.tournament_sports?.tournaments?.name).filter(Boolean))],
    [draws],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const short = organization?.short_name || organization?.name || 'Team';
  // Default team name keeps the championship name (not the sport - the discipline row
  // already shows that); a sub-discipline like "Men's"/"Women's" is appended so two
  // teams in the same sport stay distinct.
  const champName = enrollment?.championships?.name ?? '';
  const defaultName = (d: any) => `${short} ${champName}${d.disciplines?.name ? ` ${d.disciplines.name}` : ''}`.replace(/\s+/g, ' ').trim();

  const create = useApiMutation<{ teams: any[] }, { created: number; teams: any[] }>(
    (body) => api('POST', '/teams/bulk', body),
    ['/me/teams', `/teams?organization_id=${organization?.id}`],
  );

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allChecked = available.length > 0 && selected.size === available.length;

  const submit = () => {
    setError(null);
    if (!enrollment || selected.size === 0) { setError('Select at least one discipline'); return; }
    const teams = available.filter((d) => selected.has(d.id)).map((d) => ({
      championship_id: enrollment.championship_id,
      organization_id: organization.id,
      championship_organization_id: enrollment.id,
      sport_id: d.tournament_sports.sport_id,
      tournament_discipline_id: d.id,
      name: defaultName(d),
    }));
    create.mutate({ teams }, {
      onSuccess: (r) => { if (r.teams?.[0]) navigate(`/organizations/${organization.id}/teams/${r.teams[0].id}`); else onClose(); },
      onError: (e: any) => setError(e.message),
    });
  };

  return (
    <Modal title="Enter multiple teams" onClose={onClose} wide>
      <Field label="Championship">
        <Select value={enrollmentId} onChange={(e) => { setEnrollmentId(e.target.value); setSelected(new Set()); }}>
          {approved.map((e) => <option key={e.id} value={e.id}>{e.championships?.name}</option>)}
        </Select>
      </Field>
      {eventId && tournamentNames.length > 0 && (
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
          Season{tournamentNames.length > 1 ? 's' : ''}:{' '}
          <span className="font-semibold text-slate-700 dark:text-slate-200">{tournamentNames.join(', ')}</span>
        </p>
      )}
      <div className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Disciplines</div>
      {isLoading ? <Spinner /> : available.length === 0 ? (
        <p className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">
          {draws.length === 0 ? 'No disciplines configured for this championship yet. The organiser must add draws in Setup before teams can be entered.' : 'You have already entered every available discipline.'}
        </p>
      ) : (
        <div className="max-h-72 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <label className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
            <Checkbox checked={allChecked} indeterminate={selected.size > 0 && !allChecked}
              onChange={(v) => setSelected(v ? new Set(available.map((d) => d.id)) : new Set())} />
            Select all ({available.length})
          </label>
          {available.map((d) => (
            <label key={d.id} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 dark:border-slate-800 px-4 py-2.5 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/60">
              <Checkbox checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{drawLabel(d)}</div>
                <div className="truncate text-xs text-slate-400 dark:text-slate-500">{d.entry_type} · {squadText(d)}{drawFormatName(d, formats) ? ` · ${drawFormatName(d, formats)}` : ''} · {defaultName(d)}</div>
              </div>
            </label>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm text-slate-500 dark:text-slate-400">{selected.size} selected</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={selected.size === 0 || create.isPending} onClick={submit}>{create.isPending ? 'Creating…' : `Create ${selected.size || ''} team${selected.size === 1 ? '' : 's'}`}</Button>
        </div>
      </div>
    </Modal>
  );
}

// Create a team as a standalone organization asset - just a name and sport. Rendered
// inline (not a popup) so it sits right in the Teams list. It's entered into a
// championship & discipline later from the team page.
function InlineCreateTeam({ institutionId, onClose }: { institutionId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: sports = [] } = useApi<any[]>('/sports');
  const [name, setName] = useState('');
  const [sportId, setSportId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useApiMutation(
    (body: any) => api('POST', '/teams', body),
    ['/me/teams', `/teams?organization_id=${institutionId}`],
    (team: any) => navigate(`/organizations/${institutionId}/teams/${team.id}`),
  );

  const submit = () => {
    setError(null);
    if (!name.trim()) { setError('Team name is required'); return; }
    if (!sportId) { setError('Pick a sport'); return; }
    create.mutate({ name: name.trim(), sport_id: sportId, organization_id: institutionId }, { onError: (e: any) => setError(e.message) });
  };

  return (
    <Card className="mb-4 p-5 ring-1 ring-brand-200 dark:ring-brand-500/30">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">Create a team</h3>
        <button onClick={onClose} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Cancel</button>
      </div>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Add a team for your organization, then enter it into a championship &amp; pick a discipline when you’re ready.</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Team name</span>
          <Input value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. VJTI Titans"
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
        </label>
        <label className="block sm:w-56">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Sport</span>
          <Select value={sportId} onChange={(e) => setSportId(e.target.value)}>
            <option value="">- select a sport -</option>
            {sports.map((s) => <option key={s.id} value={s.id}>{s.icon ? `${s.icon} ` : ''}{s.name}</option>)}
          </Select>
        </label>
        <Button disabled={!name.trim() || !sportId || create.isPending} onClick={submit}>{create.isPending ? 'Creating…' : 'Create team'}</Button>
      </div>
      {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    </Card>
  );
}

export function TeamsPage() {
  const { ctx } = useAuth();
  const { can } = usePermissions();
  const canManage = can('team.manage'); // POC only; captains are read-only
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { orgId } = useParams();
  const institutionId = orgId ?? ctx?.organization?.id ?? ctx?.user.organization_id ?? '';
  // Organization staff see all their organization's teams; a captain with no
  // organization still sees the teams they captain (via /me/teams).
  // The org being viewed - NOT ctx.organization, which is the user's primary org. A POC
  // managing several orgs (IIMB A/B/C) must enter teams against the org in the URL, or the
  // entry modal reads the wrong org's existing teams (and hides every discipline as "taken").
  const { data: viewedOrg } = useApi<any>(institutionId ? `/organizations/${institutionId}` : null);
  const { data: instTeams = [], isLoading: instLoading } = useApi<any[]>(institutionId ? `/teams?organization_id=${institutionId}` : null);
  const { data: myTeams = [], isLoading: myLoading } = useApi<any[]>(institutionId ? null : '/me/teams');
  const teams = institutionId
    ? instTeams
    : myTeams.filter((t) => t.membership_role === 'captain' || t.membership_role === 'vice_captain');
  const isLoading = institutionId ? instLoading : myLoading;
  // Enrollments scoped to THIS org (a user may run several) so "Enter" uses the right
  // approved enrollment - otherwise entering a team can pick another org's enrollment.
  const { data: enrollments = [] } = useApi<any[]>(institutionId ? `/me/enrollments?organization_id=${institutionId}` : '/me/enrollments');
  const approved = enrollments.filter((e) => e.status === 'approved');
  const { eventId, setEventId } = useFilterBar();
  const [tournamentFilter, setTournamentFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [status, setStatus] = useState('all');

  // Approved championships populate the shared header championship filter.
  const eventOptions = useMemo(
    () => approved.map((e) => ({ id: e.championship_id, name: e.championships?.name ?? 'Championship' })),
    [approved],
  );

  const activeEvent = approved.find((e) => e.championship_id === eventId);
  const defaultEnrollmentId = activeEvent?.id;
  const drawsEventId = eventId || approved[0]?.championship_id || null;
  const { data: eventDraws = [] } = useApi<any[]>(drawsEventId ? `/championships/${drawsEventId}/draws` : null);
  const { data: eventTournaments = [] } = useApi<any[]>(eventId ? `/tournaments?championship_id=${eventId}` : null);
  const canEnterTeams = approved.length > 0 && (!eventId || eventDraws.length > 0);

  const tournamentOptions = useMemo(() => {
    if (eventId) {
      return eventTournaments.map((t) => ({ id: t.id, name: t.name }));
    }
    const map = new Map<string, string>();
    for (const t of teams) for (const x of teamTournaments(t)) map.set(x.id, x.name);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [eventId, eventTournaments, teams]);

  // Sports narrow to the selected championship + tournament (cascading); published to header.
  const sportOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teams) {
      if (eventId && !teamChampIds(t).includes(eventId)) continue;
      if (tournamentFilter !== 'all' && !teamTournaments(t).some((x) => x.id === tournamentFilter)) continue;
      if (t.sport_id) map.set(t.sport_id, t.sports?.name ?? 'Sport');
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [teams, eventId, tournamentFilter]);

  // Seed the shared championship filter from a deep link (?championship=…), e.g. "Manage teams".
  useEffect(() => {
    const ev = searchParams.get('championship');
    if (ev) setEventId(ev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Open the create-team panel straight from a deep link (?create=1), e.g. the
  // getting-started checklist's "Create a team" step.
  useEffect(() => {
    if (searchParams.get('create') === '1') setCreating(true);
  }, [searchParams]);

  // Reset the tournament drill-down when the header championship changes.
  useEffect(() => { setTournamentFilter('all'); }, [eventId]);

  // Register the shared Championship + Sport filters; read back the active sport.
  const { sportId } = usePageFilters({
    championships: eventOptions.length ? eventOptions : undefined,
    sports: sportOptions.length ? sportOptions : undefined,
  });

  const statusOptions = useMemo(() => ['all', ...new Set(teams.map((t) => t.status).filter(Boolean))], [teams]);
  const filtered = useMemo(() => {
    let rows = teams;
    if (eventId) rows = rows.filter((t) => teamChampIds(t).includes(eventId));
    if (tournamentFilter !== 'all') rows = rows.filter((t) => teamTournaments(t).some((x) => x.id === tournamentFilter));
    if (sportId) rows = rows.filter((t) => t.sport_id === sportId);
    if (status !== 'all') rows = rows.filter((t) => t.status === status);
    return rows;
  }, [teams, eventId, tournamentFilter, sportId, status]);
  const tc = useTableControls(filtered, {
    search: (t) => `${t.name} ${t.sports?.name ?? ''} ${teamChampNames(t)}`,
    sorts: {
      name: (a, b) => String(a.name).localeCompare(String(b.name)),
      championship: (a, b) => teamChampNames(a).localeCompare(teamChampNames(b)),
    },
    initialSort: 'name',
    pageSize: 12,
  });

  return (
    <div>
      <PageHeader
        title={activeEvent ? `${activeEvent.championships?.name ?? 'Championship'} teams` : 'Teams'}
        subtitle={activeEvent ? 'Teams entered for this championship.' : 'Enter and manage teams across your approved championships.'}
      >
        {canManage && <Button variant="outline" onClick={() => setBulkCreating(true)} disabled={!canEnterTeams}>+ Enter multiple</Button>}
        {canManage && <Button onClick={() => setCreating(true)}>+ Create team</Button>}
      </PageHeader>

      {approved.length === 0 && (
        <p className="mb-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">You need an approved championship registration before entering teams. Apply via “Browse championships”.</p>
      )}
      {approved.length > 0 && eventId && eventDraws.length === 0 && (
        <p className="mb-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          No disciplines are configured for this championship yet. The organiser must add discipline draws in Setup before you can enter teams or assign players.
        </p>
      )}

      {creating && institutionId && <InlineCreateTeam institutionId={institutionId} onClose={() => setCreating(false)} />}

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="space-y-3 p-4">
              <div className="flex items-start justify-between"><Skeleton className="h-10 w-10" rounded="rounded-xl" /><Skeleton className="h-5 w-16" rounded="rounded-full" /></div>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </Card>
          ))}
        </div>
      ) : teams.length === 0 && !eventId ? (
        <EmptyState icon="⚇" title="No teams yet" description="Create a team for your organization, then assign it to a championship."
          action={canManage ? <Button onClick={() => setCreating(true)}>+ Create team</Button> : undefined} />
      ) : (
        <>
          <ListToolbar>
            <SearchInput value={tc.query} onChange={tc.setQuery} placeholder="Search teams…" className="w-full sm:w-64" />
            {tournamentOptions.length > 0 && (
              <Select value={tournamentFilter} onChange={(e) => setTournamentFilter(e.target.value)} className="w-auto min-w-[11rem]">
                <option value="all">All seasons</option>
                {tournamentOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            )}
            {statusOptions.length > 2 && (
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
                {statusOptions.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : titleCase(String(s))}</option>)}
              </Select>
            )}
            <Select value={tc.sortKey} onChange={(e) => tc.setSortKey(e.target.value)} className="w-auto">
              <option value="name">Sort: Name</option>
              <option value="championship">Sort: Championship</option>
            </Select>
            <SortDirButton dir={tc.dir} onToggle={() => tc.setDir(tc.dir === 'asc' ? 'desc' : 'asc')} />
          </ListToolbar>
          {tc.total === 0 ? (
            <EmptyState
              icon="⚇"
              title={eventId || tournamentFilter !== 'all' ? 'No teams match these filters' : 'No matching teams'}
              description={eventId ? 'Enter a team to participate in this championship, or try a different filter.' : 'Try a different search or filter.'}
              action={canManage && tournamentFilter === 'all' ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => setCreating(true)}>+ Create team</Button>
                  {eventId && canEnterTeams && <Button variant="outline" onClick={() => setBulkCreating(true)}>+ Enter multiple</Button>}
                </div>
              ) : undefined}
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tc.view.map((t) => (
                  <Card key={t.id} className="cursor-pointer p-4 transition hover:border-brand-300 dark:hover:border-brand-500/50 hover:shadow-md" onClick={() => navigate(`/organizations/${institutionId}/teams/${t.id}`)}>
                    <div className="flex items-start justify-between">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 dark:bg-brand-500/10 text-lg">{t.sports?.icon ?? '◇'}</span>
                      <StatusBadge status={t.status} />
                    </div>
                    <h3 className="mt-3 font-semibold text-slate-900 dark:text-slate-100">{t.name}</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{t.sports?.name}</p>
                    <div className="mt-1.5">
                      {teamEntries(t).length === 0
                        ? <span className="text-xs text-amber-600 dark:text-amber-400">Not entered yet</span>
                        : <span className="text-xs text-slate-500 dark:text-slate-400">Entered in {teamEntries(t).length} championship{teamEntries(t).length === 1 ? '' : 's'}</span>}
                    </div>
                    <div className="mt-2">
                      <p className="text-xs text-slate-400 dark:text-slate-500">{t.team_members?.length ?? 0} member{(t.team_members?.length ?? 0) === 1 ? '' : 's'}</p>
                    </div>
                  </Card>
                ))}
              </div>
              <Pagination page={tc.page} pageCount={tc.pageCount} total={tc.total} pageSize={tc.pageSize} onPage={tc.setPage} />
            </>
          )}
        </>
      )}

      {bulkCreating && institutionId && <BulkCreateTeamsModal approved={approved} organization={viewedOrg ?? (ctx?.organization?.id === institutionId ? ctx.organization : { id: institutionId })} defaultEnrollmentId={defaultEnrollmentId} onClose={() => setBulkCreating(false)} />}
    </div>
  );
}
