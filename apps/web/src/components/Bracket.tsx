import { useMemo } from 'react';
import { cn, StatusBadge } from './ui';
import { fmtDateTime } from '../lib/hooks';

// A fixture as returned by GET /tournament-disciplines/:id/fixtures. Only the
// fields the bracket needs are typed; the rest are passed straight through.
export interface BracketFixture {
  id: string;
  round: string | null;
  bracket_position: number | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score?: number | null;
  away_score?: number | null;
  winner_team_id?: string | null;
  status?: string | null;
  scheduled_at?: string | null;
}

// ---- layout constants (px) ----
const MATCH_W = 208;
const META_H = 18;   // top line: scheduled time / status
const ROW_H = 26;    // each team row
const MATCH_H = META_H + ROW_H * 2; // fixed so connector geometry is exact
const ROW_GAP = 22;  // vertical gap between first-round matches
const COL_GAP = 52;  // horizontal gap between rounds (room for connectors)
const HEADER_H = 28; // round-label band above the columns

// Display label for a fixture status. A 'scheduled' fixture just means the
// teams are paired (no time set yet), so it reads as "matched" — this also
// avoids clashing with the "Schedule" action button. Other statuses fall
// through to StatusBadge's default rendering.
export function fixtureStatusLabel(status?: string | null): string | undefined {
  return status === 'scheduled' ? 'matched' : undefined;
}

// Human-friendly column heading from the generator's terse round labels.
function roundTitle(round: string | null, teamsInRound: number): string {
  switch (round) {
    case 'Final': return 'Final';
    case 'SF': return 'Semi-finals';
    case 'QF': return 'Quarter-finals';
    default:
      if (round && /^R\d+$/.test(round)) return `Round of ${round.slice(1)}`;
      return round ?? `Round of ${teamsInRound}`;
  }
}

function TeamRow({ name, score, isWinner, decided }:
  { name: string; score: number | null | undefined; isWinner: boolean; decided: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 px-2.5',
        isWinner ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400',
        decided && !isWinner && 'opacity-60',
      )}
      style={{ height: ROW_H }}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {isWinner && <span className="text-[10px] text-brand-500" aria-hidden>▶</span>}
        <span className="truncate">{name}</span>
      </span>
      {score != null && <span className="tnum tabular-nums text-sm">{score}</span>}
    </div>
  );
}

function MatchCard({ fixture, x, top, teamName, onSelect }:
  { fixture: BracketFixture; x: number; top: number; teamName: (id: string | null) => string; onSelect?: (f: BracketFixture) => void }) {
  const isBye = fixture.status === 'bye';
  const decided = fixture.winner_team_id != null;
  const home = teamName(fixture.home_team_id);
  const away = isBye ? 'Bye' : teamName(fixture.away_team_id);
  // Any real match can be scheduled — even a later-round slot whose teams are
  // still TBD (you set the time / venue / official up front). Byes can't.
  const clickable = !!onSelect && !isBye;

  const body = (
    <>
      <div
        className="flex items-center justify-between gap-1 px-2.5 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500"
        style={{ height: META_H }}
      >
        <span className="truncate">{fixture.scheduled_at ? fmtDateTime(fixture.scheduled_at) : 'Unscheduled'}</span>
        {fixture.status && fixture.status !== 'bye' && <StatusBadge status={fixture.status} label={fixtureStatusLabel(fixture.status)} />}
      </div>
      <div className="border-t border-slate-100 dark:border-slate-800">
        <TeamRow name={home} score={fixture.home_score} isWinner={decided && fixture.winner_team_id === fixture.home_team_id} decided={decided} />
        <div className="border-t border-slate-100 dark:border-slate-800" />
        <TeamRow name={away} score={isBye ? null : fixture.away_score} isWinner={decided && fixture.winner_team_id === fixture.away_team_id} decided={decided} />
      </div>
    </>
  );

  const base = cn(
    'absolute overflow-hidden rounded-lg border bg-white shadow-sm dark:bg-slate-900',
    isBye ? 'border-dashed border-slate-200 dark:border-slate-800' : 'border-slate-200 dark:border-slate-700',
  );
  const style = { width: MATCH_W, height: MATCH_H, left: x, top };

  if (clickable) {
    return (
      <button
        type="button"
        title="Schedule this match"
        onClick={() => onSelect!(fixture)}
        className={cn(base, 'cursor-pointer text-left transition-colors hover:border-brand-400 hover:shadow focus:outline-none focus:ring-2 focus:ring-brand-400/40')}
        style={style}
      >
        {body}
      </button>
    );
  }
  return <div className={base} style={style}>{body}</div>;
}

// Renders a single-elimination knockout draw as a left-to-right bracket tree.
// Expects the perfect-binary-tree layout the knockout generator produces
// (every round has half the matches of the previous one), keyed by
// bracket_position. Matches without a bracket_position (e.g. a 3rd-place
// playoff) are rendered separately below the tree.
export function Bracket({ fixtures, teamName, onSelect }:
  { fixtures: BracketFixture[]; teamName: (id: string | null) => string; onSelect?: (f: BracketFixture) => void }) {
  const { rounds, extras, centers, width, height } = useMemo(() => {
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
    const width = rounds.length > 0 ? rounds.length * (MATCH_W + COL_GAP) - COL_GAP : 0;
    return { rounds, extras, centers, width, height };
  }, [fixtures]);

  const colX = (r: number) => r * (MATCH_W + COL_GAP);

  if (rounds.length === 0) {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-400 dark:bg-slate-800/60 dark:text-slate-500">
        Bracket view is available once a knockout draw is generated.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto pb-2">
      {/* round headings */}
      <div className="relative" style={{ width, height: HEADER_H }}>
        {rounds.map((ms, r) => (
          <div
            key={r}
            className="absolute text-center text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
            style={{ left: colX(r), width: MATCH_W }}
          >
            {roundTitle(ms[0].round ?? null, ms.length * 2)}
          </div>
        ))}
      </div>

      <div className="relative" style={{ width, height }}>
        {/* connector lines */}
        <svg className="pointer-championships-none absolute inset-0" width={width} height={height} aria-hidden>
          {rounds.slice(1).map((ms, idx) => {
            const r = idx + 1;
            const childRight = colX(r - 1) + MATCH_W;
            const parentLeft = colX(r);
            const midX = childRight + COL_GAP / 2;
            return ms.map((_, i) => {
              const y0 = centers[r - 1][2 * i];
              const y1 = centers[r - 1][2 * i + 1];
              const yp = centers[r][i];
              return (
                <g key={i} className="stroke-slate-300 dark:stroke-slate-700" strokeWidth={1.5} fill="none">
                  <line x1={childRight} y1={y0} x2={midX} y2={y0} />
                  <line x1={childRight} y1={y1} x2={midX} y2={y1} />
                  <line x1={midX} y1={y0} x2={midX} y2={y1} />
                  <line x1={midX} y1={yp} x2={parentLeft} y2={yp} />
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
              onSelect={onSelect}
            />
          )),
        )}
      </div>

      {/* matches outside the tree, e.g. 3rd-place playoff */}
      {extras.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-6 border-t border-slate-100 pt-4 dark:border-slate-800">
          {extras.map((f) => (
            <div key={f.id} style={{ width: MATCH_W }}>
              <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {f.round ?? 'Match'}
              </div>
              <div className="relative" style={{ height: MATCH_H }}>
                <MatchCard fixture={f} x={0} top={0} teamName={teamName} onSelect={onSelect} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
