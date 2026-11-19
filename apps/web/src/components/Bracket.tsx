import { useMemo } from 'react';
import { Trophy } from 'lucide-react';
import { knockoutRoundSize, KNOCKOUT_ROUND, EARLY_END_LABEL, earlyEndOf, formatPoints, KHO_END_SHORT, khoSettlementOf, shootoutOf, TBD_LABEL } from '@semp/shared';
import { cn } from './ui';
import { describeSlot, describeTieBlocked, isTieBlockedFor } from '../lib/stageTree';
import { doneLabel, matchPhase, TeamAvatar } from '../features/schedule/ScheduleParts';

// A fixture as returned by GET /tournament-disciplines/:id/fixtures. Only the
// fields the bracket needs are typed; the rest are passed straight through.
export interface BracketFixture {
  id: string;
  round: string | null;
  bracket_position: number | null;
  home_team_id: string | null;
  away_team_id: string | null;
  // Stage-config placeholder ("A1", "L3") for a side not yet resolved to a team;
  // null once resolved or on single-stage disciplines.
  home_slot_label?: string | null;
  away_slot_label?: string | null;
  // Set by stage-resolver.ts when the feeding pool ended in an unbreakable tie;
  // the slot stays stuck until an organiser intervenes.
  live_state?: { tie_blocked?: { pool: number; rank: number }; rally?: unknown } | null;
  home_score?: number | null;
  away_score?: number | null;
  winner_team_id?: string | null;
  status?: string | null;
  scheduled_at?: string | null;
  match_no?: number | null;
}

// ---- layout constants (px) ----
const MATCH_W = 236;
const META_H = 26;   // top line: when + status
const ROW_H = 40;    // each team row (name + organisation sub-line)
const MATCH_H = META_H + ROW_H * 2 + 3; // card height (also drives connector geometry)
const ROW_GAP = 26;  // vertical gap between first-round matches
const COL_GAP = 56;  // horizontal gap between rounds (room for connectors)
const HEADER_H = 40; // round-label band above the columns
const R = 8;         // connector corner radius

// Human-friendly column heading from the generator's terse round labels.
function roundTitle(round: string | null, teamsInRound: number): string {
  switch (round) {
    case KNOCKOUT_ROUND.final: return 'Final';
    case KNOCKOUT_ROUND.semiFinal: return 'Semi-finals';
    case KNOCKOUT_ROUND.quarterFinal: return 'Quarter-finals';
    default:
      if (knockoutRoundSize(round) > 0) return `Round of ${knockoutRoundSize(round)}`;
      return round ?? `Round of ${teamsInRound}`;
  }
}

function when(iso?: string | null): string {
  if (!iso) return 'Time TBD';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Time TBD';
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
  if (d.toDateString() === new Date().toDateString()) return `Today ${time}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${time}`;
}

const RAIL = { live: 'bg-rose-500', done: 'bg-emerald-500', upcoming: 'bg-sky-500', unscheduled: 'bg-amber-400', off: 'bg-slate-300 dark:bg-slate-600' } as const;

