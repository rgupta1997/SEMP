import { useMemo, useRef, useState } from 'react';
import {
  atAdvantage, effectiveLevel, foldRally, resolveServer, resultEnvelope, serveCall, serveSpecFor,
  type KernelState, type Pairing, type RallyEvent, type RallyLog, type ScoringFormat, type Side,
} from '@semp/shared';
import { Button, Card, cn, confirmDialog, Select, toast } from '../../components/ui';

// ============================================================================
// The racquet console.
//
// THE BUTTONS MEAN "THIS SIDE WON THE RALLY", not "this side scored". The
// distinction is invisible in badminton and decisive in squash English-9 or
// traditional pickleball, where the receiver winning a rally takes the serve and no
// point at all. Getting the label wrong here makes those formats unscoreable.
//
// The deck holds an append-only RallyLog and derives everything by folding it. Undo
// is a truncate. Nothing is a mutable counter, so undo restores the serve, the
// server number and the service court along with the two numbers.
// ============================================================================

export interface RacquetDeckProps {
  format: ScoringFormat;
  /** Where the format came from - shown so "who changed the rules?" has an answer. */
  provenance?: string;
  homeName: string;
  awayName: string;
  homeOrg?: string | null;
  awayOrg?: string | null;
  /** Named players per side, in nominated order. Drives the next-server name. */
  pairing?: Pairing;
  log: RallyLog;
  firstServer: Side;
  onChange: (log: RallyLog, state: KernelState) => void;
  onSignOff: (log: RallyLog, state: KernelState) => void;
  onFirstServerChange?: (side: Side) => void;
  disabled?: boolean;
  busy?: boolean;
}

