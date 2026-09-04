import { useMemo, useState } from 'react';
import {
  aggregateScore, effectiveLevel, foldRally, isAggregate, periodsPlayed, resultEnvelope,
  statSpecFor, type KernelState, type RallyEvent, type RallyLog, type ScoringFormat,
  type Side, type StatEventSpec,
} from '@semp/shared';
import { Button, Card, cn, confirmDialog, Select } from '../../components/ui';

// ============================================================================
// The console for everything that is not a racquet sport.
//
// Same kernel, same append-only log, same undo-is-a-truncate. What differs is what
// a tap MEANS and when a unit ends:
//
//   racquet    every tap is a rally; the score ends the game
//   invasion   a tap is a goal or a basket; the WHISTLE ends the period
//   board      a tap is a point on a board; the score ends the board
//
// And the thing a rally log can never supply: WHICH PERSON. A score cannot be folded
// into "who scored", so the attributable actions are declared per sport in the stat
// registry and offered here as buttons with a player attached.
// ============================================================================

export interface TeamDeckProps {
  format: ScoringFormat;
  provenance?: string;
  sportName?: string | null;
  homeName: string;
  awayName: string;
  homeOrg?: string | null;
  awayOrg?: string | null;
  /** Roster for each side, so an action can be attributed to a person. */
  roster?: { A: Array<{ id: string; name: string }>; B: Array<{ id: string; name: string }> };
  log: RallyLog;
  onChange: (log: RallyLog, state: KernelState) => void;
  onSignOff: (log: RallyLog, state: KernelState) => void;
  disabled?: boolean;
  busy?: boolean;
}