function TeamRow({ name, short, org, score, isWinner, decided, warning, placeholder, note, pens, settled, champion }:
  { name: string; short?: string | null; org?: string; score: number | null | undefined; isWinner: boolean; decided: boolean; warning?: boolean; placeholder?: boolean; note?: string | null; pens?: number | null; settled?: string | null; champion?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 pl-3 pr-2',
        isWinner && 'bg-emerald-50/70 dark:bg-emerald-500/10',
        warning ? 'text-amber-600 dark:text-amber-400' : isWinner ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-300',
        decided && !isWinner && !warning && 'opacity-55',
      )}
      style={{ height: ROW_H }}
      title={warning || placeholder ? name : undefined}
    >
      <span className="flex min-w-0 items-center gap-2">
        {warning ? <span aria-hidden>⚠</span> : <TeamAvatar name={placeholder ? null : name} short={short} size="sm" />}
        <span className="min-w-0">
          <span className={cn('flex items-center gap-1 text-[13px] leading-tight', placeholder && 'italic text-slate-400 dark:text-slate-500')}>
            {/* pr: an italic last letter leans past the box and truncate would clip it. */}
            <span className={cn('truncate', placeholder && 'pr-1')}>{name}</span>
            {/* The final's winner: a small trophy, not a card of its own. */}
            {champion && <Trophy size={13} className="shrink-0 text-amber-500" aria-label="Champion" />}
          </span>
          {org && <span className="block truncate text-[10px] font-normal leading-tight text-slate-400 dark:text-slate-500">{org}</span>}
        </span>
      </span>
      {score != null && (
        <span className={cn('flex shrink-0 items-center gap-1 tabular-nums')}>
          {/* Retired / DSQ / conceded: marked on the side that stopped. */}
          {note && <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">{note}</span>}
          <span className={cn('grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-sm font-black',
            isWinner ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200')}>
            {formatPoints(score)}
          </span>
          {/* Shoot-out kicks scored, beside a level score. */}
          {pens != null && <span className="text-[10px] font-semibold text-brand-600 dark:text-brand-400" title="Penalty shoot-out">({pens})</span>}
          {/* Kho kho: how a level or lopsided match was settled, on the winner's row. */}
          {settled && <span className="text-[10px] font-semibold text-brand-600 dark:text-brand-400">({settled})</span>}
        </span>
      )}
    </div>
  );
}

function MatchCard({ fixture, x, top, teamName, teamShort, teamOrg, onSelect, onScore, isFinal = false, sportName }:
  { fixture: BracketFixture; x: number; top: number; teamName: (id: string | null) => string; teamShort?: (id: string | null) => string | null; teamOrg?: (id: string | null) => string; onSelect?: (f: BracketFixture) => void; onScore?: (f: BracketFixture) => void; isFinal?: boolean; sportName?: string | null }) {
  const isBye = fixture.status === 'bye';
  const decided = fixture.winner_team_id != null;
  const phase = matchPhase(fixture);
  const tieBlocked = fixture.live_state?.tie_blocked ?? null;
  const homeTieMsg = !fixture.home_team_id && isTieBlockedFor(fixture.home_slot_label, tieBlocked) ? describeTieBlocked(tieBlocked) : null;
  const awayTieMsg = !fixture.away_team_id && isTieBlockedFor(fixture.away_slot_label, tieBlocked) ? describeTieBlocked(tieBlocked) : null;
  // On a stage-config draw a null team means "not resolved yet": show what it waits on
  // ("1st in Pool A"), or a warning if the feeding pool is stuck tied and needs the organiser.
  const home = fixture.home_team_id ? teamName(fixture.home_team_id) : (homeTieMsg ?? describeSlot(fixture.home_slot_label) ?? TBD_LABEL);
  const away = isBye ? 'Bye' : fixture.away_team_id ? teamName(fixture.away_team_id) : (awayTieMsg ?? describeSlot(fixture.away_slot_label) ?? TBD_LABEL);
  const homeOrg = teamOrg?.(fixture.home_team_id) ?? '';
  const awayOrg = isBye ? '' : teamOrg?.(fixture.away_team_id) ?? '';
  // Any match can be opened to edit - a real match to schedule it (even a later-round
  // slot whose teams are still TBD), or a bye to adjust its teams/status or delete it.
  const clickable = !!onSelect;

  // Scoreable straight from the tree: both sides known, and not a state that can
  // never be played. A later-round slot still showing TBD has nothing to score.
  const scorable = !!onScore && !!fixture.home_team_id && !!fixture.away_team_id
    && !['cancelled', 'postponed', 'bye'].includes(fixture.status ?? '');
  const played = ['completed', 'walkover'].includes(fixture.status ?? '');
  const early = decided ? earlyEndOf(fixture.live_state) : null;
  const noteFor = (teamId: string | null) => (early && fixture.winner_team_id !== teamId ? EARLY_END_LABEL[early] : null);
  const pens = decided ? shootoutOf(fixture.live_state) : null;
  const khoEnd = decided ? khoSettlementOf(fixture.live_state) : null;
  const settledFor = (side: 'A' | 'B') => (khoEnd?.winner === side ? KHO_END_SHORT[khoEnd.reason] : null);

  const teamRows = (
    <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
      <TeamRow name={home} short={teamShort?.(fixture.home_team_id)} org={homeOrg} score={fixture.home_score}
        isWinner={decided && fixture.winner_team_id === fixture.home_team_id} decided={decided} warning={!!homeTieMsg}
        placeholder={!fixture.home_team_id} note={noteFor(fixture.home_team_id)} pens={pens?.home} settled={settledFor('A')}
        champion={isFinal && decided && fixture.winner_team_id === fixture.home_team_id} />
      <TeamRow name={away} short={teamShort?.(fixture.away_team_id)} org={awayOrg} score={isBye ? null : fixture.away_score}
        isWinner={decided && fixture.winner_team_id === fixture.away_team_id} decided={decided} warning={!!awayTieMsg}
        placeholder={!fixture.away_team_id} note={noteFor(fixture.away_team_id)} pens={pens?.away} settled={settledFor('B')}
        champion={isFinal && decided && fixture.winner_team_id === fixture.away_team_id} />
    </div>
  );

  const pill = phase === 'live'
    ? <span className="flex items-center gap-1 rounded-full bg-rose-500 px-1.5 py-px text-[9px] font-black uppercase tracking-wider text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />Live</span>
    : phase === 'done'
      ? <span className="rounded-full bg-emerald-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{doneLabel(fixture, sportName, true)}</span>
      : phase === 'off' && !isBye
        ? <span className="rounded-full bg-slate-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400">{fixture.status}</span>
        : null;

  // A DIV, not a button: the score action lives inside the card and a button
  // cannot contain another one. The team rows carry the edit click instead.
  return (
    <div
      className={cn('absolute overflow-hidden rounded-xl border bg-white dark:bg-slate-900',
        isBye ? 'border-dashed border-slate-200 dark:border-slate-700'
          : phase === 'live' ? 'border-rose-200 shadow-md shadow-rose-100 dark:border-rose-500/40 dark:shadow-none'
            : 'border-slate-200 shadow-sm dark:border-slate-700',
        clickable && 'transition hover:-translate-y-px hover:border-brand-300 hover:shadow-md')}
      style={{ width: MATCH_W, height: MATCH_H, left: x, top }}
    >
      {!isBye && <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', RAIL[phase])} />}
      <div className="flex items-center justify-between gap-1 pl-3 pr-1.5" style={{ height: META_H }}>
        <span className={cn('truncate text-[10px] font-semibold uppercase tracking-wide',
          phase === 'unscheduled' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500')}>
          {isBye ? 'Bye' : when(fixture.scheduled_at)}
          {fixture.match_no != null && <span className="ml-1.5 text-slate-300 dark:text-slate-600">#{fixture.match_no}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {pill}
          {scorable && (
            <button
              type="button"
              title={played ? 'Open the scorecard' : fixture.status === 'live' ? 'Resume scoring' : 'Score this match'}
              onClick={(e) => { e.stopPropagation(); onScore!(fixture); }}
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide transition-colors',
                fixture.status === 'live'
                  ? 'bg-brand-600 text-white hover:bg-brand-700'
                  : played
                    ? 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    : 'border border-slate-300 text-slate-600 hover:border-brand-400 hover:text-brand-700 dark:border-slate-600 dark:text-slate-300',
              )}
            >
              {fixture.status === 'live' ? 'Resume' : played ? 'Card' : 'Score'}
            </button>
          )}
        </span>
      </div>
      {clickable ? (
        <button
          type="button"
          title={isBye ? 'Edit this bye' : 'Schedule this match'}
          onClick={() => onSelect!(fixture)}
          className="block w-full cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/40"
        >
          {teamRows}
        </button>
      ) : teamRows}
    </div>
  );
}

/** A rounded elbow from a child match to the column's mid-line, then up/down to its parent. */
function elbow(x1: number, y: number, midX: number, yp: number): string {
  if (Math.abs(yp - y) < 1) return `M ${x1} ${y} H ${midX}`;
  const s = yp > y ? 1 : -1;
  return `M ${x1} ${y} H ${midX - R} Q ${midX} ${y} ${midX} ${y + s * R} V ${yp}`;
}

// Expects the generator's perfect-binary-tree layout keyed by bracket_position;
// matches without one (e.g. a 3rd-place playoff) render below the tree.
export function Bracket({ fixtures, sportName, teamName, teamShort, teamOrg, onSelect, onScore }:
  { fixtures: BracketFixture[]; sportName?: string | null; teamName: (id: string | null) => string; teamShort?: (id: string | null) => string | null; teamOrg?: (id: string | null) => string; onSelect?: (f: BracketFixture) => void; onScore?: (f: BracketFixture) => void }) {
  const { rounds, extras, centers, treeW, height } = useMemo(() => {
    const bracketed = fixtures.filter((f) => f.bracket_position != null);
    const extras = fixtures.filter((f) => f.bracket_position == null);

    // Group by round label, then order rounds first → final by lowest position.
    const byRound = new Map<string, BracketFixture[]>();
    for (const f of bracketed) {
      const key = f.round ?? 'Match';
      const bucket = byRound.get(key) ?? byRound.set(key, []).get(key)!;
      bucket.push(f);
    }
    const rounds = [...byRound.values()]
      .map((ms) => ms.slice().sort((a, b) => (a.bracket_position ?? 0) - (b.bracket_position ?? 0)))
      .sort((a, b) => (a[0].bracket_position ?? 0) - (b[0].bracket_position ?? 0));

    // y-centre of every match: round 0 stacks evenly, later rounds sit halfway
    // between the two children they feed from.
    const centers: number[][] = [];
    rounds.forEach((ms, r) => {
      centers[r] = ms.map((_, i) =>
        r === 0
          ? i * (MATCH_H + ROW_GAP) + MATCH_H / 2
          : (centers[r - 1][2 * i] + centers[r - 1][2 * i + 1]) / 2,
      );
    });

    const first = rounds[0]?.length ?? 0;
    const height = first > 0 ? first * MATCH_H + (first - 1) * ROW_GAP : 0;
    const treeW = rounds.length > 0 ? rounds.length * (MATCH_W + COL_GAP) - COL_GAP : 0;
    return { rounds, extras, centers, treeW, height };
  }, [fixtures]);

  const colX = (r: number) => r * (MATCH_W + COL_GAP);
  // The tree ends in a single match: give it a champion box to point at.
  const finalMatch = rounds.length > 0 && rounds[rounds.length - 1].length === 1 ? rounds[rounds.length - 1][0] : null;
  const width = treeW;
  const boxH = Math.max(height, MATCH_H);

  if (rounds.length === 0) {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-400 dark:bg-slate-800/60 dark:text-slate-500">
        Bracket view is available once a knockout draw is generated.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl bg-gradient-to-b from-slate-50 to-white p-3 pb-4 dark:from-slate-800/40 dark:to-transparent">
      {/* round headings */}
      <div className="relative" style={{ width, height: HEADER_H }}>
        {rounds.map((ms, r) => {
          const isFinal = finalMatch && r === rounds.length - 1;
          return (
            <div key={r} className="absolute flex justify-center" style={{ left: colX(r), width: MATCH_W }}>
              <span className={cn('rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wider',
                isFinal ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700')}>
                {roundTitle(ms[0].round ?? null, ms.length * 2)}
                {ms.length > 1 && <span className="ml-1 font-semibold opacity-60">· {ms.length}</span>}
              </span>
            </div>
          );
        })}
      </div>

      <div className="relative" style={{ width, height: boxH }}>
        {/* connector lines: a decided match's line lights up toward the next round */}
        <svg className="pointer-events-none absolute inset-0" width={width} height={boxH} aria-hidden fill="none" strokeLinecap="round">
          {rounds.slice(1).map((ms, idx) => {
            const r = idx + 1;
            const childRight = colX(r - 1) + MATCH_W;
            const parentLeft = colX(r);
            const midX = childRight + COL_GAP / 2;
            return ms.map((_, i) => {
              const kids = [rounds[r - 1][2 * i], rounds[r - 1][2 * i + 1]];
              const yp = centers[r][i];
              const anyDecided = kids.some((k) => k?.winner_team_id);
              return (
                <g key={i}>
                  {kids.map((k, j) => k && (
                    <path key={j} d={elbow(childRight, centers[r - 1][2 * i + j], midX, yp)}
                      className={k.winner_team_id ? 'stroke-brand-500' : 'stroke-slate-300 dark:stroke-slate-600'} strokeWidth={k.winner_team_id ? 2.5 : 1.5} />
                  ))}
                  <path d={`M ${midX} ${yp} H ${parentLeft}`}
                    className={anyDecided ? 'stroke-brand-500' : 'stroke-slate-300 dark:stroke-slate-600'} strokeWidth={anyDecided ? 2.5 : 1.5} />
                </g>
              );
            });
          })}
        </svg>

        {/* match cards */}
        {rounds.map((ms, r) =>
          ms.map((f, i) => (
            <MatchCard
              key={f.id}
              fixture={f}
              x={colX(r)}
              top={centers[r][i] - MATCH_H / 2}
              teamName={teamName}
              teamShort={teamShort}
              teamOrg={teamOrg}
              onSelect={onSelect}
              onScore={onScore}
              isFinal={f === finalMatch}
              sportName={sportName}
            />
          )),
        )}
      </div>

      {/* matches outside the tree, e.g. 3rd-place playoff */}
      {extras.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-6 border-t border-slate-200 pt-4 dark:border-slate-800">
          {extras.map((f) => (
            <div key={f.id} style={{ width: MATCH_W }}>
              <div className="mb-2 flex">
                <span className="rounded-full bg-orange-100 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-orange-800 dark:bg-orange-500/15 dark:text-orange-300">
                  {f.round === KNOCKOUT_ROUND.thirdPlace ? '3rd-place play-off' : f.round ?? 'Match'}
                </span>
              </div>
              <div className="relative" style={{ height: MATCH_H }}>
                <MatchCard fixture={f} x={0} top={0} sportName={sportName} teamName={teamName} teamShort={teamShort} teamOrg={teamOrg} onSelect={onSelect} onScore={onScore} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
