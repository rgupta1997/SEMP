import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { POOL_MAX_BALLS, poolRubber, readPoolState, type PoolFrame, type PoolRubberState, type Side } from '@semp/shared';
import { Button, Card, CardBody, CardHeader, cn, confirmDialog, toast } from '../../components/ui';

export function hydratePool(raw: unknown): PoolRubberState {
  return readPoolState(raw) ?? { frames: [] };
}

/**
 * A pool rubber, frame by frame: who won each frame and, optionally, how many balls the
 * loser still had on the table (the Inter-IIM "net ball difference" tie-break).
 */
export function PoolResult({ homeName, awayName, bestOf, initial, disabled, busy, onSave }: {
  homeName: string; awayName: string;
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
  const res = useMemo(() => poolRubber(state, bestOf), [state, bestOf]);
  const update = (next: PoolRubberState) => { edited.current = true; setState(next); onSave(next, false); };

  const [winner, setWinner] = useState<Side | null>(null);
  // Blank = not recorded; the frame still counts, it just adds nothing to the ball margin.
  const [balls, setBalls] = useState<number | null>(null);

  const record = () => {
    if (!winner) { toast.error('Pick who won the frame.'); return; }
    const frame: PoolFrame = { winner, ...(balls != null ? { ballsLeft: balls } : {}) };
    update({ frames: [...state.frames, frame] });
    setWinner(null); setBalls(null);
  };
  const undo = () => update({ frames: state.frames.slice(0, -1) });

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
            <SideName name={homeName} winner={res.winner === 'A'} />
            <div className="text-center">
              <div className="font-mono text-4xl font-black tabular-nums text-slate-900 dark:text-white">
                {res.framesWon[0]}<span className="px-2 text-slate-300 dark:text-slate-600">–</span>{res.framesWon[1]}
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">frames</div>
            </div>
            <SideName name={awayName} winner={res.winner === 'B'} align="right" />
          </div>
          {recorded && (
            <div className="mt-3 border-t border-slate-200 pt-3 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              Balls won by: {nameOf('A')} {res.ballsFor[0]} · {nameOf('B')} {res.ballsFor[1]}
            </div>
          )}
        </div>

        {!res.decided && (
          <div className="grid gap-4 rounded-xl border border-brand-300 bg-brand-50/40 p-4 dark:border-brand-500/40 dark:bg-brand-500/5">
            <div className="text-base font-bold text-slate-900 dark:text-slate-100">Frame {state.frames.length + 1}</div>
            <Row label="Won by">
              <div className="grid grid-cols-2 gap-2">
                {(['A', 'B'] as Side[]).map((s) => (
                  <button key={s} type="button" disabled={disabled} className={choiceCls(winner === s)} onClick={() => setWinner(s)}>
                    <span className="block truncate">{nameOf(s)}</span>
                  </button>
                ))}
              </div>
            </Row>
            <Row label={winner ? `Balls ${nameOf(winner === 'A' ? 'B' : 'A')} had left` : "Loser's balls left (optional)"}>
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
            <div className="flex justify-end border-t border-brand-200 pt-3 dark:border-brand-500/20">
              <Button disabled={disabled || busy || !winner} onClick={record}>Record frame</Button>
            </div>
          </div>
        )}

        {state.frames.length > 0 && (
          <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800">
            {state.frames.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-slate-500 dark:text-slate-400">Frame {i + 1}</span>
                <span className="min-w-0 truncate font-semibold text-slate-800 dark:text-slate-100">
                  {nameOf(f.winner)}
                  {f.ballsLeft != null && <span className="font-normal text-slate-500 dark:text-slate-400"> · by {f.ballsLeft} ball{f.ballsLeft === 1 ? '' : 's'}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <span className={cn('text-sm', busy ? 'text-amber-600 dark:text-amber-300' : res.decided ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400')}>
            {status}
          </span>
          <div className="ml-auto flex gap-2">
            {state.frames.length > 0 && <Button variant="outline" disabled={disabled || busy} onClick={undo}>Undo last frame</Button>}
            <Button disabled={disabled || busy || !res.decided} onClick={confirm}>Confirm rubber</Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center sm:gap-4">
      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</div>
      {children}
    </div>
  );
}

function SideName({ name, winner, align = 'left' }: { name: string; winner: boolean; align?: 'left' | 'right' }) {
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