export function RacquetDeck(p: RacquetDeckProps) {
  const { format, log, firstServer } = p;
  const fold = useMemo(() => foldRally(format, log, firstServer), [format, log, firstServer]);
  const state = fold.state;
  const lv = effectiveLevel(format, state, state.pointLevel);
  const serve = serveSpecFor(format, lv);
  const doubles = !!(p.pairing && (p.pairing.A.length > 1 || p.pairing.B.length > 1));
  const env = resultEnvelope(format, state);
  const [showTools, setShowTools] = useState(false);
  const [finishing, setFinishing] = useState(false);
  // Rescoring a finished match: the deck goes back to taking rallies. The score is
  // NOT cleared - the log is the history, and walking it back is what Undo is for.
  const [rescoring, setRescoring] = useState(false);
  // The switch-ends prompt is a one-shot: it fires on a single point and must not
  // re-appear on every re-render of that same state.
  const dismissed = useRef<number>(-1);

  const push = (ev: RallyEvent) => {
    if (p.disabled) return;
    const next = [...log, { ...ev, at: new Date().toISOString() }];
    p.onChange(next, foldRally(format, next, firstServer).state);
  };

  const undo = () => {
    if (!log.length) return;
    const next = log.slice(0, -1);
    p.onChange(next, foldRally(format, next, firstServer).state);
  };

  const label = (n: number) => {
    const labels = lv.pointLabels;
    if (!labels) return String(n);
    return labels[Math.min(n, labels.length - 1)] ?? String(n);
  };

  const resolved = p.pairing ? resolveServer(format, state, p.pairing) : null;
  const call = serve.movement === 'none' ? null : serveCall(format, state, doubles);
  const showSwitch = state.switchEnds && dismissed.current !== log.length;

  // Points needed to take the current unit, for the "game point" cue - the single
  // most-requested thing on a scoreboard and free from the kernel.
  const unitPoint = (side: Side): boolean => {
    if (state.ended) return false;
    const s = [...state.score[state.pointLevel]] as [number, number];
    s[side === 'A' ? 0 : 1] += 1;
    const cap = lv.cap;
    const i = side === 'A' ? 0 : 1;
    const j = i === 0 ? 1 : 0;
    if (cap != null && s[i] >= cap) return true;
    return s[i] >= lv.target && s[i] - s[j] >= lv.winBy;
  };

  return (
    <div className="grid gap-4">
      {/* ── Header: what rules are in force, and where they came from ─────── */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <div className="text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-200">{format.name}</span>
          {p.provenance && <span className="ml-2">· {p.provenance}</span>}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
          {format.officiatingMode === 'selfScored' && <Badge tone="amber">Self-scored</Badge>}
          {format.clock && <Badge tone="slate">{format.clock.minutes} min cap</Badge>}
          {lv.startingScore && <Badge tone="slate">Handicap {lv.startingScore.join('–')}</Badge>}
        </div>
      </div>

      {showSwitch && (
        <button
          type="button"
          onClick={() => { dismissed.current = log.length; setShowTools(false); }}
          className="rounded-lg bg-amber-100 px-3 py-2 text-left text-sm font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-300"
        >
          Change ends · {lv.label.toLowerCase()} {state.pointLevel > 0 ? '' : ''}decider — tap to dismiss
        </button>
      )}

      {/* ── The score ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <ScorePanel
          name={p.homeName} org={p.homeOrg} side="A"
          points={label(state.score[state.pointLevel][0])}
          serving={serve.movement !== 'none' && state.serve.side === 'A'}
          gamePoint={unitPoint('A')}
        />
        <div className="text-center">
          <div className="font-mono text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {lv.label}
          </div>
          {call && (
            <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">
              {call}
            </div>
          )}
        </div>
        <ScorePanel
          name={p.awayName} org={p.awayOrg} side="B"
          points={label(state.score[state.pointLevel][1])}
          serving={serve.movement !== 'none' && state.serve.side === 'B'}
          gamePoint={unitPoint('B')}
          align="right"
        />
      </div>

      {/* Units won + the finished-unit strip: "11–7 · 9–11 · 11–6". */}
      <UnitStrip format={format} state={state} env={env} />

      {resolved?.server && !state.ended && (
        <div className="text-center text-xs text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-200">{resolved.server}</span> to serve
          {resolved.courtHalf ? ` from the ${resolved.courtHalf} court` : ''}
          {serve.movement === 'handOut' && doubles ? ` · server ${state.serve.serverNo}` : ''}
        </div>
      )}

      {/* ── The two buttons that matter ───────────────────────────────────── */}
      {state.ended && !rescoring ? (
        <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-center text-sm dark:bg-slate-800/60">
          <div>
            <div className="font-semibold text-slate-800 dark:text-slate-100">
              {state.outcome === 'draw'
                ? 'Drawn'
                : `${state.winner === 'A' ? p.homeName : p.awayName} wins`}
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {env.unitScores.map((u) => `${u[0]}–${u[1]}`).join('  ·  ') || `${env.headline[0]}–${env.headline[1]}`}
              {state.reason && state.reason !== 'normal' ? ` · ${state.reason}` : ''}
            </div>
          </div>
          {/* RESCORE. A finished match had no way back: the rally buttons were
              hidden, so a wrongly-recorded result could only be fixed by an
              organiser unlocking and re-entering it. The append-only log makes this
              cheap - reopening only has to drop a terminal `end` event (a retirement
              or an award) so the kernel stops calling the match over; Undo then walks
              the points back one at a time, restoring the serve with them. */}
          <Button
            size="sm" variant="outline" className="justify-self-center"
            disabled={p.disabled || p.busy}
            onClick={async () => {
              const terminal = log.length > 0 && log[log.length - 1].t === 'end';
              const ok = await confirmDialog({
                title: 'Rescore this match?',
                confirmLabel: 'Rescore',
                message: terminal
                  ? 'The recorded ending is removed and scoring reopens. The points already scored are kept - use Undo to walk them back.'
                  : 'Scoring reopens on the finished match. The points already scored are kept - use Undo to walk them back.',
              });
              if (!ok) return;
              setRescoring(true);
              // A terminal event is what makes the kernel call it over, so it has to
              // go before another rally can be scored.
              if (terminal) {
                const next = log.slice(0, -1);
                p.onChange(next, foldRally(format, next, firstServer).state);
              }
            }}
          >
            Rescore
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <RallyButton
            label={p.homeName}
            hint={state.ended ? 'undo a point first' : serve.pointScoring === 'serverOnly' && state.serve.side !== 'A' ? 'wins the serve' : 'won the rally'}
            disabled={p.disabled || p.busy || state.ended}
            onClick={() => push({ t: 'point', side: 'A' })}
          />
          <RallyButton
            label={p.awayName}
            hint={state.ended ? 'undo a point first' : serve.pointScoring === 'serverOnly' && state.serve.side !== 'B' ? 'wins the serve' : 'won the rally'}
            disabled={p.disabled || p.busy || state.ended}
            onClick={() => push({ t: 'point', side: 'B' })}
          />
        </div>
      )}

      {rescoring && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-300">
          {state.ended
            ? 'Rescoring — the score still finishes the match, so press Undo to take points back before scoring on.'
            : 'Rescoring — the result is not saved as final until you confirm it again.'}
          {' '}
          <button type="button" className="font-semibold underline underline-offset-2"
            onClick={() => setRescoring(false)}>
            Stop rescoring
          </button>
        </div>
      )}

      {/* ── Corrections ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!log.length || p.disabled} onClick={undo}>
          Undo
        </Button>
        {format.letsEnabled && (!state.ended || rescoring) && (
          <Button size="sm" variant="subtle" disabled={p.disabled} onClick={() => push({ t: 'let' })}>
            Let
          </Button>
        )}
        <Button size="sm" variant="subtle" onClick={() => setShowTools((v) => !v)}>
          {showTools ? 'Hide corrections' : 'Corrections'}
        </Button>
        {/* SIGNING OFF ALWAYS REACHABLE - BUT NEVER SILENTLY AS A 0-0 DRAW.
            The original bug: eight points into a game to 11, Sign off published a
            `completed` fixture with a 0-0 headline and no winner, standings read it
            as a legitimate draw, and locking made it official. The first fix removed
            the button until the kernel said the match had ended, which fixed the
            data and stranded the official.
            Both, instead: the button is always here. Once the format is satisfied it
            confirms the real result in one tap. Before that it asks HOW the match
            ended and records that reason - so an outcome is always deliberate. */}
        {state.ended ? (
          <Button size="sm" className="ml-auto" disabled={p.disabled || p.busy}
            onClick={() => { setRescoring(false); p.onSignOff(log, state); }}>
            Confirm result
          </Button>
        ) : (
          <Button
            size="sm" variant="outline" className="ml-auto"
            disabled={p.disabled || p.busy}
            onClick={() => setFinishing((v) => !v)}
          >
            {finishing ? 'Keep scoring' : 'End match'}
          </Button>
        )}
      </div>

      {finishing && !state.ended && (
        <FinishPanel
          format={format} state={state}
          homeName={p.homeName} awayName={p.awayName}
          onEvent={(ev) => { setFinishing(false); push(ev); }}
          onCancel={() => setFinishing(false)}
        />
      )}

      {showTools && (
        <ToolPanel
          format={format} state={state} log={log}
          homeName={p.homeName} awayName={p.awayName}
          doubles={doubles}
          firstServer={firstServer}
          onFirstServerChange={p.onFirstServerChange}
          onEvent={push}
        />
      )}

      {/* ── Timeline ──────────────────────────────────────────────────────── */}
      <Timeline format={format} log={log} firstServer={firstServer} homeName={p.homeName} awayName={p.awayName} />
    </div>
  );
}

