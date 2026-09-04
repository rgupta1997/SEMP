import { useMemo, useState } from 'react';
import {
  DISMISSALS, chaseLine, cricketHeadline, economy, extrasLine, foldCricket, inningsLine,
  oversLeft, oversOf, runRate, strikeRate,
  type CricketEvent, type CricketFormat, type CricketLog, type CricketState, type Dismissal,
} from '@semp/shared';
import { Button, Card, cn, confirmDialog, Select } from '../../components/ui';

// ============================================================================
// The cricket console.
//
// ONE TAP IS ONE DELIVERY. Everything else - the over count, the strike, who bowls
// next, whether the innings is over - is DERIVED by folding the ball log. Nothing
// here is a counter that can drift out of step with the scorecard.
//
// Why that matters more in cricket than anywhere else: a wide does not advance the
// over, an odd run swaps the strike, the end of an over swaps it again, and a single
// off the last ball does both and so changes nothing. A console tracking those as
// mutable state gets one of them wrong within an over, and the error is invisible
// until somebody reads the scorecard hours later. Folding makes them the same
// computation the engine's tests already pin down.
//
// WHO IS ON STRIKE IS RECORDED, NOT INFERRED. Every delivery carries the striker,
// non-striker and bowler, because the alternative - inferring from the previous ball
// - means one mis-tap silently reassigns every run that follows to the wrong person.
// ============================================================================

export interface CricketPerson { id: string; name: string }

export interface CricketDeckProps {
  format: CricketFormat;
  /** Where the format came from - so "who changed the rules?" has an answer. */
  provenance?: string;
  homeName: string;
  awayName: string;
  homeOrg?: string | null;
  awayOrg?: string | null;
  /** Squads, so a batter, bowler and fielder can be named rather than typed. */
  homeSquad?: CricketPerson[];
  awaySquad?: CricketPerson[];
  log: CricketLog;
  onChange: (log: CricketLog, state: CricketState) => void;
  onSignOff: (log: CricketLog, state: CricketState) => void;
  disabled?: boolean;
  busy?: boolean;
}

const RUNS = [0, 1, 2, 3, 4, 6];

const DISMISSAL_LABEL: Record<Dismissal, string> = {
  bowled: 'Bowled', caught: 'Caught', lbw: 'LBW', run_out: 'Run out',
  stumped: 'Stumped', hit_wicket: 'Hit wicket', caught_and_bowled: 'Caught & bowled',
  obstructing: 'Obstructing the field', timed_out: 'Timed out', retired: 'Retired',
};

/** Dismissals where somebody other than the bowler must be named. */
const NEEDS_FIELDER: Dismissal[] = ['caught', 'run_out', 'stumped', 'caught_and_bowled'];