export function TeamDeck(p: TeamDeckProps) {
  const { format, log } = p;
  const state = useMemo(() => foldRally(format, log, 'A').state, [format, log]);
  const lv = effectiveLevel(format, state, state.pointLevel);
  const env = resultEnvelope(format, state);
  const aggregate = isAggregate(format);
  const clockPeriods = lv.terminator === 'clock';
  const spec = statSpecFor(p.sportName);
  const [showTools, setShowTools] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const push = (ev: RallyEvent) => {
    if (p.disabled) return;
    const next = [...log, { ...ev, at: new Date().toISOString() }];
    p.onChange(next, foldRally(format, next, 'A').state);
  };
  const undo = () => {
    if (!log.length) return;
    const next = log.slice(0, -1);
    p.onChange(next, foldRally(format, next, 'A').state);
  };

  const nameOf = (s: Side) => (s === 'A' ? p.homeName : p.awayName);
  const shown = aggregate ? aggregateScore(state) : state.score[state.pointLevel];
  const played = periodsPlayed(state);
  const totalPeriods = format.levels[format.levels.length - 1].target;

  // Point values this sport offers. Basketball scores 1, 2 or 3 from one tap;
  // everything else scores one at a time.
  const buttons = useMemo(() => {
    const vals = new Set<number>();
    for (const e of spec?.events ?? []) if (e.points && e.points > 0) vals.add(e.points);
    return vals.size > 1 ? [...vals].sort((a, b) => a - b) : [1];
  }, [spec]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <div className="text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-200">{format.name}</span>
          {p.provenance && <span className="ml-2">· {p.provenance}</span>}
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          {format.officiatingMode === 'selfScored' && <Chip tone="amber">Self-scored</Chip>}
          {format.clock && <Chip tone="slate">{format.clock.minutes} min</Chip>}
          {aggregate && <Chip tone="slate">{lv.label} {Math.min(played + 1, totalPeriods)} of {totalPeriods}</Chip>}
        </div>
      </div>

      {/* ── The score ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <SidePanel name={p.homeName} org={p.homeOrg} score={shown[0]} />
        <div className="text-center font-mono text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {aggregate ? 'Total' : lv.label}
          {aggregate && (
            <div className="mt-0.5 font-sans text-[10px] normal-case tracking-normal">
              this {lv.label.toLowerCase()} {state.score[state.pointLevel][0]}–{state.score[state.pointLevel][1]}
            </div>
          )}
        </div>
        <SidePanel name={p.awayName} org={p.awayOrg} score={shown[1]} align="right" />
      </div>

      {env.unitScores.length > 0 && (
        <div className="text-center font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {env.unitScores.map((u, i) => `${lv.label[0]}${i + 1} ${u[0]}–${u[1]}`).join('  ·  ')}
        </div>
      )}

      {/* ── Scoring ───────────────────────────────────────────────────────── */}
      {state.ended ? (
        <div className="rounded-lg bg-slate-50 p-3 text-center text-sm dark:bg-slate-800/60">
          <div className="font-semibold text-slate-800 dark:text-slate-100">
            {state.outcome === 'draw' ? 'Drawn' : `${nameOf(state.winner ?? 'A')} wins`}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {env.headline[0]}–{env.headline[1]}
            {state.reason && state.reason !== 'normal' ? ` · ${state.reason}` : ''}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {(['A', 'B'] as Side[]).map((side) => (
            <div key={side} className="grid gap-2">
              <div className="truncate text-center text-xs font-semibold text-slate-600 dark:text-slate-300">
                {nameOf(side)}
              </div>
              {buttons.map((v) => (
                <Button
                  key={v}
                  className="w-full justify-center text-base"
                  disabled={p.disabled || p.busy}
                  onClick={() => push({ t: 'point', side })}
                >
                  +{v}
                </Button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── The whistle ───────────────────────────────────────────────────── */}
      {clockPeriods && !state.ended && (
        <Button
          variant="outline"
          disabled={p.disabled || p.busy}
          onClick={async () => {
            const last = played + 1 >= totalPeriods;
            const ok = await confirmDialog({
              title: `End ${lv.label.toLowerCase()} ${played + 1}?`,
              confirmLabel: `End ${lv.label.toLowerCase()}`,
              message: last
                ? `This is the last ${lv.label.toLowerCase()}. The match is decided on the total, currently ${shown[0]}–${shown[1]}.`
                : `The score so far is banked and the next ${lv.label.toLowerCase()} starts level.`,
            });
            if (ok) push({ t: 'endPeriod' });
          }}
        >
          End {lv.label.toLowerCase()} {played + 1}
          {format.clock ? ` · ${format.clock.minutes} min` : ''}
        </Button>
      )}

      {/* ── Attributed actions ────────────────────────────────────────────── */}
      {!state.ended && spec && spec.events.length > 0 && p.roster && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(['A', 'B'] as Side[]).map((side) => (
            <EventPanel
              key={side}
              side={side}
              label={nameOf(side)}
              players={p.roster![side]}
              events={spec.events}
              disabled={p.disabled || p.busy}
              onFire={(ev, playerId, playerName, secondId, secondName, value) => {
                // ONE event, carrying both the magnitude and the attribution. A
                // three-pointer is a single action worth three, not three taps, and
                // the person rides along so the fact table can name them.
                //
                // A non-scoring action (a card, an empty raid) is the same event with
                // pts 0: it changes no score and is still a fact worth keeping.
                push({
                  t: 'point',
                  side,
                  pts: ev.points && ev.points > 0 ? ev.points : 0,
                  kind: ev.key,
                  label: ev.label,
                  ...(playerId ? { playerId } : {}),
                  ...(playerName ? { playerName } : {}),
                  ...(secondId ? { secondId } : {}),
                  ...(secondName ? { secondName } : {}),
                  ...(value !== undefined ? { value } : {}),
                });
              }}
            />
          ))}
        </div>
      )}

      {/* ── Corrections ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!log.length || p.disabled} onClick={undo}>
          Undo
        </Button>
        <Button size="sm" variant="subtle" onClick={() => setShowTools((v) => !v)}>
          {showTools ? 'Hide corrections' : 'Corrections'}
        </Button>
        {state.ended ? (
          <Button size="sm" className="ml-auto" disabled={p.disabled || p.busy}
            onClick={() => p.onSignOff(log, state)}>
            Confirm result
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="ml-auto"
            disabled={p.disabled || p.busy} onClick={() => setFinishing((v) => !v)}>
            {finishing ? 'Keep scoring' : 'End match'}
          </Button>
        )}
      </div>

      {showTools && (
        <Card className="grid gap-3 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Corrections — the pitch outranks the engine
          </div>
          <div className="flex flex-wrap gap-2">
            {(['A', 'B'] as Side[]).map((side) => (
              <Button key={side} size="sm" variant="outline"
                onClick={() => push({ t: 'adjust', side, delta: -1, reason: 'minus one' })}>
                −1 {nameOf(side)}
              </Button>
            ))}
          </div>
          {format.penaltyEvents !== 'off' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">Penalty point to:</span>
              {(['A', 'B'] as Side[]).map((side) => (
                <Button key={side} size="sm" variant="subtle"
                  onClick={() => push({ t: 'penalty', side, reason: 'conduct' })}>
                  {nameOf(side)}
                </Button>
              ))}
            </div>
          )}
        </Card>
      )}

      {finishing && !state.ended && (
        <Card className="grid gap-3 p-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              End this match
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Not finished — {played} of {totalPeriods} {lv.label.toLowerCase()}s played, currently{' '}
              <span className="font-mono tabular-nums">{shown[0]}–{shown[1]}</span>. Pick how it
              ended and it is recorded with that reason.
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['A', 'B'] as Side[]).map((side) => (
              <Button key={side} size="sm" variant="outline"
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: `Award the match to ${nameOf(side)}?`,
                    confirmLabel: 'Record it',
                    message: 'Recorded as awarded by the official, not as a played result.',
                  });
                  if (ok) { setFinishing(false); push({ t: 'end', outcome: 'win', reason: 'conceded', winner: side }); }
                }}>
                Award to {nameOf(side)}
              </Button>
            ))}
          </div>
          {format.endStates.drawsAllowed && shown[0] === shown[1] && (
            <Button size="sm" variant="subtle"
              onClick={async () => {
                const ok = await confirmDialog({ title: 'Record a draw?', confirmLabel: 'Record it', message: 'The match is recorded as drawn.' });
                if (ok) { setFinishing(false); push({ t: 'end', outcome: 'draw', reason: 'normal', winner: null }); }
              }}>
              Record a draw
            </Button>
          )}
          <Button size="sm" variant="subtle"
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Abandon this match?', confirmLabel: 'Record it',
                message: 'No winner is recorded. The organiser decides what happens to the fixture.',
              });
              if (ok) { setFinishing(false); push({ t: 'end', outcome: 'void', reason: 'abandoned', winner: null }); }
            }}>
            Abandoned — no result
          </Button>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------- pieces -------------------------------- */

function Chip({ tone, children }: { tone: 'amber' | 'slate'; children: React.ReactNode }) {
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
      tone === 'amber'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>{children}</span>
  );
}

function SidePanel({ name, org, score, align = 'left' }:
  { name: string; org?: string | null; score: number; align?: 'left' | 'right' }) {
  return (
    <div className={cn('min-w-0', align === 'right' && 'text-right')}>
      <div className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{name}</div>
      {org && <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">{org}</div>}
      <div className="mt-1 font-mono text-4xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
        {score}
      </div>
    </div>
  );
}

/**
 * The attributed actions for one side.
 *
 * The player picker sits ABOVE the buttons, not inside each one: an official taps
 * the same person several times in a row, and re-picking them per tap is the
 * friction that stops anybody attributing anything.
 */
function EventPanel({ side, label, players, events, disabled, onFire }: {
  side: Side;
  label: string;
  players: Array<{ id: string; name: string }>;
  events: StatEventSpec[];
  disabled?: boolean;
  onFire: (
    ev: StatEventSpec, playerId?: string, playerName?: string,
    secondId?: string, secondName?: string, value?: number,
  ) => void;
}) {
  const [pid, setPid] = useState(players[0]?.id ?? '');
  const [second, setSecond] = useState('');
  if (!players.length) return null;
  const nameFor = (id: string) => players.find((x) => x.id === id)?.name;

  return (
    <Card className="grid gap-2 p-3">
      <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label} · actions
      </div>
      <Select value={pid} onChange={(e) => setPid(e.target.value)} className="text-sm">
        {players.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </Select>
      {/* The second person, on the SAME row as the primary. An assist captured as a
          separate tap is an assist that never gets captured. */}
      {events.some((e) => e.secondPlayer) && (
        <Select value={second} onChange={(e) => setSecond(e.target.value)} className="text-xs">
          <option value="">No assist / second player</option>
          {players.filter((x) => x.id !== pid).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
      )}
      <div className="grid grid-cols-2 gap-2">
        {events.map((ev) => (
          <Button
            key={ev.key}
            size="sm"
            variant="outline"
            className="justify-center"
            disabled={disabled || !pid}
            onClick={() => onFire(
              ev, pid, nameFor(pid),
              ev.secondPlayer && second ? second : undefined,
              ev.secondPlayer && second ? nameFor(second) : undefined,
              ev.value ? 1 : undefined,
            )}
          >
            {ev.label}
          </Button>
        ))}
      </div>
      <span className="sr-only">{side}</span>
    </Card>
  );
}