/* ------------------------------- pieces -------------------------------- */

function Badge({ tone, children }: { tone: 'amber' | 'slate'; children: React.ReactNode }) {
  return (
    <span className={cn(
      'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
      tone === 'amber'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    )}>{children}</span>
  );
}

function ScorePanel({ name, org, points, serving, gamePoint, align = 'left' }:
  { name: string; org?: string | null; side: Side; points: string; serving: boolean; gamePoint: boolean; align?: 'left' | 'right' }) {
  return (
    <div className={cn('min-w-0', align === 'right' && 'text-right')}>
      <div className="flex items-center gap-1.5" style={align === 'right' ? { justifyContent: 'flex-end' } : undefined}>
        {serving && align === 'left' && <ServeDot />}
        <span className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{name}</span>
        {serving && align === 'right' && <ServeDot />}
      </div>
      {org && <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">{org}</div>}
      <div className={cn(
        'mt-1 font-mono text-4xl font-bold tabular-nums',
        gamePoint ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-50',
      )}>
        {points}
      </div>
      {gamePoint && (
        <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
          Game point
        </div>
      )}
    </div>
  );
}

const ServeDot = () => (
  <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-label="serving" />
);

/**
 * The tap that scores the match. Deliberately large - this is used courtside, on a
 * phone, one-handed - and deliberately labelled "won the rally", because under
 * serverOnly scoring a receiver's rally win is a side-out and scores nothing.
 */
function RallyButton({ label, hint, disabled, onClick }:
  { label: string; hint: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl border-2 px-3 py-4 transition',
        'border-slate-300 bg-white text-slate-800 active:scale-[.98]',
        'hover:border-emerald-500 hover:bg-emerald-50',
        'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-emerald-500 dark:hover:bg-emerald-500/10',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      <span className="line-clamp-2 text-center text-sm font-semibold">{label}</span>
      <span className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{hint}</span>
    </button>
  );
}

function UnitStrip({ format, state, env }:
  { format: ScoringFormat; state: KernelState; env: ReturnType<typeof resultEnvelope> }) {
  const top = format.levels.length - 1;
  const showUnits = top > 0 && format.levels[top].target > 1;
  const setLevel = format.levels.findIndex((l) => l.key === 'set');
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
      {showUnits && (
        <span className="font-mono tabular-nums">
          {format.levels[top - 1]?.label ?? 'Units'}: {state.score[top][0]}–{state.score[top][1]}
        </span>
      )}
      {setLevel > 0 && setLevel < top && (
        <span className="font-mono tabular-nums">
          Games: {state.score[setLevel][0]}–{state.score[setLevel][1]}
        </span>
      )}
      {env.unitScores.length > 0 && (
        <span className="font-mono tabular-nums">
          {env.unitScores.map((u) => `${u[0]}–${u[1]}`).join('  ·  ')}
        </span>
      )}
    </div>
  );
}

