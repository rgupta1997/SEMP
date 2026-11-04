import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_POOL_BREAK_RULE, POOL_BREAK_RULES, POOL_FRAME_ENDS, POOL_MAX_BALLS, nextBreaker, poolRubber, readPoolState,
  type PoolBreakRule, type PoolFrame, type PoolFrameEnd, type PoolRubberState, type Side,
} from '@semp/shared';
import { Button, Card, CardBody, CardHeader, cn, confirmDialog, toast } from '../../components/ui';

export function hydratePool(raw: unknown): PoolRubberState {
  return readPoolState(raw) ?? { frames: [] };
}

/**
 * A pool rubber, frame by frame: who won each frame and, optionally, how many balls the
 * loser still had on the table (the Inter-IIM "net ball difference" tie-break).
 */
export function PoolResult({ homeName, awayName, homeShort, awayShort, bestOf, initial, disabled, busy, onSave }: {
  homeName: string; awayName: string;
  /** Short codes (IIMK) shown on a phone, where full names cut to the same "Mock IIM …". */
  homeShort?: string | null; awayShort?: string | null;
  bestOf: number;
  initial: PoolRubberState;
  disabled?: boolean;
  busy?: boolean;
  /** `done`: the official confirmed the rubber. */
  onSave: (state: PoolRubberState, done: boolean) => void;
}) {
  const [state, setState] = useState<PoolRubberState>(initial);
  const seeded = useRef(false);
  const edited = useRef(false);
  // Adopt the saved state once, never after a tap: each save echoes back through `initial`.
  useEffect(() => {
    if (seeded.current || edited.current) return;
    if (initial.frames.length) { setState(initial); seeded.current = true; }
  }, [initial]);

  const nameOf = (s: Side) => (s === 'A' ? homeName : awayName);
  // On screen: the short code on a phone, the full name from sm up. Dialogs keep nameOf.
  const who = (s: Side): ReactNode => {
    const short = (s === 'A' ? homeShort : awayShort)?.trim();
    if (!short || short === nameOf(s)) return nameOf(s);
    return <><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{nameOf(s)}</span></>;
  };
  const res = useMemo(() => poolRubber(state, bestOf), [state, bestOf]);
  const update = (next: PoolRubberState) => { edited.current = true; setState(next); onSave(next, false); };

  const [winner, setWinner] = useState<Side | null>(null);
  // Blank = not recorded; the frame still counts, it just adds nothing to the ball margin.
  const [balls, setBalls] = useState<number | null>(null);
  const [end, setEnd] = useState<PoolFrameEnd | null>(null);
  // undefined = follow the break rule; a tap overrides it for this frame only.
  const [breakPick, setBreakPick] = useState<Side | null | undefined>(undefined);
  const rule = state.breakRule ?? DEFAULT_POOL_BREAK_RULE;
  const breaker = breakPick === undefined ? nextBreaker(state) : breakPick;
  const loser = winner ? (winner === 'A' ? 'B' : 'A') : null;

  const reset = () => { setWinner(null); setBalls(null); setEnd(null); setBreakPick(undefined); };
  const pickEnd = (e: PoolFrameEnd | null) => {
    setEnd(e);
    if (e === 'break8' && breaker) setWinner(breaker);
  };
  const record = () => {
    if (!winner) { toast.error('Pick who won the frame.'); return; }
    if (end === 'break8' && breaker && winner !== breaker) { toast.error('8 on the break: the side that broke wins the frame.'); return; }
    const frame: PoolFrame = {
      winner,
      ...(balls != null ? { ballsLeft: balls } : {}),
      ...(breaker ? { breaker } : {}),
      ...(end ? { end } : {}),
    };
    update({ ...state, frames: [...state.frames, frame] });
    reset();
  };
  const undo = () => { update({ ...state, frames: state.frames.slice(0, -1) }); reset(); };
  // Kept on screen until the first frame saves it with the rubber.
  const setRule = (r: PoolBreakRule) => { edited.current = true; setState({ ...state, breakRule: r }); setBreakPick(undefined); };

  const confirm = async () => {
    if (!res.winner) { toast.error('The rubber is not decided yet.'); return; }
    const w = res.winner === 'A' ? 0 : 1;
    const ok = await confirmDialog({
      title: 'Confirm this rubber',
      confirmLabel: 'Record rubber',
      message: `${nameOf(res.winner)} win ${res.framesWon[w]}-${res.framesWon[1 - w]} in frames. The rubber goes to them in the tie.`,
    });
    if (ok) onSave(state, true);
  };

  const recorded = state.frames.some((f) => f.ballsLeft != null);
  const status = busy
    ? 'Saving… the buttons unlock when the server confirms'
    : res.decided
      ? `${nameOf(res.winner!)} win the rubber - ready to confirm`
      : state.frames.length === 0 ? 'Record each frame as it finishes' : 'Record the next frame when it finishes';

  return (
    <Card>
      <CardHeader title={`Pool · best of ${bestOf} frames`}
        subtitle={`First to ${res.toWin} frames. Each frame: who won it and, if you track it, the loser's balls left.`} />
      <CardBody className="space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            <SideName name={who('A')} winner={res.winner === 'A'} />
            <div className="text-center">
              <div className="font-mono text-4xl font-black tabular-nums text-slate-900 dark:text-white">
                {res.framesWon[0]}<span className="px-2 text-slate-300 dark:text-slate-600">–</span>{res.framesWon[1]}
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">frames</div>
            </div>
            <SideName name={who('B')} winner={res.winner === 'B'} align="right" />
          </div>
          {recorded && (
            <div className="mt-3 border-t border-slate-200 pt-3 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              Balls won by: {who('A')} {res.ballsFor[0]} · {who('B')} {res.ballsFor[1]}
            </div>
          )}
        </div>

        {!res.decided && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-xl border border-brand-300 bg-brand-50/40 p-3 sm:p-4 dark:border-brand-500/40 dark:bg-brand-500/5">
            <div className="text-base font-bold text-slate-900 dark:text-slate-100">Frame {state.frames.length + 1}</div>
            {state.frames.length === 0 && (
              <Row label="Break rule">
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(POOL_BREAK_RULES) as PoolBreakRule[]).map((r) => (
                    <button key={r} type="button" disabled={disabled} aria-pressed={rule === r} className={choiceCls(rule === r)} onClick={() => setRule(r)}>
                      {POOL_BREAK_RULES[r]}
                    </button>
                  ))}
                </div>
              </Row>
            )}
            <Row label={state.frames.length === 0 ? 'Breaks (lag winner)' : `Breaks · ${POOL_BREAK_RULES[rule].toLowerCase()}`}>
              <div className="grid grid-cols-2 gap-2">
                {(['A', 'B'] as Side[]).map((s) => (
                  <button key={s} type="button" disabled={disabled} aria-pressed={breaker === s} className={choiceCls(breaker === s)}
                    onClick={() => setBreakPick(breaker === s ? null : s)}>
                    <span className="block truncate">{who(s)}</span>
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Won by">
              <div className="grid grid-cols-2 gap-2">
                {(['A', 'B'] as Side[]).map((s) => (
                  <button key={s} type="button" disabled={disabled} className={choiceCls(winner === s)} onClick={() => setWinner(s)}>
                    <span className="block truncate">{who(s)}</span>
                  </button>
                ))}
              </div>
            </Row>
            <Row label={winner ? <>Balls {who(winner === 'A' ? 'B' : 'A')} had left</> : "Loser's balls left (optional)"}>
              <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
                <button type="button" disabled={disabled} aria-pressed={balls == null}
                  className={cn(choiceCls(balls == null), 'px-0 py-2 text-xs')} onClick={() => setBalls(null)}>Skip</button>
                {Array.from({ length: POOL_MAX_BALLS + 1 }, (_, n) => n).map((n) => (
                  <button key={n} type="button" disabled={disabled} aria-pressed={balls === n}
                    className={cn(choiceCls(balls === n), 'px-0 py-2 font-mono tabular-nums')} onClick={() => setBalls(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="How it ended (optional)">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                <button type="button" disabled={disabled} aria-pressed={end == null}
                  className={cn(choiceCls(end == null), 'px-2 text-xs')} onClick={() => pickEnd(null)}>Skip</button>
                {(Object.keys(POOL_FRAME_ENDS) as PoolFrameEnd[]).map((e) => {
                  const d = POOL_FRAME_ENDS[e];
                  return (
                    <button key={e} type="button" disabled={disabled} aria-pressed={end === e}
                      className={cn(choiceCls(end === e), 'px-2 text-xs')} onClick={() => pickEnd(e)}>
                      {d.loserFault ? <>{loser ? who(loser) : 'Loser'} {d.label}</> : d.label}
                    </button>
                  );
                })}
              </div>
            </Row>
            <div className="flex justify-end border-t border-brand-200 pt-3 dark:border-brand-500/20">
              <Button disabled={disabled || busy || !winner} onClick={record}>Record frame</Button>
            </div>
          </div>
        )}

        {state.frames.length > 0 && (
          <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800">
            {state.frames.map((f, i) => {
              const meta = [
                f.ballsLeft != null ? `by ${f.ballsLeft} ball${f.ballsLeft === 1 ? '' : 's'}` : null,
                f.end ? POOL_FRAME_ENDS[f.end].short : null,
              ].filter(Boolean).join(' · ');
              return (
                <li key={i} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="shrink-0">
                    <div className="text-slate-500 dark:text-slate-400">Frame {i + 1}</div>
                    {f.breaker && <div className="text-xs text-slate-400 dark:text-slate-500">{who(f.breaker)} broke</div>}
                  </div>
                  <div className="min-w-0 text-right">
                    <div className="truncate font-semibold text-slate-800 dark:text-slate-100">{who(f.winner)}</div>
                    {meta && <div className="text-xs text-slate-500 dark:text-slate-400">{meta}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <span className={cn('text-sm', busy ? 'text-amber-600 dark:text-amber-300' : res.decided ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400')}>
            {status}
          </span>
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            {state.frames.length > 0 && <Button variant="outline" disabled={disabled || busy} onClick={undo}>Undo last frame</Button>}
            <Button disabled={disabled || busy || !res.decided} onClick={confirm}>Confirm rubber</Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center sm:gap-4">
      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</div>
      {children}
    </div>
  );
}

function SideName({ name, winner, align = 'left' }: { name: ReactNode; winner: boolean; align?: 'left' | 'right' }) {
  return (
    <div className={cn('min-w-0', align === 'right' && 'text-right')}>
      <div className={cn('truncate text-sm font-bold sm:text-base', winner ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-900 dark:text-slate-100')}>{name}</div>
      {winner && <div className="mt-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">rubber winner</div>}
    </div>
  );
}

const choiceCls = (selected: boolean) => cn(
  'min-w-0 rounded-lg border-2 px-3 py-2 text-sm font-semibold transition disabled:opacity-50',
  selected
    ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-transparent dark:text-slate-200',
);
