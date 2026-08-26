import { useState } from 'react';
import { FIXTURE_STATUS } from '@semp/shared';
import { useEvent } from './EventLayout';
import { api } from '../../lib/api';
import { usePageFilters, useFilterBar } from '../../lib/filters';
import { useApi, useApiMutation, fmtDateTime } from '../../lib/hooks';
import { Badge, Button, Card, cn, confirmDialog, EmptyState, Field, Input, Modal, Segmented, Select, Spinner, StatusBadge, StatusLegend, toast } from '../../components/ui';
import { Bracket, fixtureStatusLabel } from '../../components/Bracket';
import { RoundRobinGrid } from '../../components/RoundRobinGrid';
import { ScheduleTimeline } from '../../components/ScheduleTimeline';
import { describeSlot, describeTieBlocked, isTieBlockedFor, resolveBranchLabels } from '../../lib/stageTree';

interface Ground { id: string; name: string; venue_id?: string | null; venues?: { id?: string; name?: string } }
interface Venue { id: string; name: string }
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
function FixtureModal({ fixture, tdId, drawPath, grounds, venues, officials, teamName, onClose }:
  { fixture: any | null; tdId: string; drawPath: string; grounds: Ground[]; venues: Venue[]; officials: Official[]; teamName: (id: string | null) => string; onClose: () => void }) {
  const isEdit = !!fixture;
  const { data: teams = [] } = useApi<any[]>(`/teams?tournament_discipline_id=${tdId}`);
  const [homeId, setHomeId] = useState(fixture?.home_team_id ?? '');
  const [awayId, setAwayId] = useState(fixture?.away_team_id ?? '');
  const [round, setRound] = useState(fixture?.round ?? '');
  const [groundId, setGroundId] = useState(fixture?.venue_ground_id ?? '');
  // Venue is a grouping for grounds (fixtures only store the ground). Seed it from the
  // edited fixture's current ground so the right venue is pre-selected.
  const initialVenue = grounds.find((g) => g.id === fixture?.venue_ground_id)?.venue_id ?? '';
  const [venueId, setVenueId] = useState<string>(initialVenue);
  const [when, setWhen] = useState(toLocalInput(fixture?.scheduled_at));
  const [duration, setDuration] = useState(fixture?.duration_minutes ? String(fixture.duration_minutes) : '');
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
      duration_minutes: duration ? Number(duration) : null,
      official_id: officialId || null,
      status,
    };
    if (!isEdit) body.tournament_discipline_id = tdId;
    save.mutate(body, { onSuccess: () => toast.success(isEdit ? 'Fixture saved' : 'Fixture added'), onError: (e: any) => setError(e.message) });
  };

  const title = isEdit ? `Edit · ${teamName(fixture.home_team_id)} vs ${teamName(fixture.away_team_id)}` : 'Add fixture';
  const teamHint = teams.length === 0 ? 'No teams registered to this draw yet.' : undefined;
  // Disambiguate same-named teams (e.g. several "Badminton (Mixed)" draws) by
  // appending each team's organization to its option label.
  const optLabel = (t: any) => {
    const org = t.organizations?.short_name || t.organizations?.name;
    return org ? `${t.name} — ${org}` : t.name;
  };
  // The grounds belonging to the chosen venue (venues come straight from the venues
  // list, so a venue with no courts still shows and is selectable).
  const venueGrounds = grounds.filter((g) => (g.venue_id ?? '') === venueId);

  return (
    <Modal title={title} onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Home team" hint={teamHint}>
          <Select value={homeId} onChange={(e) => setHomeId(e.target.value)}>
            <option value="">- TBD -</option>
            {/* Hide the team already picked as Away - a team can't play itself. */}
            {teams.filter((t) => t.id !== awayId).map((t) => <option key={t.id} value={t.id}>{optLabel(t)}</option>)}
          </Select>
        </Field>
        <Field label="Away team">
          <Select value={awayId} onChange={(e) => setAwayId(e.target.value)}>
            <option value="">- TBD / bye -</option>
            {/* Hide the team already picked as Home - a team can't play itself. */}
            {teams.filter((t) => t.id !== homeId).map((t) => <option key={t.id} value={t.id}>{optLabel(t)}</option>)}
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
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Venue" hint={venues.length === 0 ? 'No venues set up for this championship yet.' : undefined}>
          <Select value={venueId} onChange={(e) => {
            const v = e.target.value;
            setVenueId(v);
            // Reset the ground when the venue changes; auto-pick if the venue has just one.
            const inVenue = grounds.filter((g) => (g.venue_id ?? '') === v);
            setGroundId(v && inVenue.length === 1 ? inVenue[0].id : '');
          }}>
            <option value="">- unassigned -</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </Field>
        <Field label="Ground / court" hint={venueId && venueGrounds.length === 0 ? 'This venue has no courts - assign at the venue level.' : undefined}>
          <Select value={groundId} disabled={!venueId || venueGrounds.length === 0} onChange={(e) => setGroundId(e.target.value)}>
            <option value="">{venueId ? '- any court -' : '- pick a venue first -'}</option>
            {venueGrounds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label="Date & time">
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-400" />
        </Field>
        <Field label="Duration" hint="How long the match runs">
          <Select value={duration} onChange={(e) => setDuration(e.target.value)}>
            <option value="">- default -</option>
            {[15, 20, 30, 45, 60, 75, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Match official" hint={officials.length === 0 ? 'No officials assigned to this championship yet - add them on the Organising team tab.' : undefined}>
        <Select value={officialId} onChange={(e) => setOfficialId(e.target.value)}>
          <option value="">- unassigned -</option>
          {officials.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
      </Field>
      {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="mt-2 flex items-center justify-between">
        {isEdit ? (
          <Button variant="ghost" className="text-rose-600 dark:text-rose-400"
            onClick={async () => { if (await confirmDialog({ title: 'Delete fixture', confirmLabel: 'Delete', message: 'Delete this fixture? This cannot be undone.' })) remove.mutate(undefined, { onSuccess: () => toast.success('Fixture deleted'), onError: (e: any) => setError(e.message) }); }}
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

function DrawCard({ td, fixtures: drawFixtures, fixturesLoading, fixturesPath, sportName, formatLabel, teamName, teamOrg, grounds, venues, officials, canManage }:
  { td: any; fixtures: any[]; fixturesLoading: boolean; fixturesPath: string; sportName: string; formatLabel?: string | null; teamName: (id: string | null) => string; teamOrg: (id: string | null) => string; grounds: Ground[]; venues: Venue[]; officials: Official[]; canManage: boolean }) {
  // The championship-wide list is ordered by schedule; restore the per-draw
  // pool → bracket order the visual (bracket / grid) view needs for layout.
  const fixtures = [...drawFixtures].sort((a, b) => (a.pool_number ?? 0) - (b.pool_number ?? 0) || (a.bracket_position ?? 0) - (b.bracket_position ?? 0));
  // The List view reads top-to-bottom, so order it chronologically (matching the
  // official / participant match lists). bracket_position can collide across rounds,
  // which interleaves them; scheduled time keeps rounds in play order. Unscheduled
  // matches fall back to the draw order and sort last.
  const listFixtures = [...drawFixtures].sort((a, b) => {
    const ta = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Infinity;
    const tb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Infinity;
    return ta - tb || (a.pool_number ?? 0) - (b.pool_number ?? 0) || (a.bracket_position ?? 0) - (b.bracket_position ?? 0);
  });
  const isLoading = fixturesLoading;
  const generate = useApiMutation(() => api('POST', `/tournament-disciplines/${td.id}/fixtures/generate`, { params: {} }), [fixturesPath]);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'list' | 'visual'>('visual');

  // Once any fixture has been played, regenerating would erase results - the server
  // refuses it, so disable the button and explain why rather than letting it 500.
  const hasPlayed = fixtures.some((f) => ['completed', 'walkover', 'bye'].includes(f.status) || f.home_score != null || f.away_score != null);
  // Leagues generate incrementally (keep existing matches, add the new teams' fixtures),
  // so the action stays available mid-tournament; knockout/pool draws rebuild from
  // scratch and are blocked once anything's been played.
  const isLeague = /league|round.?robin/i.test(formatLabel ?? '');
  const hasBracket = fixtures.some((f) => f.bracket_position != null);
  // Ranking/event draws (powerlifting/swimming/athletics) have a single team-less event
  // fixture - no head-to-head, so the bracket/grid views don't apply. They get a simple
  // event-row view that names the discipline instead.
  const isRanking = /rank/i.test(formatLabel ?? '');
  // Knockout draws show a bracket; everything else (league / round-robin /
  // groups) shows a results grid. Both are the "visual" view.
  const visualLabel = hasBracket ? 'Bracket' : 'Grid';
  const showVisual = !isRanking && fixtures.length > 0 && view === 'visual';

  // A discipline built with the stage-config wizard has more than one
  // stage_sequence (a pool stage + one or more knockout branches) - each stage is
  // its own independent bracket/pool-set and must be rendered separately, or two
  // branches' identically-labelled "Final" rows would visually merge into one
  // broken bracket. Every existing single-stage discipline collapses to exactly
  // one group here (stage_sequence defaults to 1), so this is a no-op for them.
  const byStage = new Map<number, any[]>();
  for (const f of fixtures) {
    const seq = f.stage_sequence ?? 1;
    (byStage.get(seq) ?? byStage.set(seq, []).get(seq)!).push(f);
  }
  const stageGroups: [number, any[]][] = [...byStage.entries()].sort((a, b) => a[0] - b[0]);
  const multiStage = stageGroups.length > 1;
  const branchLabels = resolveBranchLabels(td.format_config);
  const stageLabel = (seq: number, groupHasBracket: boolean) =>
    branchLabels.get(seq) ?? (seq === 1 ? (groupHasBracket ? 'Bracket' : 'Pools') : `Stage ${seq}`);

  const groundLabel = (id: string | null) => { const g = grounds.find((x) => x.id === id); return g ? `${g.venues?.name ? g.venues.name + ' · ' : ''}${g.name}` : null; };
  const officialName = (id: string | null) => officials.find((o) => o.id === id)?.name ?? null;

  return (
    <Card className="min-w-0 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{td.disciplines?.name ?? sportName}</span>
            {formatLabel && <Badge tone="violet">{formatLabel}</Badge>}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{td.entry_type} draw · {fixtures.length} fixture{fixtures.length === 1 ? '' : 's'}</div>
        </div>
        <div className="flex items-center gap-2">
          {fixtures.length > 0 && !isRanking && (
            <Segmented
              size="sm"
              value={view}
              onChange={setView}
              options={[{ value: 'visual', label: visualLabel }, { value: 'list', label: 'List' }]}
            />
          )}
          {canManage && <Button size="sm" variant="subtle" onClick={() => setCreating(true)}>+ Add fixture</Button>}
          {canManage && (
            <Button size="sm" variant={fixtures.length ? 'outline' : 'primary'} disabled={generate.isPending || (hasPlayed && !isLeague)}
              title={isLeague && fixtures.length
                ? 'Keeps existing matches and adds fixtures for newly-registered teams.'
                : hasPlayed ? 'This draw has played matches - regenerating would erase those results.' : undefined}
              onClick={() => generate.mutate(undefined, { onSuccess: () => toast.success(isLeague && fixtures.length ? 'New teams added' : 'Draw generated'), onError: (e: any) => toast.error(e.message) })}>
              {generate.isPending ? 'Generating…' : fixtures.length ? (isLeague ? 'Add new teams' : 'Regenerate') : 'Generate draw'}
            </Button>
          )}
        </div>
      </div>
      <div className="mt-3">
        {isLoading ? <Spinner /> : fixtures.length === 0 ? (
          <p className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-3 text-sm text-slate-400 dark:text-slate-500">
            {isRanking ? 'No event yet - generate to create the ranking event.' : 'No fixtures yet - generate the draw from registered teams.'}
          </p>
        ) : isRanking ? (
          // Ranking event: one team-less fixture per draw - show the event (discipline)
          // name and its schedule/status rather than a head-to-head matchup.
          <div className="space-y-1.5">
            {listFixtures.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-sm">
                <span className="w-20 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{f.round || 'Event'}</span>
                <span className="flex-1 min-w-[180px] font-medium text-slate-700 dark:text-slate-300">{td.disciplines?.name ?? sportName} · Ranking event</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {groundLabel(f.venue_ground_id) ?? 'No ground'} · {f.scheduled_at ? fmtDateTime(f.scheduled_at) : 'Unscheduled'}
                  {officialName(f.official_id) ? ` · ${officialName(f.official_id)}` : ' · No official'}
                </span>
                {/* Status + Edit share one row on phone, split 50/50 (status left,
                    Edit right) so they line up across rows regardless of name length;
                    from sm up they fall back to the inline end-of-row layout. */}
                <div className="grid w-full grid-cols-2 items-center justify-items-center gap-2 sm:flex sm:w-auto sm:gap-3">
                  <StatusBadge status={f.status} label={fixtureStatusLabel(f.status)} />
                  {canManage && <Button size="sm" variant="ghost" onClick={() => setEditing(f)}>Edit</Button>}
                </div>
              </div>
            ))}
          </div>
        ) : showVisual ? (
          <div className="space-y-6">
            {stageGroups.map(([seq, group]) => {
              const groupHasBracket = group.some((f) => f.bracket_position != null);
              const content = groupHasBracket
                ? <Bracket fixtures={group} teamName={teamName} teamOrg={teamOrg} onSelect={canManage ? setEditing : () => {}} />
                : <RoundRobinGrid fixtures={group} teamName={teamName} teamOrg={teamOrg} onSelect={canManage ? setEditing : () => {}} />;
              if (!multiStage) return <div key={seq}>{content}</div>;
              // Every stage numbers its OWN pools fresh (Pool A, B, C...), so a later
              // stage's "Pool B" is a completely different pool from an earlier
              // stage's "Pool B" - a small caption is too easy to scroll past and read
              // as one continuous, oddly-restarting pool. A bordered box with a named
              // badge makes the stage boundary impossible to miss.
              return (
                <div key={seq} className="rounded-xl border-2 border-slate-200 p-4 dark:border-slate-800">
                  <div className="mb-3 flex items-center gap-2">
                    <Badge tone="violet">{stageLabel(seq, groupHasBracket)}</Badge>
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Stage {seq}</span>
                  </div>
                  {content}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-1.5">
            {listFixtures.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 w-20">{f.round || 'Match'}</span>
                <span className="flex flex-1 min-w-[180px] items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
                  <span className={cn('inline-flex flex-col', !f.home_team_id && isTieBlockedFor(f.home_slot_label, f.live_state?.tie_blocked) && 'text-amber-600 dark:text-amber-400')}>
                    <span className="leading-tight">
                      {f.home_team_id ? teamName(f.home_team_id) : (
                        isTieBlockedFor(f.home_slot_label, f.live_state?.tie_blocked)
                          ? `⚠ ${describeTieBlocked(f.live_state?.tie_blocked)}`
                          : (describeSlot(f.home_slot_label) ?? 'TBD')
                      )}
                    </span>
                    {teamOrg(f.home_team_id) && <span className="text-[11px] font-normal leading-tight text-slate-400 dark:text-slate-500">{teamOrg(f.home_team_id)}</span>}
                  </span>
                  <span className="text-slate-400 dark:text-slate-500">vs</span>
                  <span className={cn('inline-flex flex-col', !f.away_team_id && isTieBlockedFor(f.away_slot_label, f.live_state?.tie_blocked) && 'text-amber-600 dark:text-amber-400')}>
                    <span className="leading-tight">
                      {f.away_team_id ? teamName(f.away_team_id) : (
                        isTieBlockedFor(f.away_slot_label, f.live_state?.tie_blocked)
                          ? `⚠ ${describeTieBlocked(f.live_state?.tie_blocked)}`
                          : (describeSlot(f.away_slot_label) ?? 'TBD')
                      )}
                    </span>
                    {teamOrg(f.away_team_id) && <span className="text-[11px] font-normal leading-tight text-slate-400 dark:text-slate-500">{teamOrg(f.away_team_id)}</span>}
                  </span>
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {groundLabel(f.venue_ground_id) ?? 'No ground'} · {f.scheduled_at ? fmtDateTime(f.scheduled_at) : 'Unscheduled'}
                  {officialName(f.official_id) ? ` · ${officialName(f.official_id)}` : ' · No official'}
                </span>
                {/* Status + Edit share one row on phone, split 50/50 (status left,
                    Edit right) so they line up across rows regardless of name length;
                    from sm up they fall back to the inline end-of-row layout. */}
                <div className="grid w-full grid-cols-2 items-center justify-items-center gap-2 sm:flex sm:w-auto sm:gap-3">
                  <StatusBadge status={f.status} label={fixtureStatusLabel(f.status)} />
                  {canManage && <Button size="sm" variant="ghost" onClick={() => setEditing(f)}>Edit</Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && <FixtureModal fixture={editing} tdId={td.id} drawPath={fixturesPath} grounds={grounds} venues={venues} officials={officials} teamName={teamName} onClose={() => setEditing(null)} />}
      {creating && <FixtureModal fixture={null} tdId={td.id} drawPath={fixturesPath} grounds={grounds} venues={venues} officials={officials} teamName={teamName} onClose={() => setCreating(false)} />}
    </Card>
  );
}

function SportBlock({ ts, draws, allFixtures, fixturesLoading, fixturesPath, sportName, formatName, teamName, teamOrg, grounds, venues, officials, canManage }:
  { ts: any; draws: any[]; allFixtures: any[]; fixturesLoading: boolean; fixturesPath: string; sportName: string; formatName: (id: string | null | undefined) => string | null; teamName: (id: string | null) => string; teamOrg: (id: string | null) => string; grounds: Ground[]; venues: Venue[]; officials: Official[]; canManage: boolean }) {
  if (draws.length === 0) return null;
  // Effective format: the draw's own format wins, else the sport's (matches the
  // generate route's fallback).
  return (
    <div>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{sportName}</h3>
      <div className="grid grid-cols-1 gap-3">
        {draws.map((td) => (
          <DrawCard
            key={td.id}
            td={td}
            fixtures={allFixtures.filter((f) => f.tournament_discipline_id === td.id)}
            fixturesLoading={fixturesLoading}
            fixturesPath={fixturesPath}
            sportName={sportName}
            formatLabel={formatName(td.format_id) ?? formatName(ts.format_id)}
            teamName={teamName}
            teamOrg={teamOrg}
            grounds={grounds}
            venues={venues}
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
  // Timeline status filter, driven by clicking the colour legend (empty = show all).
  const [timelineStatus, setTimelineStatus] = useState('');
  // One championship-wide fixtures request feeds the timeline AND every manage-view
  // DrawCard (sliced per draw), instead of a fixtures request per draw.
  const fixturesPath = `/championships/${eventId}/fixtures`;
  const { data: allFixtures = [], isLoading: fixturesLoading } = useApi<any[]>(fixturesPath);
  // All draws for the championship in one request - feeds the timeline rows and each
  // manage-view SportBlock (replaces one disciplines query per sport).
  const { data: allDraws = [] } = useApi<any[]>(`/championships/${eventId}/draws`);
  const place = useApiMutation(
    ({ fixtureId, whenIso, durationMinutes }: { fixtureId: string; whenIso: string; durationMinutes: number }) =>
      api('PATCH', `/fixtures/${fixtureId}`, { scheduled_at: whenIso, duration_minutes: durationMinutes }),
    [`/championships/${eventId}/fixtures`],
  );
  // Send a placed match back to the unscheduled pool (clears its slot on the timeline).
  const unschedule = useApiMutation(
    (fixtureId: string) => api('PATCH', `/fixtures/${fixtureId}`, { scheduled_at: null }),
    [`/championships/${eventId}/fixtures`],
  );
  const { data: tournaments = [], isLoading: tournamentsLoading } = useApi<any[]>(`/tournaments?championship_id=${eventId}`);
  // Tournament lives in the shared header filter (single-select). '' before the
  // default kicks in, so fall back to the first tournament for data fetching.
  const { tournamentId } = useFilterBar();
  const active = tournamentId || tournaments[0]?.id || '';
  const { data: tsports = [], isLoading: tsportsLoading } = useApi<any[]>(active ? `/tournament-sports?tournament_id=${active}` : null);
  const { data: sports = [] } = useApi<any[]>('/sports');
  const { data: teams = [] } = useApi<any[]>(`/teams?championship_id=${eventId}`);
  const { data: grounds = [] } = useApi<Ground[]>(`/championships/${eventId}/grounds`);
  // Venues come from the venues list directly (not derived from grounds) so a venue
  // with no courts yet still appears in the fixture's venue picker.
  const { data: venues = [] } = useApi<Venue[]>(`/venues?championship_id=${eventId}`);
  // Only officials assigned to this championship (the Organising team → Officials list),
  // not every user. `official_id` on a fixture stores the official's user id.
  const { data: officialRows = [] } = useApi<{ user: { id: string; name: string } }[]>(`/championships/${eventId}/officials`);
  const officials: Official[] = officialRows.map((o) => ({ id: o.user.id, name: o.user.name }));
  const { data: formats = [] } = useApi<any[]>('/tournament-formats');

  const sportName = (id: string) => sports.find((s) => s.id === id)?.name ?? 'Sport';
  const teamName = (id: string | null) => (id ? teams.find((t) => t.id === id)?.name ?? 'TBD' : 'TBD');
  // Organization sub-heading for a team (short name preferred), '' when unaffiliated -
  // shown under the team name on the bracket / grid / list so same-named draws read apart.
  const teamOrg = (id: string | null) => {
    const o = id ? teams.find((t) => t.id === id)?.organizations : null;
    return o?.short_name || o?.name || '';
  };
  const formatName = (id: string | null | undefined) => (id ? formats.find((f) => f.id === id)?.name ?? null : null);

  // Discipline rows + day tabs for the timeline scheduler.
  const timelineRows = allDraws.map((d: any) => ({
    id: d.id,
    sport: d.tournament_sports?.sports?.name ?? 'Sport',
    discipline: d.disciplines?.name ?? d.tournament_sports?.sports?.name ?? 'Discipline',
    format: formatName(d.format_id) ?? formatName(d.tournament_sports?.format_id),
    entry_type: d.entry_type,
  }));
  const days = buildDays(championship.start_date, championship.end_date);
  // The timeline computes the exact start (day + chosen time) and duration; we just
  // persist them onto the fixture.
  const placeMatch = (fixtureId: string, startISO: string, durationMinutes: number) => {
    place.mutate({ fixtureId, whenIso: startISO, durationMinutes }, { onSuccess: () => toast.success('Match scheduled'), onError: (e: any) => toast.error(e.message) });
  };
  const unscheduleMatch = (fixtureId: string) => {
    unschedule.mutate(fixtureId, { onSuccess: () => toast.success('Match unscheduled'), onError: (e: any) => toast.error(e.message) });
  };

  // Tournament + Sport both live in the shared header filter (championship = route
  // here, so no championship dropdown). Tournament is single-select - the manage view
  // always shows one tournament's draws - so it's registered as required (no "All").
  const tournamentOptions = tournaments.map((t: any) => ({ id: t.id, name: t.name }));
  const sportOptions = [...new Map(tsports.map((ts: any) => [ts.sport_id, sportName(ts.sport_id)])).entries()]
    .map(([id, name]) => ({ id, name }));
  const { sportId } = usePageFilters({
    tournaments: topView === 'manage' && tournamentOptions.length ? tournamentOptions : undefined,
    tournamentRequired: true,
    sports: sportOptions.length ? sportOptions : undefined,
  });
  const visibleTsports = sportId ? tsports.filter((ts) => ts.sport_id === sportId) : tsports;

  if (tournamentsLoading) {
    return <div className="grid h-40 place-items-center"><Spinner /></div>;
  }
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
        fixturesLoading ? <div className="grid h-40 place-items-center"><Spinner /></div> : (
          <div className="space-y-3">
            <StatusLegend value={timelineStatus} onSelect={setTimelineStatus} />
            <ScheduleTimeline
              rows={timelineRows}
              fixtures={timelineStatus ? allFixtures.filter((f: any) => f.status === timelineStatus) : allFixtures}
              days={days}
              canManage={canManage}
              placing={place.isPending || unschedule.isPending}
              onPlace={placeMatch}
              onUnschedule={unscheduleMatch}
            />
          </div>
        )
      ) : tsportsLoading ? (
        <div className="grid h-40 place-items-center"><Spinner /></div>
      ) : tsports.length === 0 ? (
        <EmptyState icon="⚑" title="No sports configured" description="Add sports & disciplines in Setup, then come back to generate fixtures." />
      ) : (
        <div className="space-y-6">
          {visibleTsports.map((ts) => <SportBlock key={ts.id} ts={ts} draws={allDraws.filter((d) => d.tournament_sport_id === ts.id)} allFixtures={allFixtures} fixturesLoading={fixturesLoading} fixturesPath={fixturesPath} sportName={sportName(ts.sport_id)} formatName={formatName} teamName={teamName} teamOrg={teamOrg} grounds={grounds} venues={venues} officials={officials} canManage={canManage} />)}
        </div>
      )}
    </div>
  );
}