function ToolPanel({ format, state, log, homeName, awayName, doubles, firstServer, onFirstServerChange, onEvent }: {
  format: ScoringFormat; state: KernelState; log: RallyLog;
  homeName: string; awayName: string; doubles: boolean;
  firstServer: Side; onFirstServerChange?: (s: Side) => void;
  onEvent: (e: RallyEvent) => void;
}) {
  const lv = effectiveLevel(format, state, state.pointLevel);
  const serve = serveSpecFor(format, lv);
  const nameOf = (s: Side) => (s === 'A' ? homeName : awayName);

  const retire = async (side: Side) => {
    const ok = await confirmDialog({
      title: `${nameOf(side)} retires?`,
      message: `The match is awarded to ${nameOf(side === 'A' ? 'B' : 'A')}. The score so far is kept on the record.`,
      confirmLabel: 'Record retirement',
    });
    if (ok) onEvent({ t: 'end', outcome: 'win', reason: 'retired', winner: side === 'A' ? 'B' : 'A' });
  };

  const walkover = async (side: Side) => {
    const ok = await confirmDialog({
      title: `Walkover to ${nameOf(side)}?`,
      message: 'No play is recorded. The scoreline is completed from the format’s walkover policy.',
      confirmLabel: 'Record walkover',
    });
    if (ok) onEvent({ t: 'end', outcome: 'win', reason: 'walkover', winner: side });
  };

  const awardUnit = async (side: Side) => {
    const ok = await confirmDialog({
      title: `Award this ${lv.label.toLowerCase()} to ${nameOf(side)}?`,
      message: 'The tally is overridden. This is recorded as awarded, not played.',
      confirmLabel: 'Award',
    });
    if (ok) onEvent({ t: 'awardUnit', side, reason: 'awarded by official' });
  };

  return (
    <Card className="grid gap-3 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Corrections — the court outranks the engine
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onEvent({ t: 'adjust', side: 'A', delta: -1, reason: 'minus one' })}>
          −1 {homeName}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onEvent({ t: 'adjust', side: 'B', delta: -1, reason: 'minus one' })}>
          −1 {awayName}
        </Button>
      </div>

      {serve.movement !== 'none' && !state.ended && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">Serve is wrong:</span>
          <Button size="sm" variant="subtle"
            onClick={() => onEvent({ t: 'setServe', side: state.serve.side === 'A' ? 'B' : 'A', reason: 'serve corrected' })}>
            Hand serve to {nameOf(state.serve.side === 'A' ? 'B' : 'A')}
          </Button>
          {serve.movement === 'handOut' && doubles && (
            <Button size="sm" variant="subtle"
              onClick={() => onEvent({ t: 'setServe', side: state.serve.side, serverNo: state.serve.serverNo === 1 ? 2 : 1, reason: 'server number corrected' })}>
              Server {state.serve.serverNo === 1 ? 2 : 1}
            </Button>
          )}
        </div>
      )}

      {format.penaltyEvents !== 'off' && !state.ended && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">Conduct point to:</span>
          <Button size="sm" variant="subtle" onClick={() => onEvent({ t: 'penalty', side: 'A', reason: 'conduct' })}>{homeName}</Button>
          <Button size="sm" variant="subtle" onClick={() => onEvent({ t: 'penalty', side: 'B', reason: 'conduct' })}>{awayName}</Button>
        </div>
      )}

      {!state.ended && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">Award {lv.label.toLowerCase()}:</span>
          <Button size="sm" variant="subtle" onClick={() => awardUnit('A')}>{homeName}</Button>
          <Button size="sm" variant="subtle" onClick={() => awardUnit('B')}>{awayName}</Button>
        </div>
      )}

      {format.clock && !state.ended && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Time is up ({format.clock.minutes} min):
          </span>
          <Button size="sm" variant="outline" onClick={() => onEvent({ t: 'capFired' })}>
            Buzzer
          </Button>
        </div>
      )}

      {log.length === 0 && onFirstServerChange && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">First serve:</span>
          <Select
            className="w-auto text-sm"
            value={firstServer}
            onChange={(e) => onFirstServerChange(e.target.value as Side)}
          >
            <option value="A">{homeName}</option>
            <option value="B">{awayName}</option>
          </Select>
        </div>
      )}

      {!state.ended && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <span className="text-xs text-slate-500 dark:text-slate-400">Match cannot finish:</span>
          <Button size="sm" variant="outline" onClick={() => retire('A')}>{homeName} retires</Button>
          <Button size="sm" variant="outline" onClick={() => retire('B')}>{awayName} retires</Button>
          {log.length === 0 && (
            <>
              <Button size="sm" variant="outline" onClick={() => walkover('A')}>W/O to {homeName}</Button>
              <Button size="sm" variant="outline" onClick={() => walkover('B')}>W/O to {awayName}</Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/** The point log, newest first, with the serve and deuce context the kernel knows. */
function Timeline({ format, log, firstServer, homeName, awayName }:
  { format: ScoringFormat; log: RallyLog; firstServer: Side; homeName: string; awayName: string }) {
  const { trace } = useMemo(() => foldRally(format, log, firstServer), [format, log, firstServer]);
  if (!log.length) return null;
  const rows = trace.map((t, i) => ({ t, i })).reverse().slice(0, 40);
  const nameOf = (s: Side) => (s === 'A' ? homeName : awayName);
  return (
    <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <ul className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
        {rows.map(({ t, i }) => (
          <li key={i} className="flex items-baseline gap-2 px-3 py-1.5">
            <span className="w-8 shrink-0 font-mono tabular-nums text-slate-400 dark:text-slate-500">{i + 1}</span>
            <span className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">{describe(t, nameOf)}</span>
            {t.atDeuce && <span className="shrink-0 text-[10px] uppercase text-amber-600 dark:text-amber-400">deuce</span>}
            {t.unitsWon.map((u) => (
              <span key={u.level} className="shrink-0 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
                {u.label} {u.score[0]}–{u.score[1]}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function describe(t: ReturnType<typeof foldRally>['trace'][number], nameOf: (s: Side) => string): string {
  const ev = t.event;
  switch (ev.t) {
    case 'point':
      // Under serverOnly scoring a receiver win is a side-out, not a point - and the
      // timeline has to say so or the log reads as a scoring error.
      return t.scored
        ? `Point to ${nameOf(t.scored)}`
        : `${nameOf(ev.side)} won the rally — side-out, no point`;
    case 'let': return 'Let — rally replayed';
    case 'fault': return `Fault · ${nameOf(ev.side)}`;
    case 'penalty': return `Conduct point to ${nameOf(ev.side)}`;
    case 'awardServe': return `Serve awarded to ${nameOf(ev.side)}`;
    case 'awardUnit': return `Unit awarded to ${nameOf(ev.side)}${ev.reason ? ` · ${ev.reason}` : ''}`;
    case 'adjust': return `${ev.delta > 0 ? '+' : ''}${ev.delta} ${nameOf(ev.side)}${ev.reason ? ` · ${ev.reason}` : ''}`;
    case 'setServe': return `Serve corrected to ${nameOf(ev.side)}${ev.serverNo ? ` (server ${ev.serverNo})` : ''}`;
    case 'capFired': return 'Time up';
    case 'end': return `${ev.reason}${ev.winner ? ` — ${nameOf(ev.winner)}` : ''}`;
    default: return '';
  }
}

/**
 * How did this match end, when the score alone does not say?
 *
 * Every option here names a WINNER and a REASON, which is the whole point: the
 * outcome is recorded because somebody chose it, not inferred from a scoreline that
 * was never reached. The current score is shown so the choice is made with the
 * actual state in view rather than from memory.
 */
function FinishPanel({ format, state, homeName, awayName, onEvent, onCancel }: {
  format: ScoringFormat; state: KernelState;
  homeName: string; awayName: string;
  onEvent: (e: RallyEvent) => void;
  onCancel: () => void;
}) {
  const lv = effectiveLevel(format, state, state.pointLevel);
  const env = resultEnvelope(format, state);
  const nameOf = (s: Side) => (s === 'A' ? homeName : awayName);
  const pts = state.score[state.pointLevel];
  const level = pts[0] === pts[1];
  const leader: Side | null = pts[0] === pts[1] ? null : pts[0] > pts[1] ? 'A' : 'B';

  const end = async (winner: Side | null, reason: 'retired' | 'walkover' | 'conceded' | 'cap' | 'abandoned', title: string, message: string) => {
    const ok = await confirmDialog({ title, message, confirmLabel: 'Record it' });
    if (!ok) return;
    onEvent(winner === null
      ? { t: 'end', outcome: 'draw', reason, winner: null }
      : { t: 'end', outcome: 'win', reason, winner });
  };

  return (
    <Card className="grid gap-3 p-3">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          End this match
        </div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Not finished yet — {lv.label.toLowerCase()} at{' '}
          <span className="font-mono tabular-nums">{pts[0]}–{pts[1]}</span>
          {env.unitScores.length > 0 && (
            <> · {env.unitScores.map((u) => `${u[0]}–${u[1]}`).join(', ')}</>
          )}
          . Pick how it ended and it is recorded with that reason.
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button size="sm" variant="outline"
          onClick={() => end('B', 'retired', `${homeName} retires?`,
            `The match goes to ${awayName}. The score so far is kept on the record.`)}>
          {homeName} retires
        </Button>
        <Button size="sm" variant="outline"
          onClick={() => end('A', 'retired', `${awayName} retires?`,
            `The match goes to ${homeName}. The score so far is kept on the record.`)}>
          {awayName} retires
        </Button>
        <Button size="sm" variant="outline"
          onClick={() => end('A', 'conceded', `Award the match to ${homeName}?`,
            'Recorded as awarded by the official, not as a played result.')}>
          Award to {homeName}
        </Button>
        <Button size="sm" variant="outline"
          onClick={() => end('B', 'conceded', `Award the match to ${awayName}?`,
            'Recorded as awarded by the official, not as a played result.')}>
          Award to {awayName}
        </Button>
      </div>

      {/* Stopped on time. The leader takes it; a level score is a draw only where the
          format allows one, otherwise the next point has to settle it. */}
      {format.clock && (
        <Button size="sm" variant="subtle"
          onClick={() => {
            if (level && !format.endStates.drawsAllowed) {
              toast.error('Scores are level and this format does not allow a draw — play the next point.');
              return;
            }
            end(level ? null : leader, 'cap',
              level ? 'Record a draw?' : `Time up — ${nameOf(leader!)} leads?`,
              level ? 'The match is recorded as drawn.' : `${nameOf(leader!)} takes the match on the score at the buzzer.`);
          }}>
          Time up ({format.clock.minutes} min) — {level ? 'record a draw' : `${nameOf(leader ?? 'A')} leads`}
        </Button>
      )}

      <Button size="sm" variant="subtle"
        onClick={() => end(null, 'abandoned', 'Abandon this match?',
          'No winner is recorded. The organiser decides what happens to the fixture.')}>
        Abandoned — no result
      </Button>

      <button type="button" className="text-left text-xs text-slate-400 underline underline-offset-2 dark:text-slate-500"
        onClick={onCancel}>
        Cancel — go back to scoring
      </button>
    </Card>
  );
}

/** Read a persisted rally log out of live_state, tolerating anything malformed. */
export function hydrateRally(raw: unknown): RallyLog {
  const arr = (raw as { rally?: unknown } | null)?.rally;
  if (!Array.isArray(arr)) return [];
  return arr.filter((e): e is RallyEvent => !!e && typeof e === 'object' && typeof (e as RallyEvent).t === 'string');
}

export function hydrateFirstServer(raw: unknown): Side {
  const v = (raw as { firstServer?: unknown } | null)?.firstServer;
  return v === 'B' ? 'B' : 'A';
}

export { atAdvantage, toast };
