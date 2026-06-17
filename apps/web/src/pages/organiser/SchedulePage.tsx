import { useState } from 'react';
import { FIXTURE_STATUS } from '@semp/shared';
import { useEvent } from './EventLayout';
import { api } from '../../lib/api';
import { usePageFilters, useFilterBar } from '../../lib/filters';
import { useApi, useApiMutation, fmtDateTime } from '../../lib/hooks';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Segmented, Select, Spinner, StatusBadge, toast } from '../../components/ui';
import { Bracket, fixtureStatusLabel } from '../../components/Bracket';
import { RoundRobinGrid } from '../../components/RoundRobinGrid';
import { ScheduleTimeline } from '../../components/ScheduleTimeline';

interface Ground { id: string; name: string; venues?: { name?: string } }
interface Official { id: string; name: string; account_type?: string }

function toLocalInput(d?: string | null): string {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const off = date.getTimezoneOffset();
  return new Date(date.getTime() - off * 60000).toISOString().slice(0, 16);
}

// Create or edit a single fixture by hand. `fixture === null` ⇒ create mode for the
// given draw; otherwise edit (teams / round / schedule / status) with a delete option.
function FixtureModal({ fixture, tdId, drawPath, grounds, officials, teamName, onClose }:
  { fixture: any | null; tdId: string; drawPath: string; grounds: Ground[]; officials: Official[]; teamName: (id: string | null) => string; onClose: () => void }) {
  const isEdit = !!fixture;
  const { data: teams = [] } = useApi<any[]>(`/teams?tournament_discipline_id=${tdId}`);
  const [homeId, setHomeId] = useState(fixture?.home_team_id ?? '');
  const [awayId, setAwayId] = useState(fixture?.away_team_id ?? '');
  const [round, setRound] = useState(fixture?.round ?? '');
  const [groundId, setGroundId] = useState(fixture?.venue_ground_id ?? '');
  const [when, setWhen] = useState(toLocalInput(fixture?.scheduled_at));
  const [officialId, setOfficialId] = useState(fixture?.official_id ?? '');
  const [status, setStatus] = useState(fixture?.status ?? 'scheduled');
  const [error, setError] = useState<string | null>(null);

  const save = useApiMutation(
    (body: any) => (isEdit ? api('PATCH', `/fixtures/${fixture.id}`, body) : api('POST', '/fixtures', body)),
    [drawPath],
    onClose,
  );
  const remove = useApiMutation(() => api('DELETE', `/fixtures/${fixture.id}`), [drawPath], onClose);

  const submit = () => {
    setError(null);
    const body: any = {
      home_team_id: homeId || null,
      away_team_id: awayId || null,
      round: round.trim(),
      venue_ground_id: groundId || null,
      scheduled_at: when ? new Date(when).toISOString() : null,
      official_id: officialId || null,
      status,
    };
    if (!isEdit) body.tournament_discipline_id = tdId;
    save.mutate(body, { onSuccess: () => toast.success(isEdit ? 'Fixture saved' : 'Fixture added'), onError: (e: any) => setError(e.message) });
  };

  const title = isEdit ? `Edit · ${teamName(fixture.home_team_id)} vs ${teamName(fixture.away_team_id)}` : 'Add fixture';
  const teamHint = teams.length === 0 ? 'No teams registered to this draw yet.' : undefined;

  return (
    <Modal title={title} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Home team" hint={teamHint}>
          <Select value={homeId} onChange={(e) => setHomeId(e.target.value)}>
            <option value="">— TBD —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Away team">
          <Select value={awayId} onChange={(e) => setAwayId(e.target.value)}>
            <option value="">— TBD / bye —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Round" hint="e.g. Final, SF, Group A, Match 1">
          <Input value={round} onChange={(e) => setRound(e.target.value)} placeholder="Match" />
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {FIXTURE_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Ground / court">
        <Select value={groundId} onChange={(e) => setGroundId(e.target.value)}>
          <option value="">— unassigned —</option>
          {grounds.map((g) => <option key={g.id} value={g.id}>{g.venues?.name ? `${g.venues.name} · ` : ''}{g.name}</option>)}
        </Select>
      </Field>
      <Field label="Date & time">
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-400" />
      </Field>
      <Field label="Match official" hint={officials.length === 0 ? 'No officials assigned to this championship yet — add them on the Organising team tab.' : undefined}>
        <Select value={officialId} onChange={(e) => setOfficialId(e.target.value)}>
          <option value="">— unassigned —</option>
          {officials.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
      </Field>
      {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="mt-2 flex items-center justify-between">
        {isEdit ? (
          <Button variant="ghost" className="text-rose-600 dark:text-rose-400"
            onClick={() => { if (confirm('Delete this fixture? This cannot be undone.')) remove.mutate(undefined, { onSuccess: () => toast.success('Fixture deleted'), onError: (e: any) => setError(e.message) }); }}
            disabled={remove.isPending}>
            {remove.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        ) : <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending} onClick={submit}>
            {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add fixture'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DrawCard({ td, sportName, formatLabel, teamName, grounds, officials, canManage }:
  { td: any; sportName: string; formatLabel?: string | null; teamName: (id: string | null) => string; grounds: Ground[]; officials: Official[]; canManage: boolean }) {
  const path = `/tournament-disciplines/${td.id}/fixtures`;
  const { data: fixtures = [], isLoading } = useApi<any[]>(path);
  const generate = useApiMutation(() => api('POST', `/tournament-disciplines/${td.id}/fixtures/generate`, { params: {} }), [path]);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'list' | 'visual'>('visual');

  const hasBracket = fixtures.some((f) => f.bracket_position != null);
  // Knockout draws show a bracket; everything else (league / round-robin /
  // groups) shows a results grid. Both are the "visual" view.
  const visualLabel = hasBracket ? 'Bracket' : 'Grid';
  const showVisual = fixtures.length > 0 && view === 'visual';

  const groundLabel = (id: string | null) => { const g = grounds.find((x) => x.id === id); return g ? `${g.venues?.name ? g.venues.name + ' · ' : ''}${g.name}` : null; };
  const officialName = (id: string | null) => officials.find((o) => o.id === id)?.name ?? null;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{td.disciplines?.name ?? sportName}</span>
            {formatLabel && <Badge tone="violet">{formatLabel}</Badge>}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{td.entry_type} draw · {fixtures.length} fixture{fixtures.length === 1 ? '' : 's'}</div>
        </div>
        <div className="flex items-center gap-2">
          {fixtures.length > 0 && (
            <Segmented
              size="sm"
              value={view}
              onChange={setView}
              options={[{ value: 'visual', label: visualLabel }, { value: 'list', label: 'List' }]}
            />
          )}
          {canManage && <Button size="sm" variant="subtle" onClick={() => setCreating(true)}>+ Add fixture</Button>}
          {canManage && (
            <Button size="sm" variant={fixtures.length ? 'outline' : 'primary'} disabled={generate.isPending}
              onClick={() => generate.mutate(undefined, { onSuccess: () => toast.success('Draw generated'), onError: (e: any) => toast.error(e.message) })}>
              {generate.isPending ? 'Generating…' : fixtures.length ? 'Regenerate' : 'Generate draw'}
            </Button>
          )}
        </div>
      </div>
      <div className="mt-3">
        {isLoading ? <Spinner /> : fixtures.length === 0 ? (
          <p className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-3 text-sm text-slate-400 dark:text-slate-500">No fixtures yet — generate the draw from registered teams.</p>
        ) : showVisual ? (
          hasBracket
            ? <Bracket fixtures={fixtures} teamName={teamName} onSelect={canManage ? setEditing : () => {}} />
            : <RoundRobinGrid fixtures={fixtures} teamName={teamName} onSelect={canManage ? setEditing : () => {}} />
        ) : (
          <div className="space-y-1.5">
            {fixtures.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 w-20">{f.round || 'Match'}</span>
                <span className="flex-1 min-w-[180px] font-medium text-slate-700 dark:text-slate-300">
                  {teamName(f.home_team_id)} <span className="text-slate-400 dark:text-slate-500">vs</span> {teamName(f.away_team_id)}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {groundLabel(f.venue_ground_id) ?? 'No ground'} · {f.scheduled_at ? fmtDateTime(f.scheduled_at) : 'Unscheduled'}
                  {officialName(f.official_id) ? ` · ${officialName(f.official_id)}` : ' · No official'}
                </span>
                <StatusBadge status={f.status} label={fixtureStatusLabel(f.status)} />
                {canManage && f.status !== 'bye' && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(f)}>Edit</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && <FixtureModal fixture={editing} tdId={td.id} drawPath={path} grounds={grounds} officials={officials} teamName={teamName} onClose={() => setEditing(null)} />}
      {creating && <FixtureModal fixture={null} tdId={td.id} drawPath={path} grounds={grounds} officials={officials} teamName={teamName} onClose={() => setCreating(false)} />}
    </Card>
  );
}

function SportBlock({ ts, sportName, formatName, teamName, grounds, officials, canManage }:
  { ts: any; sportName: string; formatName: (id: string | null | undefined) => string | null; teamName: (id: string | null) => string; grounds: Ground[]; officials: Official[]; canManage: boolean }) {
  const { data: draws = [] } = useApi<any[]>(`/tournament-disciplines?tournament_sport_id=${ts.id}`);
  if (draws.length === 0) return null;
  // Effective format: the draw's own format wins, else the sport's (matches the
  // generate route's fallback).
  return (
    <div>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{sportName}</h3>
      <div className="grid gap-3">
        {draws.map((td) => (
          <DrawCard
            key={td.id}
            td={td}
            sportName={sportName}
            formatLabel={formatName(td.format_id) ?? formatName(ts.format_id)}
            teamName={teamName}
            grounds={grounds}
            officials={officials}
            canManage={canManage}
          />
        ))}
      </div>
    </div>
  );
}

// Local day keys (YYYY-MM-DD) across the championship's date range.
function buildDays(startISO?: string, endISO?: string): string[] {
  if (!startISO || !endISO) return [];
  const p = (s: string) => s.slice(0, 10).split('-').map(Number);
  const [sy, sm, sd] = p(startISO); const [ey, em, ed] = p(endISO);
  const cur = new Date(sy, sm - 1, sd); const end = new Date(ey, em - 1, ed);
  const out: string[] = [];
  while (cur <= end && out.length < 60) {
    out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function SchedulePage() {
  const { eventId, canManage, championship } = useEvent();
  const [topView, setTopView] = useState<'manage' | 'timeline'>('manage');
  const { data: allFixtures = [], isLoading: timelineLoading } = useApi<any[]>(topView === 'timeline' ? `/championships/${eventId}/fixtures` : null);
  const { data: timelineDraws = [] } = useApi<any[]>(topView === 'timeline' ? `/championships/${eventId}/draws` : null);
  const place = useApiMutation(
    ({ fixtureId, whenIso }: { fixtureId: string; whenIso: string }) => api('PATCH', `/fixtures/${fixtureId}`, { scheduled_at: whenIso }),
    [`/championships/${eventId}/fixtures`],
  );
  const { data: tournaments = [] } = useApi<any[]>(`/tournaments?championship_id=${eventId}`);
  // Tournament lives in the shared header filter (single-select). '' before the
  // default kicks in, so fall back to the first tournament for data fetching.
  const { tournamentId } = useFilterBar();
  const active = tournamentId || tournaments[0]?.id || '';
  const { data: tsports = [] } = useApi<any[]>(active ? `/tournament-sports?tournament_id=${active}` : null);
  const { data: sports = [] } = useApi<any[]>('/sports');
  const { data: teams = [] } = useApi<any[]>(`/teams?championship_id=${eventId}`);
  const { data: grounds = [] } = useApi<Ground[]>(`/championships/${eventId}/grounds`);
  // Only officials assigned to this championship (the Organising team → Officials list),
  // not every user. `official_id` on a fixture stores the official's user id.
  const { data: officialRows = [] } = useApi<{ user: { id: string; name: string } }[]>(`/championships/${eventId}/officials`);
  const officials: Official[] = officialRows.map((o) => ({ id: o.user.id, name: o.user.name }));
  const { data: formats = [] } = useApi<any[]>('/tournament-formats');

  const sportName = (id: string) => sports.find((s) => s.id === id)?.name ?? 'Sport';
  const teamName = (id: string | null) => (id ? teams.find((t) => t.id === id)?.name ?? 'TBD' : 'TBD');
  const formatName = (id: string | null | undefined) => (id ? formats.find((f) => f.id === id)?.name ?? null : null);

  // Discipline rows + day tabs for the timeline scheduler.
  const timelineRows = timelineDraws.map((d: any) => ({
    id: d.id,
    sport: d.tournament_sports?.sports?.name ?? 'Sport',
    discipline: d.disciplines?.name ?? d.tournament_sports?.sports?.name ?? 'Discipline',
    format: formatName(d.format_id) ?? formatName(d.tournament_sports?.format_id),
    entry_type: d.entry_type,
  }));
  const days = buildDays(championship.start_date, championship.end_date);
  const placeMatch = (fixtureId: string, day: string, hour: number) => {
    const [y, mo, d] = day.split('-').map(Number);
    const whenIso = new Date(y, mo - 1, d, hour).toISOString();
    place.mutate({ fixtureId, whenIso }, { onSuccess: () => toast.success('Match scheduled'), onError: (e: any) => toast.error(e.message) });
  };

  // Tournament + Sport both live in the shared header filter (championship = route
  // here, so no championship dropdown). Tournament is single-select — the manage view
  // always shows one tournament's draws — so it's registered as required (no "All").
  const tournamentOptions = tournaments.map((t: any) => ({ id: t.id, name: t.name }));
  const sportOptions = [...new Map(tsports.map((ts: any) => [ts.sport_id, sportName(ts.sport_id)])).entries()]
    .map(([id, name]) => ({ id, name }));
  const { sportId } = usePageFilters({
    tournaments: topView === 'manage' && tournamentOptions.length ? tournamentOptions : undefined,
    tournamentRequired: true,
    sports: sportOptions.length ? sportOptions : undefined,
  });
  const visibleTsports = sportId ? tsports.filter((ts) => ts.sport_id === sportId) : tsports;

  if (tournaments.length === 0) {
    return <EmptyState icon="⚑" title="No tournaments" description="Set up a tournament and its sports before generating fixtures." />;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Segmented
          value={topView}
          onChange={setTopView}
          options={[{ value: 'manage', label: 'Fixtures' }, { value: 'timeline', label: 'Timeline' }]}
        />
      </div>
      {topView === 'timeline' ? (
        timelineLoading ? <div className="grid h-40 place-items-center"><Spinner /></div> : (
          <ScheduleTimeline
            rows={timelineRows}
            fixtures={allFixtures}
            days={days}
            canManage={canManage}
            placing={place.isPending}
            onPlace={placeMatch}
          />
        )
      ) : tsports.length === 0 ? (
        <EmptyState icon="⚑" title="No sports configured" description="Add sports & disciplines in Setup, then come back to generate fixtures." />
      ) : (
        <div className="space-y-6">
          {visibleTsports.map((ts) => <SportBlock key={ts.id} ts={ts} sportName={sportName(ts.sport_id)} formatName={formatName} teamName={teamName} grounds={grounds} officials={officials} canManage={canManage} />)}
        </div>
      )}
    </div>
  );
}
