import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { FIXTURE_STATUS, inheritedOverrides, resolveFormat } from '@semp/shared';
import { useEvent } from './EventLayout';
import { api } from '../../lib/api';
import { isRankingSport, isScoredSport } from '@semp/shared';
import { FormatPicker } from '../../features/scoring/FormatPicker';
import { usePageFilters, useFilterBar } from '../../lib/filters';
import { useApi, useApiMutation, fmtDateTime } from '../../lib/hooks';
import { Badge, Button, Card, cn, confirmDialog, EmptyState, Field, Input, Modal, Segmented, Select, Spinner, StatusBadge, StatusLegend, toast } from '../../components/ui';
import { Bracket, fixtureStatusLabel } from '../../components/Bracket';
import { RoundRobinGrid } from '../../components/RoundRobinGrid';
import { ScheduleTimeline } from '../../components/ScheduleTimeline';
import { StageConfigWizard } from '../../components/StageConfigWizard';
import { describeSlot, describeTieBlocked, isTieBlockedFor, resolveBranchLabels } from '../../lib/stageTree';
import { isPoolShapedFormat, titleCase } from '../../lib/format';

/**
 * The scoring entry point, on Schedule.
 *
 * Results deliberately hides `scheduled` matches - mixing "nobody has started this"
 * into "these need a result" is what made that queue unreadable - and it tells the
 * organiser to "start them from Schedule". Schedule had no way to do that: the only
 * route to the console was the assigned OFFICIAL's own list, or Results once a match
 * was already live. Starting a match meant opening the Edit dialog and changing a
 * Status dropdown sitting between Round and Venue, which is editing a database field,
 * not starting a match. So the message pointed at a screen that could not do it.
 *
 * The console handles the transition itself - the first scoring action moves a
 * `scheduled` fixture to `live` - so this only has to open it.
 */
