import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { usePermissions } from '../../lib/permissions';
import { api } from '../../lib/api';
import { useFilterBar, usePageFilters } from '../../lib/filters';
import { useApi, useApiMutation, useTableControls } from '../../lib/hooks';
import { Button, Card, Checkbox, EmptyState, Field, Input, ListToolbar, Modal, PageHeader, Pagination, SearchInput, Select, Skeleton, SortDirButton, Spinner, StatusBadge } from '../../components/ui';
import { OrgTabs } from '../../components/OrgTabs';

function tournamentName(team: any): string | null {
  return team.tournament_disciplines?.tournament_sports?.tournaments?.name ?? null;
}

function tournamentId(team: any): string | null {
  return team.tournament_disciplines?.tournament_sports?.tournaments?.id ?? null;
}

function drawLabel(d: any): string {
  const tournament = d.tournament_sports?.tournaments?.name;
  const sport = d.tournament_sports?.sports?.name ?? 'Sport';
  const disc = d.disciplines?.name;
  const sportDisc = disc ? `${sport} · ${disc}` : sport;
  return tournament ? `${tournament} · ${sportDisc}` : sportDisc;
}

// Enter one team for every selected discipline in a single action.
function BulkCreateTeamsModal({ approved, organization, defaultEnrollmentId, onClose }:
  { approved: any[]; organization: any; defaultEnrollmentId?: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [enrollmentId, setEnrollmentId] = useState(defaultEnrollmentId ?? approved[0]?.id ?? '');
  const enrollment = approved.find((e) => e.id === enrollmentId);
  const eventId = enrollment?.championship_id;
  const { data: draws = [], isLoading } = useApi<any[]>(eventId ? `/championships/${eventId}/draws` : null);
  const { data: existing = [] } = useApi<any[]>(organization?.id ? `/teams?organization_id=${organization.id}` : null);

  // Don't offer draws this organization has already entered for this championship.
  const takenDrawIds = useMemo(
    () => new Set(existing.filter((t) => t.championship_id === eventId).map((t) => t.tournament_discipline_id).filter(Boolean)),
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
      name: `${short} ${drawLabel(d).replace(' · ', ' ')}`,
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
          Tournament{tournamentNames.length > 1 ? 's' : ''}:{' '}
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
                <div className="truncate text-xs text-slate-400 dark:text-slate-500">{d.entry_type} · squad {d.squad_min ?? d.disciplines?.squad_min ?? 1}–{d.squad_max ?? d.disciplines?.squad_max ?? 15} · {short} {drawLabel(d).replace(' · ', ' ')}</div>
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

function CreateTeamModal({ approved, institutionId, defaultEnrollmentId, onClose }: { approved: any[]; institutionId: string; defaultEnrollmentId?: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [enrollmentId, setEnrollmentId] = useState(defaultEnrollmentId ?? approved[0]?.id ?? '');
  const enrollment = approved.find((e) => e.id === enrollmentId);
  const eventId = enrollment?.championship_id;

  const { data: tournaments = [] } = useApi<any[]>(eventId ? `/tournaments?championship_id=${eventId}` : null);
  const { data: eventDraws = [] } = useApi<any[]>(eventId ? `/championships/${eventId}/draws` : null);
  const [tournamentId, setTournamentId] = useState('');
  const activeTournament = tournamentId || tournaments[0]?.id || '';
  const { data: tsports = [] } = useApi<any[]>(activeTournament ? `/tournament-sports?tournament_id=${activeTournament}` : null);
  const { data: sports = [] } = useApi<any[]>('/sports');
  const [tsId, setTsId] = useState('');
  const ts = tsports.find((t) => t.id === tsId) ?? tsports.find((t) => eventDraws.some((d) => d.tournament_sport_id === t.id));
  const sportDraws = useMemo(
    () => (ts ? eventDraws.filter((d) => d.tournament_sport_id === ts.id) : []),
    [eventDraws, ts],
  );
  const tsportsWithDraws = useMemo(
    () => tsports.filter((t) => eventDraws.some((d) => d.tournament_sport_id === t.id)),
    [tsports, eventDraws],
  );
  const [drawId, setDrawId] = useState('');
  const activeDrawId = drawId || sportDraws[0]?.id || '';
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useApiMutation(
    (body: any) => api('POST', '/teams', body),
    ['/me/teams', `/teams?organization_id=${institutionId}`],
    (team: any) => navigate(`/organizations/${institutionId}/teams/${team.id}`),
  );

  const sportName = (id: string) => sports.find((s) => s.id === id)?.name ?? 'Sport';

  const submit = () => {
    setError(null);
    if (!enrollment || !ts) { setError('Select an championship and sport'); return; }
    if (!activeDrawId) { setError('Select a discipline — ask the organiser to add draws in championship setup'); return; }
    create.mutate({
      championship_id: enrollment.championship_id,
      organization_id: institutionId,
      championship_organization_id: enrollment.id,
      sport_id: ts.sport_id,
      tournament_discipline_id: activeDrawId,
      name,
    }, { onError: (e: any) => setError(e.message) });
  };

  return (
    <Modal title="Enter a team" onClose={onClose}>
      <Field label="Championship">
        <Select value={enrollmentId} onChange={(e) => { setEnrollmentId(e.target.value); setTournamentId(''); setTsId(''); setDrawId(''); }}>
          {approved.map((e) => <option key={e.id} value={e.id}>{e.championships?.name}</option>)}
        </Select>
      </Field>
      {eventDraws.length === 0 ? (
        <p className="mb-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          No disciplines are configured for this championship yet. The organiser must add discipline draws in Setup before you can enter teams.
        </p>
      ) : (
        <>
      {tournaments.length > 0 && (
        <Field label="Tournament">
          <Select value={activeTournament} onChange={(e) => { setTournamentId(e.target.value); setTsId(''); setDrawId(''); }} disabled={tournaments.length === 1}>
            {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Sport">
        <Select value={ts?.id ?? ''} onChange={(e) => { setTsId(e.target.value); setDrawId(''); }}>
          {tsportsWithDraws.length === 0 && <option value="">No sports with disciplines</option>}
          {tsportsWithDraws.map((t) => <option key={t.id} value={t.id}>{sportName(t.sport_id)}</option>)}
        </Select>
      </Field>
      <Field label="Discipline / draw" hint="Required — each team must be linked to an organiser-configured draw.">
        {sportDraws.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No disciplines for this sport yet.</p>
        ) : (
          <Select value={activeDrawId} onChange={(e) => setDrawId(e.target.value)}>
            {sportDraws.map((d) => (
              <option key={d.id} value={d.id}>
                {d.disciplines?.name ?? sportName(ts!.sport_id)} ({d.entry_type})
              </option>
            ))}
          </Select>
        )}
      </Field>
        </>
      )}
      <Field label="Team name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VJTI Titans" /></Field>
      {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!name || !activeDrawId || eventDraws.length === 0 || create.isPending} onClick={submit}>{create.isPending ? 'Creating…' : 'Create team'}</Button>
      </div>
    </Modal>
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
  const { data: instTeams = [], isLoading: instLoading } = useApi<any[]>(institutionId ? `/teams?organization_id=${institutionId}` : null);
  const { data: myTeams = [], isLoading: myLoading } = useApi<any[]>(institutionId ? null : '/me/teams');
  const teams = institutionId
    ? instTeams
    : myTeams.filter((t) => t.membership_role === 'captain' || t.membership_role === 'vice_captain');
  const isLoading = institutionId ? instLoading : myLoading;
  const { data: enrollments = [] } = useApi<any[]>('/me/enrollments');
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
    for (const t of teams) {
      const id = tournamentId(t);
      const name = tournamentName(t);
      if (id && name) map.set(id, name);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [eventId, eventTournaments, teams]);

  // Sports narrow to the selected championship + tournament (cascading); published to header.
  const sportOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teams) {
      if (eventId && t.championship_id !== eventId) continue;
      if (tournamentFilter !== 'all' && tournamentId(t) !== tournamentFilter) continue;
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
    if (eventId) rows = rows.filter((t) => t.championship_id === eventId);
    if (tournamentFilter !== 'all') rows = rows.filter((t) => tournamentId(t) === tournamentFilter);
    if (sportId) rows = rows.filter((t) => t.sport_id === sportId);
    if (status !== 'all') rows = rows.filter((t) => t.status === status);
    return rows;
  }, [teams, eventId, tournamentFilter, sportId, status]);
  const tc = useTableControls(filtered, {
    search: (t) => `${t.name} ${t.sports?.name ?? ''} ${t.championships?.name ?? ''}`,
    sorts: {
      name: (a, b) => String(a.name).localeCompare(String(b.name)),
      championship: (a, b) => String(a.championships?.name ?? '').localeCompare(String(b.championships?.name ?? '')),
    },
    initialSort: 'name',
    pageSize: 12,
  });

  return (
    <div>
      {institutionId && <OrgTabs orgId={institutionId} />}
      <PageHeader
        title={activeEvent ? `${activeEvent.championships?.name ?? 'Championship'} teams` : 'Teams'}
        subtitle={activeEvent ? 'Teams entered for this championship.' : 'Enter and manage teams across your approved championships.'}
      >
        {canManage && <Button variant="outline" onClick={() => setBulkCreating(true)} disabled={!canEnterTeams}>+ Enter multiple</Button>}
        {canManage && <Button onClick={() => setCreating(true)} disabled={!canEnterTeams}>+ Enter a team</Button>}
      </PageHeader>

      {approved.length === 0 && (
        <p className="mb-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">You need an approved championship registration before entering teams. Apply via “Browse championships”.</p>
      )}
      {approved.length > 0 && eventId && eventDraws.length === 0 && (
        <p className="mb-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          No disciplines are configured for this championship yet. The organiser must add discipline draws in Setup before you can enter teams or assign players.
        </p>
      )}

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
        <EmptyState icon="⚇" title="No teams yet" description="Enter a team for one of your approved championships."
          action={canManage && approved.length > 0 ? <Button onClick={() => setCreating(true)}>+ Enter a team</Button> : undefined} />
      ) : (
        <>
          <ListToolbar>
            <SearchInput value={tc.query} onChange={tc.setQuery} placeholder="Search teams…" className="w-full sm:w-64" />
            {tournamentOptions.length > 0 && (
              <Select value={tournamentFilter} onChange={(e) => setTournamentFilter(e.target.value)} className="w-auto min-w-[11rem]">
                <option value="all">All tournaments</option>
                {tournamentOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            )}
            {statusOptions.length > 2 && (
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
                {statusOptions.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : String(s).replace(/_/g, ' ')}</option>)}
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
              action={canManage && eventId && canEnterTeams && tournamentFilter === 'all' ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => setCreating(true)}>+ Enter a team</Button>
                  <Button variant="outline" onClick={() => setBulkCreating(true)}>+ Enter multiple</Button>
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
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {[tournamentName(t), t.sports?.name, t.championships?.name].filter(Boolean).join(' · ')}
                    </p>
                    <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">{t.team_members?.length ?? 0} member{(t.team_members?.length ?? 0) === 1 ? '' : 's'}</p>
                  </Card>
                ))}
              </div>
              <Pagination page={tc.page} pageCount={tc.pageCount} total={tc.total} pageSize={tc.pageSize} onPage={tc.setPage} />
            </>
          )}
        </>
      )}

      {creating && institutionId && <CreateTeamModal approved={approved} institutionId={institutionId} defaultEnrollmentId={defaultEnrollmentId} onClose={() => setCreating(false)} />}
      {bulkCreating && institutionId && <BulkCreateTeamsModal approved={approved} organization={ctx?.organization ?? { id: institutionId }} defaultEnrollmentId={defaultEnrollmentId} onClose={() => setBulkCreating(false)} />}
    </div>
  );
}