export function CricketDeck(p: CricketDeckProps) {
  const { format, log } = p;
  const fold = useMemo(() => foldCricket(format, log), [format, log]);
  const state = fold.state;
  const inn = state.innings[state.current];

  const [wicketOpen, setWicketOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // The batting side's squad is the one that supplies batters; the other supplies
  // the bowler and the fielders. It swaps with the innings, so it is read from the
  // fold rather than fixed at mount.
  const batting = (inn?.battingSide === 'A' ? p.homeSquad : p.awaySquad) ?? [];
  const bowlingSide = (inn?.battingSide === 'A' ? p.awaySquad : p.homeSquad) ?? [];
  const battingName = inn?.battingSide === 'A' ? p.homeName : p.awayName;

  const nameOf = (id?: string | null) => {
    if (!id) return null;
    return [...(p.homeSquad ?? []), ...(p.awaySquad ?? [])].find((x) => x.id === id)?.name ?? null;
  };

  const out = new Set(inn?.batting.filter((b) => b.out).map((b) => b.playerId) ?? []);
  const atCrease = [inn?.strikerId, inn?.nonStrikerId].filter(Boolean) as string[];
  const availableBatters = batting.filter((x) => !out.has(x.id) && !atCrease.includes(x.id));

  // A bowler who has bowled their allocation must not be offered. The format owns
  // the limit; a Test has none.
  const availableBowlers = bowlingSide.filter((x) => {
    const line = inn?.bowling.find((b) => b.playerId === x.id);
    if (!line) return true;
    const left = oversLeft(format, line);
    return left === null || left > 0;
  });

  const push = (ev: CricketEvent) => {
    if (p.disabled) return;
    const next = [...log, { ...ev, at: new Date().toISOString() } as CricketEvent];
    p.onChange(next, foldCricket(format, next).state);
  };

  const undo = () => {
    if (!log.length) return;
    const next = log.slice(0, -1);
    p.onChange(next, foldCricket(format, next).state);
  };

  // Every delivery carries the three people involved, so a later correction to the
  // team sheet cannot silently reattribute runs already scored. Typed to the
  // delivery alone: the other events have no strike to record, and widening it to
  // the union would let a `retire` be stamped with a bowler.
  type Delivery = Extract<CricketEvent, { t: 'ball' }>;
  const withPeople = (ev: Delivery): Delivery => ({
    ...ev,
    strikerId: inn?.strikerId,
    nonStrikerId: inn?.nonStrikerId,
    bowlerId: inn?.bowlerId,
  });

  if (!inn) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted">This match has no innings to score.</p>
      </Card>
    );
  }

  const headline = cricketHeadline(state);
  const needsBowler = !inn.bowlerId && !inn.ended;
  const needsBatters = (!inn.strikerId || !inn.nonStrikerId) && !inn.ended;
  const blocked = needsBowler || needsBatters || inn.ended;

  return (
    <div className="space-y-3">
      {/* ---------------- the scoreboard ---------------- */}
      <Card className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">{battingName} batting</div>
            <div className="text-3xl font-semibold tabular-nums">
              {inningsLine(inn, format.ballsPerOver)}
            </div>
          </div>
          <div className="text-right text-sm text-muted">
            <div>RR {runRate(inn, format.ballsPerOver).toFixed(2)}</div>
            {format.oversPerInnings !== null && (
              <div>
                of {format.oversPerInnings} ov
              </div>
            )}
          </div>
        </div>

        {chaseLine(state) && (
          <div className="mt-2 rounded bg-accent-soft px-2 py-1 text-sm font-medium">
            {chaseLine(state)}
          </div>
        )}

        <div className="mt-2 text-xs text-muted">
          Extras {extrasLine(inn)}
          {p.provenance ? <> · Rules: {format.name} ({p.provenance})</> : null}
        </div>

        {/* Match score, which for cricket is runs per side rather than units won. */}
        <div className="mt-2 flex gap-4 text-sm">
          <span>{p.homeName} {headline[0]}</span>
          <span>{p.awayName} {headline[1]}</span>
        </div>
      </Card>

      {/* ---------------- who is on the field ---------------- */}
      <Card className="p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <PersonField
            label="Striker" value={inn.strikerId} people={availableBatters}
            current={inn.strikerId ? { id: inn.strikerId, name: nameOf(inn.strikerId) ?? 'Striker' } : null}
            onPick={(id) => push({ t: 'setBatter', end: 'striker', batterId: id })}
            suffix={battingLine(inn, inn.strikerId)}
          />
          <PersonField
            label="Non-striker" value={inn.nonStrikerId} people={availableBatters}
            current={inn.nonStrikerId ? { id: inn.nonStrikerId, name: nameOf(inn.nonStrikerId) ?? 'Non-striker' } : null}
            onPick={(id) => push({ t: 'setBatter', end: 'nonStriker', batterId: id })}
            suffix={battingLine(inn, inn.nonStrikerId)}
          />
          <PersonField
            label="Bowler" value={inn.bowlerId} people={availableBowlers}
            current={inn.bowlerId ? { id: inn.bowlerId, name: nameOf(inn.bowlerId) ?? 'Bowler' } : null}
            onPick={(id) => push({ t: 'setBowler', bowlerId: id })}
            suffix={bowlingFigures(inn, inn.bowlerId, format.ballsPerOver)}
          />
        </div>

        {inn.freeHit && (
          <p className="rounded bg-warning-soft px-2 py-1 text-xs font-medium">
            Free hit — the batter cannot be bowled or caught off this delivery.
          </p>
        )}

        {/* The over in progress, as balls rather than a decimal. */}
        <div className="text-xs text-muted">
          This over: {inn.overBalls}/{format.ballsPerOver} balls, {inn.overRuns} run{inn.overRuns === 1 ? '' : 's'}
        </div>

        {needsBowler && (
          <p className="text-xs text-warning">
            Name the bowler before the next delivery. The same bowler cannot bowl
            consecutive overs, so this is asked at the end of every over.
          </p>
        )}
        {needsBatters && !needsBowler && (
          <p className="text-xs text-warning">Name both batters before the next delivery.</p>
        )}
      </Card>

      {/* ---------------- the deliveries ---------------- */}
      {!inn.ended && (
        <Card className="p-4 space-y-3">
          <div className="text-xs uppercase tracking-wide text-muted">Runs off the bat</div>
          <div className="grid grid-cols-6 gap-2">
            {RUNS.map((r) => (
              <Button key={r} variant={r === 4 || r === 6 ? 'primary' : 'outline'}
                disabled={blocked || p.busy}
                onClick={() => push(withPeople({ t: 'ball', runs: r }))}>
                {r}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" disabled={blocked || p.busy} onClick={() => setExtraOpen(true)}>
              Extra…
            </Button>
            <Button variant="danger" disabled={blocked || p.busy} onClick={() => setWicketOpen(true)}>
              Wicket
            </Button>
            <Button variant="subtle" disabled={!log.length || p.busy} onClick={undo}>
              Undo
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <Button size="sm" variant="subtle" disabled={p.busy}
              onClick={() => push({ t: 'swapEnds' })}>
              Swap the strike
            </Button>
            <Button size="sm" variant="subtle" disabled={p.busy}
              onClick={async () => {
                const runs = await promptRuns('Penalty runs to the batting side');
                if (runs != null) push({ t: 'penalty', side: inn.battingSide, runs, reason: 'awarded by the umpire' });
              }}>
              Penalty runs
            </Button>
            <Button size="sm" variant="subtle" disabled={p.busy}
              onClick={async () => {
                if (!await confirmDialog({
                  title: 'End this innings?',
                  message: 'Use this for a declaration, rain, or a conceded innings. The overs remaining are not bowled.',
                  confirmLabel: 'End the innings',
                })) return;
                push({ t: 'endInnings', reason: 'declared' });
              }}>
              End the innings
            </Button>
          </div>
        </Card>
      )}

      {/* ---------------- the scorecard so far ---------------- */}
      <Scorecard state={state} nameOf={nameOf} ballsPerOver={format.ballsPerOver} />

      {/* ---------------- signing off ---------------- */}
      <Card className="p-4">
        {state.ended ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {state.winner
                ? `${state.winner === 'A' ? p.homeName : p.awayName} ${state.margin ?? 'won'}`
                : state.margin ?? 'No result'}
            </p>
            <Button disabled={p.busy}
              onClick={() => p.onSignOff(log, state)}>
              {p.busy ? 'Saving…' : 'Sign off the result'}
            </Button>
          </div>
        ) : finishing ? (
          <FinishPanel
            drawsAllowed={format.drawsAllowed}
            homeName={p.homeName}
            awayName={p.awayName}
            onCancel={() => setFinishing(false)}
            onEnd={(ev) => {
              const next = [...log, ev];
              setFinishing(false);
              p.onSignOff(next, foldCricket(format, next).state);
            }}
          />
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted">
              The result is signed off automatically once the match ends — a chase
              completed, or the last innings closed. End it early only for rain, a
              concession, or an abandoned match.
            </p>
            <Button variant="subtle" disabled={p.busy} onClick={() => setFinishing(true)}>
              End the match early…
            </Button>
          </div>
        )}
      </Card>

      {wicketOpen && (
        <WicketPanel
          format={format}
          fielders={bowlingSide}
          nextBatters={availableBatters}
          strikerName={nameOf(inn.strikerId) ?? 'the striker'}
          nonStrikerName={nameOf(inn.nonStrikerId) ?? 'the non-striker'}
          onCancel={() => setWicketOpen(false)}
          onConfirm={(ev) => { setWicketOpen(false); push(withPeople(ev)); }}
        />
      )}

      {extraOpen && (
        <ExtraPanel
          format={format}
          onCancel={() => setExtraOpen(false)}
          onConfirm={(ev) => { setExtraOpen(false); push(withPeople(ev)); }}
        />
      )}
    </div>
  );
}

/* ----------------------------- pieces ----------------------------- */

function PersonField({ label, value, people, current, onPick, suffix }: {
  label: string; value?: string; people: CricketPerson[];
  current: CricketPerson | null; onPick: (id: string) => void; suffix?: string | null;
}) {
  // The person already at the crease stays in the list, or picking them would look
  // like a way to clear the field.
  const options = current && !people.some((x) => x.id === current.id) ? [current, ...people] : people;
  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-muted">{label}</label>
      <Select value={value ?? ''} onChange={(e) => e.target.value && onPick(e.target.value)}>
        <option value="">Choose…</option>
        {options.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </Select>
      {suffix ? <div className="mt-1 text-xs tabular-nums text-muted">{suffix}</div> : null}
    </div>
  );
}

function battingLine(inn: CricketState['innings'][number], id?: string): string | null {
  if (!id) return null;
  const line = inn.batting.find((b) => b.playerId === id);
  if (!line) return null;
  // A batter yet to face a ball has no strike rate worth printing; 0.0 reads as bad
  // rather than as absent.
  return `${line.runs} (${line.ballsFaced})`
    + (line.ballsFaced ? ` · SR ${strikeRate(line).toFixed(0)}` : '');
}

function bowlingFigures(inn: CricketState['innings'][number], id?: string, ballsPerOver = 6): string | null {
  if (!id) return null;
  const line = inn.bowling.find((b) => b.playerId === id);
  if (!line) return null;
  return `${oversOf(line.ballsBowled, ballsPerOver)}-${line.maidens}-${line.runsConceded}-${line.wickets}`
    + (line.ballsBowled ? ` · Econ ${economy(line, ballsPerOver).toFixed(2)}` : '');
}

function WicketPanel({ format, fielders, nextBatters, strikerName, nonStrikerName, onCancel, onConfirm }: {
  format: CricketFormat;
  fielders: CricketPerson[];
  nextBatters: CricketPerson[];
  strikerName: string;
  nonStrikerName: string;
  onCancel: () => void;
  onConfirm: (ev: Extract<CricketEvent, { t: 'ball' }>) => void;
}) {
  const [how, setHow] = useState<Dismissal>('bowled');
  const [end, setEnd] = useState<'striker' | 'nonStriker'>('striker');
  const [fielderId, setFielderId] = useState('');
  const [nextId, setNextId] = useState('');
  const [runs, setRuns] = useState(0);

  const needsFielder = NEEDS_FIELDER.includes(how);
  // Only a run-out can take the batter at the other end - the rest are all about
  // the person facing.
  const canPickEnd = how === 'run_out';

  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-sm font-semibold">How was the batter out?</h3>

      <div>
        <label className="block text-xs uppercase tracking-wide text-muted">Dismissal</label>
        <Select value={how} onChange={(e) => setHow(e.target.value as Dismissal)}>
          {DISMISSALS.filter((d) => d !== 'retired').map((d) => (
            <option key={d} value={d}>{DISMISSAL_LABEL[d]}</option>
          ))}
        </Select>
      </div>

      {canPickEnd && (
        <div>
          <label className="block text-xs uppercase tracking-wide text-muted">Which batter</label>
          <Select value={end} onChange={(e) => setEnd(e.target.value as 'striker' | 'nonStriker')}>
            <option value="striker">{strikerName} (striker)</option>
            <option value="nonStriker">{nonStrikerName} (non-striker)</option>
          </Select>
          <p className="mt-1 text-xs text-muted">
            A run-out can take either batter, and it is not credited to the bowler.
          </p>
        </div>
      )}

      {needsFielder && (
        <div>
          <label className="block text-xs uppercase tracking-wide text-muted">
            {how === 'stumped' ? 'Wicketkeeper' : 'Fielder'}
          </label>
          <Select value={fielderId} onChange={(e) => setFielderId(e.target.value)}>
            <option value="">Choose…</option>
            {fielders.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </div>
      )}

      {how === 'run_out' && (
        <div>
          <label className="block text-xs uppercase tracking-wide text-muted">Runs completed first</label>
          <Select value={String(runs)} onChange={(e) => setRuns(Number(e.target.value))}>
            {[0, 1, 2, 3].map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </div>
      )}

      <div>
        <label className="block text-xs uppercase tracking-wide text-muted">Next batter</label>
        <Select value={nextId} onChange={(e) => setNextId(e.target.value)}>
          <option value="">Choose…</option>
          {nextBatters.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
        {!nextBatters.length && (
          <p className="mt-1 text-xs text-muted">
            {format.lastManStands
              ? 'Nobody left to come in — the last batter carries on alone.'
              : 'Nobody left to come in — this ends the innings.'}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button variant="danger"
          disabled={needsFielder && !fielderId}
          onClick={() => onConfirm({
            t: 'ball', runs,
            wicket: { how, end, ...(fielderId ? { fielderId } : {}) },
            ...(nextId ? { nextBatterId: nextId } : {}),
          })}>
          Record the wicket
        </Button>
        <Button variant="subtle" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

function ExtraPanel({ format, onCancel, onConfirm }: {
  format: CricketFormat; onCancel: () => void; onConfirm: (ev: Extract<CricketEvent, { t: 'ball' }>) => void;
}) {
  const [kind, setKind] = useState<'wide' | 'noball' | 'bye' | 'legbye'>('wide');
  const [extraRuns, setExtraRuns] = useState(0);
  const [offBat, setOffBat] = useState(0);

  const illegal = kind === 'wide' || kind === 'noball';
  const penalty = kind === 'wide' ? format.wideRuns : kind === 'noball' ? format.noBallRuns : 0;

  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-sm font-semibold">Extra</h3>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([['wide', 'Wide'], ['noball', 'No-ball'], ['bye', 'Bye'], ['legbye', 'Leg-bye']] as const)
          .map(([k, label]) => (
            <Button key={k} variant={kind === k ? 'primary' : 'outline'} onClick={() => setKind(k)}>
              {label}
            </Button>
          ))}
      </div>

      <p className="text-xs text-muted">
        {illegal
          ? `Does not count as a ball of the over. Worth ${penalty} run${penalty === 1 ? '' : 's'} on its own.`
          : 'Counts as a legal ball, and is charged to the team rather than to the bowler.'}
      </p>

      {kind === 'noball' && (
        <div>
          <label className="block text-xs uppercase tracking-wide text-muted">Runs off the bat</label>
          <Select value={String(offBat)} onChange={(e) => setOffBat(Number(e.target.value))}>
            {RUNS.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </div>
      )}

      <div>
        <label className="block text-xs uppercase tracking-wide text-muted">
          {illegal ? 'Extra runs run or overthrown' : 'Runs'}
        </label>
        <Select value={String(extraRuns)} onChange={(e) => setExtraRuns(Number(e.target.value))}>
          {[0, 1, 2, 3, 4].map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => onConfirm({
          t: 'ball', runs: kind === 'noball' ? offBat : 0, extra: kind, extraRuns,
        })}>
          Record it
        </Button>
        <Button variant="subtle" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

/**
 * Ending a match that the rules have not ended.
 *
 * Deliberately demands a REASON rather than offering a bare "sign off": the racquet
 * deck once allowed a sign-off part-way through, which wrote a completed 0-0 with no
 * winner, and standings read it as a legitimate draw. A cricket match abandoned in
 * the twelfth over is a real thing that needs recording - but it must be recorded as
 * that, not as a result.
 */
function FinishPanel({ drawsAllowed, homeName, awayName, onCancel, onEnd }: {
  drawsAllowed: boolean; homeName: string; awayName: string;
  onCancel: () => void; onEnd: (ev: CricketEvent) => void;
}) {
  const [why, setWhy] = useState<'abandoned' | 'conceded_A' | 'conceded_B' | 'draw'>('abandoned');

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Why is the match ending?</h3>
      <Select value={why} onChange={(e) => setWhy(e.target.value as typeof why)}>
        <option value="abandoned">Abandoned — no result</option>
        <option value="conceded_A">{awayName} conceded — {homeName} win</option>
        <option value="conceded_B">{homeName} conceded — {awayName} win</option>
        {drawsAllowed && <option value="draw">Drawn — time ran out</option>}
      </Select>
      <div className="flex gap-2">
        <Button variant="danger" onClick={() => onEnd(
          // A null winner is a DRAW unless the reason says the match was washed out
          // or abandoned, in which case it is void. The engine draws that line, so
          // the reason is the only thing this panel has to get right.
          why === 'abandoned' ? { t: 'end', reason: 'abandoned', winner: null }
            : why === 'draw' ? { t: 'end', reason: 'override', winner: null }
              : { t: 'end', reason: 'conceded', winner: why === 'conceded_A' ? 'A' : 'B' })}>
          End the match
        </Button>
        <Button variant="subtle" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/** The scorecard, read straight off the fold. Nothing here is stored. */
function Scorecard({ state, nameOf, ballsPerOver }: {
  state: CricketState; nameOf: (id?: string | null) => string | null; ballsPerOver: number;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button variant="subtle" size="sm" onClick={() => setOpen(true)}>Show the scorecard</Button>
    );
  }
  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Scorecard</h3>
        <Button variant="subtle" size="sm" onClick={() => setOpen(false)}>Hide</Button>
      </div>
      {state.innings.map((inn) => (
        <div key={inn.innings} className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide">
            Innings {inn.innings} — {inningsLine(inn, ballsPerOver)}
            {inn.endedBy ? <span className="font-normal text-muted"> ({inn.endedBy.replace('_', ' ')})</span> : null}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[22rem] text-xs tabular-nums">
              <thead className="text-muted">
                <tr><th className="text-left font-normal">Batting</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th className="text-left font-normal">How out</th></tr>
              </thead>
              <tbody>
                {inn.batting.map((b) => (
                  <tr key={b.playerId} className="border-t border-line">
                    <td className="py-1 text-left">{nameOf(b.playerId) ?? b.playerId}</td>
                    <td className={cn('text-center', !b.out && 'font-semibold')}>{b.runs}{!b.out ? '*' : ''}</td>
                    <td className="text-center">{b.ballsFaced}</td>
                    <td className="text-center">{b.fours}</td>
                    <td className="text-center">{b.sixes}</td>
                    <td className="text-left text-muted">
                      {b.out ? DISMISSAL_LABEL[b.dismissal as Dismissal] ?? b.dismissal : 'not out'}
                      {b.fielderId ? ` (${nameOf(b.fielderId) ?? ''})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-xs text-muted">Extras {extrasLine(inn)}</div>

          {inn.bowling.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[18rem] text-xs tabular-nums">
                <thead className="text-muted">
                  <tr><th className="text-left font-normal">Bowling</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr>
                </thead>
                <tbody>
                  {inn.bowling.map((b) => (
                    <tr key={b.playerId} className="border-t border-line">
                      <td className="py-1 text-left">{nameOf(b.playerId) ?? b.playerId}</td>
                      <td className="text-center">{oversOf(b.ballsBowled, ballsPerOver)}</td>
                      <td className="text-center">{b.maidens}</td>
                      <td className="text-center">{b.runsConceded}</td>
                      <td className="text-center font-semibold">{b.wickets}</td>
                      <td className="text-center">{b.ballsBowled ? economy(b, ballsPerOver).toFixed(2) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

async function promptRuns(title: string): Promise<number | null> {
  const ok = await confirmDialog({
    title,
    message: 'Five penalty runs are awarded to the batting side. This is the usual amount.',
    confirmLabel: 'Award 5 runs',
  });
  if (!ok) return null;
  return 5;
}