function ScoreButton({ fixture, sportName, onNavigate }: { fixture: any; sportName?: string; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const { eventId } = useParams();
  // A match with an unresolved bracket slot has nothing to score yet, and a
  // cancelled one never will - offering the button there is a dead click. A
  // ranking event never has a home/away team at all (it has no two sides), so
  // that check doesn't apply to it - without this it could never be scored.
  const scorable = (!!fixture.home_team_id && !!fixture.away_team_id || isRankingSport(sportName))
    && !['cancelled', 'postponed', 'bye'].includes(fixture.status);
  if (!scorable) return null;
  const played = ['completed', 'walkover'].includes(fixture.status);
  return (
    <Button
      size="sm"
      variant={fixture.status === 'live' ? 'primary' : played ? 'ghost' : 'outline'}
      onClick={() => {
        // Close the dialog we may have been opened from, so returning from the
        // console does not land back on a stale modal over the schedule.
        onNavigate?.();
        navigate(`/score/${fixture.id}`, {
          // So Back returns here rather than to the official's match list.
          state: { from: `/championships/${eventId}/schedule` },
        });
      }}
    >
      {fixture.status === 'live' ? 'Resume' : played ? 'Scorecard' : 'Score'}
    </Button>
  );
}

/**
 * THE THREE RULES AN ORGANISER ACTUALLY CHANGES PER MATCH.
 *
 * Not a format - a PATCH on one. Picking a whole saved format (the field below)
 * severs inheritance: re-point the draw afterwards and this match no longer follows
 * it. These carry only what was changed, so a 12-minute half still inherits its
 * shape, its shoot-out and everything else, and still moves when the draw moves.
 *
 * Each blank option prints what it would inherit. An override set without the
 * inherited answer in view is a guess, and the commonest thing it gets set to is the
 * value it already had.
 */
function MatchRulesFields({
  fixture, tdId, sportName, periodMin, onPeriodMin, extraMin, onExtraMin, draws, onDraws,
}: {
  fixture: any; tdId: string; sportName?: string;
  periodMin: string; onPeriodMin: (v: string) => void;
  extraMin: string; onExtraMin: (v: string) => void;
  draws: string; onDraws: (v: string) => void;
}) {
  const { data } = useApi<{
    saved: Array<{ id: string; name: string; config: any }>;
    current?: { formatId: string | null; roundFormats: unknown };
    supported?: boolean;
  }>(`/tournament-disciplines/${tdId}/scoring-formats`);

  // What this match plays under with NOTHING overridden - resolved through the same
  // ladder the console uses, so the hints cannot drift from the real answer.
  const inherited = useMemo(() => {
    if (!data?.supported) return null;
    const rows = (data.saved ?? []).map((f) => ({ id: f.id, config: f.config }));
    const resolved = resolveFormat(
      { ...(fixture ?? {}), format_overrides: null },
      {
        scoring_format_id: data.current?.formatId ?? null,
        round_formats: data.current?.roundFormats,
        sport: sportName ?? null,
      },
      rows,
    );
    return inheritedOverrides(resolved.format);
  }, [data, fixture, sportName]);

  if (!data?.supported) return null;

  const locked = fixture?.scorecard_status === 'locked';
  const inheritLabel = (v: number | undefined, unit = 'min') =>
    v === undefined ? '- inherit -' : v === 0 ? '- inherit (none) -' : `- inherit (${v} ${unit}) -`;

  return (
    <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
      <Field compact label="Half / period length"
        hint={locked ? 'Unlock the scorecard to change the rules.' : 'Per period, not the match total.'}>
        <Select className="w-full" value={periodMin} disabled={locked}
          onChange={(e) => onPeriodMin(e.target.value)}>
          <option value="">{inheritLabel(inherited?.periodMinutes)}</option>
          {[5, 7, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45].map((m) => (
            <option key={m} value={m}>{m} min</option>
          ))}
        </Select>
      </Field>

      <Field compact label="Extra time"
        hint={draws === 'yes' ? 'Not used while a draw is allowed.' : 'Each extra period.'}>
        {/* Greyed while draws are allowed, because then it can never run - the kernel
            closes a level match as a draw and never asks. */}
        <Select className="w-full" value={extraMin} disabled={locked || draws === 'yes'}
          onChange={(e) => onExtraMin(e.target.value)}>
          <option value="">{inheritLabel(inherited?.extraTimeMinutes)}</option>
          {[3, 5, 7, 10, 15].map((m) => <option key={m} value={m}>{m} min</option>)}
        </Select>
      </Field>

      <Field compact label="Draw allowed"
        hint={draws === 'no' ? 'Level at full time goes to extra time, then penalties.' : undefined}>
        <Select className="w-full" value={draws} disabled={locked}
          onChange={(e) => onDraws(e.target.value)}>
          <option value="">
            {inherited === null ? '- inherit -'
              : `- inherit (${inherited.drawsAllowed ? 'yes' : 'no'}) -`}
          </option>
          <option value="yes">Yes — record a draw</option>
          <option value="no">No — must produce a winner</option>
        </Select>
      </Field>
    </div>
  );
}

/**
 * The format for ONE match.
 *
 * Blank means inherit - round, then draw, then sport default - and the hint says
 * which of those is currently in force, so setting an override is a decision made
 * with the current answer in view rather than in the dark.
 *
 * CONTROLLED BY THE DIALOG, not self-saving. It used to write immediately on change
 * while every other field on the dialog waited for Save, so somebody who picked a
 * format and pressed Save had no idea which of the two had actually stored it - and
 * somebody who picked one and pressed Cancel had already changed it.
 */
function MatchFormatField({ fixture, tdId, value, onChange }: {
  fixture: any; tdId: string; value: string; onChange: (v: string) => void;
}) {
  const { data } = useApi<{
    presets: any[];
    saved: Array<{ id: string; name: string; config: any }>;
    current?: { formatId: string | null; roundFormats: unknown };
    supported?: boolean;
  }>(`/tournament-disciplines/${tdId}/scoring-formats`);
  if (!data?.supported) return null;

  // Only SAVED formats can be pinned to a single match: the column holds an id.
  const saved = data.saved ?? [];
  // The rules this match is CURRENTLY playing under. A match that has been scored
  // has them frozen into live_state, and that snapshot outranks every configured
  // layer - so showing it is the difference between a change that visibly takes
  // effect and one that silently does not.
  const frozen: string | null = fixture?.live_state?.format?.name ?? null;
  const locked = fixture?.scorecard_status === 'locked';

  return (
    <div className="mt-1 grid gap-1.5">
      <Field
        compact
        label="Format for this match only"
        hint={locked
          ? 'This scorecard is locked. Unlock it first - changing the rules of an official result has to leave a record.'
          : saved.length
            ? (fixture?.round
              ? `Blank means it inherits from ${fixture.round}, then the draw.`
              : 'Blank means it inherits the draw default.')
            : 'No saved formats yet - save one from the draw’s Format dialog and it can be pinned to a single match.'}
      >
        <Select
          className="w-full"
          value={value}
          disabled={!saved.length || locked}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Inherit (round, then draw)</option>
          {saved.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
      </Field>

      {frozen && !locked && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          Playing under <span className="font-semibold">{frozen}</span>, fixed when scoring
          started. Changing the format above re-applies it from the next point.
        </p>
      )}
    </div>
  );
}

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

/** A section header inside FixtureModal: the label, then a hairline rule filling
 *  the rest of the row - not a full-width border above the section, which is
 *  what this replaced. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100">{children}</span>
      <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" aria-hidden />
    </div>
  );
}

// Create or edit a single fixture by hand. `fixture === null` ⇒ create mode for the
// given draw; otherwise edit (teams / round / schedule / status) with a delete option.
function FixtureModal({ fixture, tdId, drawPath, sportName, grounds, venues, officials, teamName, onClose }:
  { fixture: any | null; tdId: string; drawPath: string; sportName?: string; grounds: Ground[]; venues: Venue[]; officials: Official[]; teamName: (id: string | null) => string; onClose: () => void }) {
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
  // The per-match scoring format, saved by this dialog along with everything else.
  const [formatId, setFormatId] = useState<string>(fixture?.scoring_format_id ?? '');
  /**
   * PER-MATCH RULES. '' means inherit, and that is the whole point of these three -
   * they carry only what was changed, so the match keeps following its draw for
   * everything else. Seeded from the column, which holds exactly the same shape.
   */
  const ov = (fixture?.format_overrides ?? null) as
    { periodMinutes?: number; extraTimeMinutes?: number; drawsAllowed?: boolean } | null;
  const [periodMin, setPeriodMin] = useState(ov?.periodMinutes ? String(ov.periodMinutes) : '');
  const [extraMin, setExtraMin] = useState(ov?.extraTimeMinutes ? String(ov.extraTimeMinutes) : '');
  const [drawsOv, setDrawsOv] = useState(
    ov?.drawsAllowed === undefined ? '' : ov.drawsAllowed ? 'yes' : 'no',
  );
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
      format_overrides: (() => {
        const o: Record<string, unknown> = {};
        if (periodMin) o.periodMinutes = Number(periodMin);
        if (extraMin) o.extraTimeMinutes = Number(extraMin);
        if (drawsOv) o.drawsAllowed = drawsOv === 'yes';
        // Null, not {}, so clearing every field really clears the column rather
        // than leaving an empty object that reads as "configured".
        return Object.keys(o).length ? o : null;
      })(),
    };
    if (!isEdit) body.tournament_discipline_id = tdId;
    save.mutate(body, {
      onSuccess: async () => {
        // The format lives on its own endpoint (it clears the frozen snapshot and
        // refuses a locked card), so it is saved after the fixture rather than
        // smuggled into the same body.
        const current = fixture?.scoring_format_id ?? '';
        if (isEdit && formatId !== current) {
          try {
            const r = await api('PATCH', `/fixtures/${fixture.id}/scoring-format`,
              { scoringFormatId: formatId || null }) as { reapplied?: boolean };
            toast.success(r?.reapplied
              ? 'Saved - format changed, and the points already scored were played under the old rules'
              : 'Fixture saved');
            return;
          } catch (e: any) { toast.error(e.message); return; }
        }
        toast.success(isEdit ? 'Fixture saved' : 'Fixture added');
      },
      onError: (e: any) => setError(e.message),
    });
  };

  const title = isEdit ? `Edit · ${teamName(fixture.home_team_id)} vs ${teamName(fixture.away_team_id)}` : 'Add fixture';
  const teamHint = teams.length === 0 ? 'No teams registered to this draw yet.' : undefined;

  // The banner reads the fields being edited (venue, ground, status, time), not
  // the fixture as it was when the dialog opened - so it stays true as somebody
  // works through the form instead of describing a state they've already changed.
  const venueName = venues.find((v) => v.id === venueId)?.name;
  const groundName = grounds.find((g) => g.id === groundId)?.name;
  const venueLabel = venueName ? (groundName ? `${venueName} · ${groundName}` : venueName) : 'Venue unassigned';
  // A local 12-hour formatter, not the shared fmtDateTime - that one follows the
  // browser's own locale default (24-hour for en-GB, which is what showed here),
  // and it's used in enough other places that changing its default wasn't asked
  // for and isn't this banner's call to make.
  const fmtBannerTime = (d: string) => {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return null;
    const s = date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
    // Some locales render the am/pm marker lowercase - force it up rather than
    // gamble on which locale the browser reports.
    return s.replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
  };
  const metaLine = [sportName, round.trim(), when ? fmtBannerTime(when) : null, venueLabel].filter(Boolean).join(' · ');
  const banner = isEdit ? (
    <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-blue-300">
          <span>Edit match</span>
          {fixture.match_no != null && <span className="text-blue-400/80">· MATCH-{fixture.match_no}</span>}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-lg font-bold text-white">{teamName(homeId) || 'TBD'}</span>
          <span className="shrink-0 rounded-full border border-white/25 px-2 py-0.5 text-[10px] font-bold text-white/80">VS</span>
          <span className="truncate text-lg font-bold text-white">{teamName(awayId) || 'TBD'}</span>
        </div>
        {metaLine && <div className="mt-0.5 truncate text-xs text-blue-100/80">{metaLine}</div>}
      </div>
      <span className="mt-0.5 flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
        <span className="h-1.5 w-1.5 rounded-full bg-white/80" aria-hidden />
        {titleCase(status)}
      </span>
    </div>
  ) : (
    // Nothing to describe yet (no teams, no schedule) - just the same dark
    // header the edit dialog uses, so the two don't look like different
    // screens depending on whether a fixture already exists.
    <span className="text-lg font-bold text-white">Add fixture</span>
  );
  // Disambiguate same-named teams (e.g. several "Badminton (Mixed)" draws) by
  // appending who each squad plays FOR - its campus or batch when it has one, its
  // organisation otherwise. Appending the organisation unconditionally
  // disambiguated nothing inside an internal championship, where every squad
  // belongs to the same one.
  const optLabel = (t: any) => {
    const who = t.org_units?.name || t.organizations?.short_name || t.organizations?.name;
    return who ? `${t.name} — ${who}` : t.name;
  };
  // The grounds belonging to the chosen venue (venues come straight from the venues
  // list, so a venue with no courts still shows and is selectable).
  const venueGrounds = grounds.filter((g) => (g.venue_id ?? '') === venueId);

  return (
    <Modal title={title} onClose={onClose} size="5xl" banner={banner}>
      {/* Wide enough for four fields to sit in one row (the reference this was
          built against), not just two - `5xl` (1024px). Field labels are
          forced uppercase here only (not a change to the shared Field
          component, which dozens of other screens use as-is) via the
          arbitrary-variant selector below. `[&>*]:min-w-0` on each grid is
          the actual equal-width fix: a grid item defaults to
          `min-width: auto`, so the native date/time input's intrinsic content
          width was overriding the `1fr` track and making that one column
          wider than its siblings even though the grid asked for four equal
          shares. */}
      <div className="[&_label>span:first-child]:uppercase [&_label>span:first-child]:tracking-wide">
        <SectionLabel>Teams</SectionLabel>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 [&>*]:min-w-0">
          <Field compact label="Home team" hint={teamHint}>
            <Select className="w-full" value={homeId} onChange={(e) => setHomeId(e.target.value)}>
              <option value="">- TBD -</option>
              {/* Hide the team already picked as Away - a team can't play itself. */}
              {teams.filter((t) => t.id !== awayId).map((t) => <option key={t.id} value={t.id}>{optLabel(t)}</option>)}
            </Select>
          </Field>
          <Field compact label="Away team">
            <Select className="w-full" value={awayId} onChange={(e) => setAwayId(e.target.value)}>
              <option value="">- TBD / bye -</option>
              {/* Hide the team already picked as Home - a team can't play itself. */}
              {teams.filter((t) => t.id !== homeId).map((t) => <option key={t.id} value={t.id}>{optLabel(t)}</option>)}
            </Select>
          </Field>
        </div>

        <div className="mt-4">
          <SectionLabel>Schedule</SectionLabel>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
            <Field compact label="Date & time">
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-400" />
            </Field>
            <Field compact label="Duration" hint="Defaults to the draw's match length">
              <Select className="w-full" value={duration} onChange={(e) => setDuration(e.target.value)}>
                <option value="">- default -</option>
                {[15, 20, 30, 45, 60, 75, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
              </Select>
            </Field>
            <Field compact label="Venue" hint={venues.length === 0 ? 'No venues set up for this championship yet.' : undefined}>
              <Select className="w-full" value={venueId} onChange={(e) => {
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
            <Field compact label="Ground / court" hint={!venueId ? 'Unlocks once a venue is set' : venueGrounds.length === 0 ? 'This venue has no courts - assign at the venue level.' : undefined}>
              <Select className="w-full" value={groundId} disabled={!venueId || venueGrounds.length === 0} onChange={(e) => setGroundId(e.target.value)}>
                <option value="">{venueId ? '- any court -' : '- pick a venue first -'}</option>
                {venueGrounds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            </Field>
          </div>
        </div>

        <div className="mt-4">
          <SectionLabel>Match rules</SectionLabel>
          <MatchRulesFields
            fixture={fixture} tdId={tdId} sportName={sportName}
            periodMin={periodMin} onPeriodMin={setPeriodMin}
            extraMin={extraMin} onExtraMin={setExtraMin}
            draws={drawsOv} onDraws={setDrawsOv}
          />
        </div>

        <div className="mt-4">
          <SectionLabel>Stage & officiating</SectionLabel>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
            <Field compact label="Round" hint="e.g. Final, SF, Group A, Match 1">
              <Input value={round} onChange={(e) => setRound(e.target.value)} placeholder="Match" />
            </Field>
            <Field compact label="Status">
              <Select className="w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
                {FIXTURE_STATUS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </Select>
            </Field>
            <Field compact label="Match official" hint={officials.length === 0 ? 'No officials assigned yet - add them on the Organising team tab.' : undefined}>
              <Select className="w-full" value={officialId} onChange={(e) => setOfficialId(e.target.value)}>
                <option value="">- unassigned -</option>
                {officials.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
          {/* THIS MATCH ONLY - rung 6 of the ladder.
              A round can play its own format, and so can a single match: a
              rain-shortened final, or a re-scheduled tie squeezed into a
              20-minute slot. Left blank the match inherits its round, then
              the draw, then the sport default. */}
          {isEdit && isScoredSport(sportName) && (
            <MatchFormatField fixture={fixture} tdId={tdId} value={formatId} onChange={setFormatId} />
          )}
          </div>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      {isEdit && isScoredSport(sportName) && (
        <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          This match inherits its format from the round, then the draw. Save a format in the draw's Format dialog to pin one to a single match.
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        {isEdit ? (
          <Button variant="ghost" className="text-rose-600 dark:text-rose-400"
            onClick={async () => { if (await confirmDialog({ title: 'Delete fixture', confirmLabel: 'Delete', message: 'Delete this fixture? This cannot be undone.' })) remove.mutate(undefined, { onSuccess: () => toast.success('Fixture deleted'), onError: (e: any) => setError(e.message) }); }}
            disabled={remove.isPending}
            aria-label="Delete fixture"
            title={remove.isPending ? 'Deleting…' : 'Delete fixture'}>
            <Trash2 size={16} />
          </Button>
        ) : <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {/* The scoring entry point for EVERY view, not just the list.
              The bracket and the round-robin grid both open this dialog on select
              (onSelect={setEditing}), as does the schedule timeline - so putting the
              action here reaches all three at once. A cell in a bracket has room for
              two team names and a score and nothing else; a second button per cell
              would not fit on a phone. */}
          {isEdit && <ScoreButton fixture={fixture} sportName={sportName} onNavigate={onClose} />}
          <Button disabled={save.isPending} onClick={submit}>
            {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add fixture'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DrawCard({ td, fixtures: drawFixtures, fixturesLoading, teamsLoading, fixturesPath, teamsPath, sportName, formatLabel, teamName, teamOrg, grounds, venues, officials, canManage }:
  { td: any; fixtures: any[]; fixturesLoading: boolean; teamsLoading: boolean; fixturesPath: string; teamsPath: string; sportName: string; formatLabel?: string | null; teamName: (id: string | null) => string; teamOrg: (id: string | null) => string; grounds: Ground[]; venues: Venue[]; officials: Official[]; canManage: boolean }) {
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
  // Team NAMES come from a separate, championship-wide query (teamsPath) - generating
  // a draw only invalidates the fixtures themselves, and a fixture's home/away team_id
  // is real the instant it's created. Rendering it before that other query has ever
  // resolved is what produced EOS-131: a freshly generated League table showing every
  // cell as "TBD" - not because the fixtures were wrong, but because the grid had
  // nothing to look the names up in yet. Blocking on both queries here (rather than
  // just fixturesLoading) keeps the grid from ever painting real fixtures with no
  // names to show for them.
  const isLoading = fixturesLoading || teamsLoading;
  const qc = useQueryClient();
  const generate = useApiMutation(
    (replace?: boolean) => api('POST', `/tournament-disciplines/${td.id}/fixtures/generate`, { params: {}, ...(replace ? { replace: true } : {}) }),
    [fixturesPath, teamsPath],
  );
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'list' | 'visual'>('visual');
  // The format is settled BEFORE the draw generates, so every fixture resolves a
  // real format from the moment it exists. Racquet sports only - everything else
  // generates straight away, exactly as before.
  const [picking, setPicking] = useState(false);
  const drawNavigate = useNavigate();
  const { eventId: drawEventId } = useParams();
  const [editingFormat, setEditingFormat] = useState(false);
  // A pool-shaped format (Groups + Knockout and the like) can never be built by the
  // single-stage /fixtures/generate route below - it produces pools XOR a bracket,
  // never both (apps/api/.../generators/index.ts). Only the stage-config wizard
  // (generate-all) actually builds pools feeding a bracket, so that's the ONLY
  // generation action offered here for these formats - EOS-127: an organiser who
  // picked "Groups + Knockout" and pressed the plain Generate button got a bare
  // knockout bracket with no pools, silently, because that button was never able
  // to produce the combined shape it looked like it would.
  const [configuringStages, setConfiguringStages] = useState(false);

  // Once any fixture has been played, regenerating would erase results - the server
  // refuses it, so disable the button and explain why rather than letting it 500.
  // A bye has no real result to lose (mirrors the server's own check, which also
  // leaves 'bye' out - see fixtures.routes.ts), so it doesn't count as played here.
  const hasPlayed = fixtures.some((f) => ['completed', 'walkover'].includes(f.status) || f.home_score != null || f.away_score != null);
  // Leagues generate incrementally (keep existing matches, add the new teams' fixtures),
  // so the action stays available mid-tournament; knockout/pool draws rebuild from
  // scratch and are blocked once anything's been played.
  const isLeague = /league|round.?robin/i.test(formatLabel ?? '');
  const hasBracket = fixtures.some((f) => f.bracket_position != null);
  // "Add new teams" only makes sense over a draw that IS actually a league/round-robin
  // (a round-robin generator never sets bracket_position - see round-robin.ts). If the
  // discipline's format was switched to League AFTER a Knockout/pool draw was already
  // generated, these fixtures are leftovers from that shape: every team already
  // appears in one of them, so "add new teams" would silently do nothing while the
  // bracket stays a bracket forever - there'd be no way left to ever get the
  // crosstable this format is supposed to show. Treat that case as the rebuild it
  // actually is, same as any other format's Regenerate.
  const leagueDrawMismatched = isLeague && hasBracket;
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
  // Same substring test the backend's generator dispatch and the Setup → Sports
  // "Configure stages" button both use - see isPoolShapedFormat's own doc comment.
  const poolShaped = isPoolShapedFormat(formatLabel);
  const branchLabels = resolveBranchLabels(td.format_config);
  const stageLabel = (seq: number, groupHasBracket: boolean) =>
    branchLabels.get(seq) ?? (seq === 1 ? (groupHasBracket ? 'Bracket' : 'Pools') : `Stage ${seq}`);

  // Scoring straight from the bracket tree, without opening a dialog first.
  // Scoring straight from the bracket tree, without opening a dialog first.
  const goScore = (f: { id: string }) => drawNavigate(`/score/${f.id}`, {
    state: { from: `/championships/${drawEventId}/schedule` },
  });

  // A rebuild over an existing (unplayed) draw discards its scheduling, grounds and
  // official assignments, so the server refuses it outright unless told explicitly
  // (generateDrawSchema.replace) - that's the confirmation this dialog performs.
  // Leagues are exempt: "Add new teams" only adds fixtures, it never rebuilds - unless
  // the existing draw doesn't actually match (leagueDrawMismatched), in which case
  // this IS a rebuild wearing the league button, and needs the same warning.
  const runGenerate = async () => {
    if ((!isLeague || leagueDrawMismatched) && fixtures.length > 0) {
      const ok = await confirmDialog({
        title: 'Regenerate draw',
        confirmLabel: 'Regenerate',
        message: leagueDrawMismatched
          ? 'This draw still has its old Knockout/pool fixtures from before the format changed - regenerating replaces them with a real league draw. Continue?'
          : 'This draw already has fixtures. Regenerating replaces them (and their times, grounds and officials) - continue?',
      });
      if (!ok) return;
    }
    // The response is the draw's full fixture list post-generate, whether anything
    // was added or not - the incremental league path returns just as successfully
    // when there was nobody new to add. Comparing its length to what was on screen
    // a moment ago (captured by this closure) is what actually tells the two apart;
    // the server has no separate "created: 0" flag to read instead.
    const before = fixtures.length;
    generate.mutate(true, {
      onSuccess: (rows: any[]) => {
        if (isLeague && !leagueDrawMismatched && before) {
          toast.success(rows.length > before ? 'New teams added' : 'No new teams to add - everyone already has fixtures');
        } else {
          toast.success('Draw generated');
        }
      },
      onError: (e: any) => toast.error(e.message),
    });
  };

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
          <div className="text-xs text-slate-500 dark:text-slate-400">{titleCase(td.entry_type)} Draw · {fixtures.length} fixture{fixtures.length === 1 ? '' : 's'}</div>
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
          {/* Editing the format AFTER generation. It was only reachable from the
              Generate button, so once a draw existed its scoring rules were frozen
              with no way back - and the per-round overrides (QF short, Final full)
              could never be changed at all. Every scored sport now, cricket
              included - it has a format shelf of its own. */}
          {canManage && isScoredSport(sportName) && (
            <Button size="sm" variant="subtle" onClick={() => setEditingFormat(true)}>Format</Button>
          )}
          {canManage && <Button size="sm" variant="subtle" onClick={() => setCreating(true)}>+ Add fixture</Button>}
          {canManage && (
            poolShaped ? (
              // Pools feeding a bracket can only ever come from the stage-config
              // wizard (generate-all) - the plain single-stage route below can never
              // produce both, so it is not offered at all for this shape of format.
              <Button size="sm" variant={fixtures.length ? 'outline' : 'primary'} disabled={hasPlayed}
                title={hasPlayed
                  ? 'This draw has played matches - reconfiguring would erase those results.'
                  : fixtures.length > 0 && !multiStage
                    ? "This draw was built without its knockout stage - reconfigure it to add one."
                    : undefined}
                onClick={() => setConfiguringStages(true)}>
                {fixtures.length ? 'Reconfigure stages' : 'Configure stages'}
              </Button>
            ) : (
              <Button size="sm" variant={fixtures.length ? 'outline' : 'primary'} disabled={generate.isPending || (hasPlayed && (!isLeague || leagueDrawMismatched))}
                title={isLeague && !leagueDrawMismatched && fixtures.length
                  ? 'Keeps existing matches and adds fixtures for newly-registered teams.'
                  : leagueDrawMismatched
                    ? "This draw still has its old fixtures from before the format changed - regenerate to build this discipline's actual league draw."
                    : hasPlayed ? 'This draw has played matches - regenerating would erase those results.' : undefined}
                onClick={() => {
                  if (isScoredSport(sportName)) { setPicking(true); return; }
                  runGenerate();
                }}>
                {generate.isPending ? 'Generating…' : fixtures.length ? (isLeague && !leagueDrawMismatched ? 'Add new teams' : 'Regenerate') : 'Generate draw'}
              </Button>
            )
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
                  {canManage && <ScoreButton fixture={f} sportName={sportName} />}
                  {canManage && <Button size="sm" variant="ghost" onClick={() => setEditing(f)} aria-label="Edit fixture" title="Edit fixture"><Pencil size={14} /></Button>}
                </div>
              </div>
            ))}
          </div>
        ) : showVisual ? (
          <div className="space-y-6">
            {stageGroups.map(([seq, group]) => {
              const groupHasBracket = group.some((f) => f.bracket_position != null);
              const content = groupHasBracket
                ? <Bracket fixtures={group} teamName={teamName} teamOrg={teamOrg}
                    onSelect={canManage ? setEditing : () => {}}
                    onScore={canManage ? (f: any) => goScore(f) : undefined} />
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
                  {canManage && <ScoreButton fixture={f} sportName={sportName} />}
                  {canManage && <Button size="sm" variant="ghost" onClick={() => setEditing(f)} aria-label="Edit fixture" title="Edit fixture"><Pencil size={14} /></Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && <FixtureModal fixture={editing} tdId={td.id} drawPath={fixturesPath} sportName={sportName} grounds={grounds} venues={venues} officials={officials} teamName={teamName} onClose={() => setEditing(null)} />}
      {creating && <FixtureModal fixture={null} tdId={td.id} drawPath={fixturesPath} sportName={sportName} grounds={grounds} venues={venues} officials={officials} teamName={teamName} onClose={() => setCreating(false)} />}
      {editingFormat && (
        <FormatPicker
          mode="edit"
          tournamentDisciplineId={td.id}
          isKnockout={hasBracket || !isLeague}
          playedCount={fixtures.filter((f: any) => ['completed', 'walkover'].includes(f.status) || f.home_score != null).length}
          fixtureCount={fixtures.length || undefined}
          onClose={() => setEditingFormat(false)}
          onGenerate={() => setEditingFormat(false)}
        />
      )}
      {picking && (
        <FormatPicker
          tournamentDisciplineId={td.id}
          isKnockout={hasBracket || !isLeague}
          fixtureCount={fixtures.length || undefined}
          generateLabel={fixtures.length ? 'Regenerate draw' : 'Generate draw'}
          onClose={() => setPicking(false)}
          onGenerate={() => { setPicking(false); runGenerate(); }}
        />
      )}
      {configuringStages && (
        <Modal title="Configure stages" onClose={() => setConfiguringStages(false)} wide>
          <StageConfigWizard
            tournamentDisciplineId={td.id}
            onGenerated={() => {
              setConfiguringStages(false);
              // The wizard invalidates its OWN per-discipline query key; this page
              // reads the championship-wide fixtures list instead, so it needs its
              // own refresh or the newly-built stages wouldn't show up here without
              // a manual reload.
              qc.invalidateQueries({ queryKey: [fixturesPath] });
            }}
          />
        </Modal>
      )}
    </Card>
  );
}

function SportBlock({ ts, draws, allFixtures, fixturesLoading, teamsLoading, fixturesPath, teamsPath, sportName, formatName, teamName, teamOrg, grounds, venues, officials, canManage }:
  { ts: any; draws: any[]; allFixtures: any[]; fixturesLoading: boolean; teamsLoading: boolean; fixturesPath: string; teamsPath: string; sportName: string; formatName: (id: string | null | undefined) => string | null; teamName: (id: string | null) => string; teamOrg: (id: string | null) => string; grounds: Ground[]; venues: Venue[]; officials: Official[]; canManage: boolean }) {
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
            teamsLoading={teamsLoading}
            fixturesPath={fixturesPath}
            teamsPath={teamsPath}
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
  const teamsPath = `/teams?championship_id=${eventId}`;
  // isFetching, not isLoading: a generate/regenerate invalidates this alongside the
  // fixtures it just created, and isLoading only covers the FIRST fetch - a
  // background refetch after that leaves isLoading false while the cached team
  // list is still the pre-generate one. isFetching stays true for both, which is
  // what actually keeps a freshly generated draw from painting real fixtures
  // against a team list that hasn't caught up yet (EOS-131's "blank league table").
  const { data: teams = [], isFetching: teamsLoading } = useApi<any[]>(teamsPath);
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
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
          {visibleTsports.map((ts) => <SportBlock key={ts.id} ts={ts} draws={allDraws.filter((d) => d.tournament_sport_id === ts.id)} allFixtures={allFixtures} fixturesLoading={fixturesLoading} teamsLoading={teamsLoading} fixturesPath={fixturesPath} teamsPath={teamsPath} sportName={sportName(ts.sport_id)} formatName={formatName} teamName={teamName} teamOrg={teamOrg} grounds={grounds} venues={venues} officials={officials} canManage={canManage} />)}
        </div>
      )}
    </div>
  );
}
