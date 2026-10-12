import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CARROM_COINS, boardsOnly, carromBoardPoints, carromHeadline, carromMatch,
  type CarromBoard, type CarromRules, type QueenCover, type Side,
} from '@semp/shared';
import { Button, Card, CardBody, CardHeader, cn, confirmDialog, toast } from '../../components/ui';

/** What the carrom screen keeps in `live_state.carrom`. */
export interface CarromState {
  boards: CarromBoard[];
  /** Who broke the first board (the toss winner's choice). */
  firstBreak: Side;
}

const sideOf = (v: unknown): Side | undefined => (v === 'A' || v === 'B' ? v : undefined);

export function hydrateCarrom(raw: unknown): CarromState {
  const r = (raw ?? {}) as Partial<CarromState>;
  const boards = Array.isArray(r.boards)
    ? r.boards.filter((x): x is CarromBoard => !!x && !!sideOf(x.winner) && typeof x.coinsLeft === 'number')
    : [];
  return { boards, firstBreak: sideOf(r.firstBreak) ?? 'A' };
}

/**
 * Carrom records each BOARD's result - who won it, the loser's coins left and who
 * covered the queen - and the points follow (carrom.ts). Nobody taps points one by one.
 */
export function CarromResult({ homeName, awayName, rules, initial, disabled, busy, onSave }: {
  homeName: string; awayName: string;
  rules: CarromRules;
  initial: CarromState;
  disabled?: boolean;
  busy?: boolean;
  /** `done`: the official confirmed the result. */
  onSave: (state: CarromState, done: boolean) => void;
}) {
  const [state, setState] = useState<CarromState>(initial);
  const seeded = useRef(false);
  const edited = useRef(false);
  // Adopt the saved state once, never after a tap: each save echoes back through `initial`.
  useEffect(() => {
    if (seeded.current || edited.current) return;
    if (initial.boards.length || initial.firstBreak !== 'A') { setState(initial); seeded.current = true; }
  }, [initial]);

  const nameOf = (s: Side) => (s === 'A' ? homeName : awayName);
  const match = useMemo(() => carromMatch(state.boards, rules, state.firstBreak), [state, rules]);
  const onlyBoards = boardsOnly(rules);
  const update = (next: CarromState) => { edited.current = true; setState(next); onSave(next, false); };

  // The board being entered.
  const [winner, setWinner] = useState<Side | null>(null);
  const [coins, setCoins] = useState(0);
  const [queen, setQueen] = useState<QueenCover>('winner');
  const [extras, setExtras] = useState(false);
  const [slam, setSlam] = useState(false);
  const [fouls, setFouls] = useState({ A: 0, B: 0 });
  const resetEntry = () => { setWinner(null); setCoins(0); setQueen('winner'); setSlam(false); setFouls({ A: 0, B: 0 }); setExtras(false); };

  const game = match.decided ? null : match.games.find((g) => !g.winner) ?? null;
  const gameScore = game?.score ?? [0, 0];
  // The fixture's score: games won, or a one-game match's points (even once it is over).
  const headline = carromHeadline(match, rules);
  const preview = winner
    ? carromBoardPoints({ winner, coinsLeft: coins, queen }, gameScore[winner === 'A' ? 0 : 1], rules)
    : 0;

  const record = () => {
    if (!winner) { toast.error('Pick who won the board.'); return; }
    const board: CarromBoard = {
      winner,
      coinsLeft: onlyBoards ? 0 : coins,
      queen,
      ...(slam ? { slam: true } : {}),
      ...(fouls.A || fouls.B ? { fouls } : {}),
    };
    update({ ...state, boards: [...state.boards, board] });
    resetEntry();
  };

  const undo = () => update({ ...state, boards: state.boards.slice(0, -1) });

  const confirm = async () => {
    if (!match.decided || !match.winner) { toast.error('The match is not decided yet.'); return; }
    const ok = await confirmDialog({
      title: 'Confirm final result',
      confirmLabel: 'Sign off',
      message: `${nameOf(match.winner)} win ${headline[match.winner === 'A' ? 0 : 1]}-${headline[match.winner === 'A' ? 1 : 0]}`
        + (onlyBoards ? ' in boards' : rules.gamesToWin > 1 ? ' in games' : '') + '. This completes the match and updates standings.',
    });
    if (ok) onSave(state, true);
  };

  const status = busy
    ? 'Saving… the buttons unlock when the server confirms'
    : match.decided
      ? `${nameOf(match.winner!)} win the match - ready to confirm`
      : match.current.tieBreak
        ? `Level after ${rules.maxBoards} boards - the next board decides the game`
        : `Game ${match.current.game} · board ${match.current.board}${rules.maxBoards ? ` of ${rules.maxBoards}` : ''} · ${nameOf(match.nextBreaker)} breaks`;

  return (
    <Card>
      <CardHeader
        title={onlyBoards ? `Carrom · first to ${rules.gamesToWin} boards` : `Carrom · ${rules.gamesToWin > 1 ? `best of ${rules.gamesToWin * 2 - 1} games` : 'one game'} to ${rules.gameTarget}`}
        subtitle={onlyBoards
          ? 'Record who won each board.'
          : `Record each board: who won, the loser's coins left, and who covered the queen (${rules.queenPoints} pts${rules.queenCutoff ? ` until ${rules.queenCutoff}` : ''}).`} />
      <CardBody className="space-y-5">
        {/* Scoreboard: games won, and the game in progress. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/60">
          <Name name={homeName} breaking={!match.decided && match.nextBreaker === 'A'} winner={match.winner === 'A'} />
          <div className="text-center">
            <div className="font-mono text-4xl font-black tabular-nums text-slate-900 dark:text-white">
              {headline[0]}–{headline[1]}
            </div>
            {rules.gamesToWin > 1 && !onlyBoards && game && (
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Game {match.current.game}: {gameScore[0]}–{gameScore[1]}
              </div>
            )}
          </div>
          <Name name={awayName} breaking={!match.decided && match.nextBreaker === 'B'} winner={match.winner === 'B'} align="right" />
        </div>

        {/* The toss: who breaks the first board. Fixed once a board is recorded. */}
        {state.boards.length === 0 && (
          <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] sm:items-center sm:gap-4">
            <div className="text-sm text-slate-600 dark:text-slate-300">Breaks first (won the toss)</div>
            <div className="grid grid-cols-2 gap-2">
              {(['A', 'B'] as Side[]).map((s) => (
                <button key={s} type="button" disabled={disabled} className={choiceCls(state.firstBreak === s)}
                  onClick={() => { if (state.firstBreak !== s) update({ ...state, firstBreak: s }); }}>
                  <span className="block truncate">{nameOf(s)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!match.decided && (
          <div className="grid gap-3 rounded-xl border border-brand-300 bg-brand-50/40 p-3 dark:border-brand-500/40 dark:bg-brand-500/5">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {match.current.tieBreak ? 'Tie-breaker board' : `Board ${match.current.board}`}
            </div>
            <Row label="Won by">
              <div className="grid grid-cols-2 gap-2">
                {(['A', 'B'] as Side[]).map((s) => (
                  <button key={s} type="button" disabled={disabled} className={choiceCls(winner === s)} onClick={() => setWinner(s)}>
                    <span className="block truncate">{nameOf(s)}</span>
                  </button>
                ))}
              </div>
            </Row>
            {!onlyBoards && (
              <>
                <Row label={`${winner ? nameOf(winner === 'A' ? 'B' : 'A') : 'Loser'}'s coins left`}>
                  <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
                    {Array.from({ length: CARROM_COINS + 1 }, (_, n) => (
                      <button key={n} type="button" disabled={disabled} className={cn(choiceCls(coins === n), 'px-0 py-1.5')} onClick={() => setCoins(n)}>
                        {n}
                      </button>
                    ))}
                  </div>
                </Row>
                <Row label="Queen covered by">
                  <div className="grid grid-cols-2 gap-2">
                    {(['winner', 'loser'] as QueenCover[]).map((q) => (
                      <button key={q} type="button" disabled={disabled} className={choiceCls(queen === q)} onClick={() => setQueen(q)}>
                        {q === 'winner' ? `Board winner (+${rules.queenPoints})` : 'The other side'}
                      </button>
                    ))}
                  </div>
                </Row>
              </>
            )}
            {extras ? (
              <div className="grid gap-2 rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700">
                <label className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                  <input type="checkbox" checked={slam} disabled={disabled} onChange={(e) => setSlam(e.target.checked)} />
                  Slam - every coin and the queen in one turn from the break
                </label>
                {(['A', 'B'] as Side[]).map((s) => (
                  <div key={s} className="flex items-center justify-between gap-2">
                    <span className="truncate text-slate-700 dark:text-slate-200">Fouls (dues) · {nameOf(s)}</span>
                    <span className="flex items-center gap-1.5">
                      <Button size="sm" variant="outline" disabled={disabled || fouls[s] === 0} onClick={() => setFouls({ ...fouls, [s]: fouls[s] - 1 })}>−</Button>
                      <span className="w-6 text-center font-mono tabular-nums">{fouls[s]}</span>
                      <Button size="sm" variant="outline" disabled={disabled} onClick={() => setFouls({ ...fouls, [s]: fouls[s] + 1 })}>+</Button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <button type="button" className="text-left text-xs text-slate-500 underline underline-offset-2 dark:text-slate-400" onClick={() => setExtras(true)}>
                + Slam or fouls (optional)
              </button>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-slate-600 dark:text-slate-300">
                {winner
                  ? onlyBoards
                    ? `${nameOf(winner)} take the board`
                    : `${nameOf(winner)} score ${preview}${queen === 'winner' && preview > coins ? ` (${coins} + queen)` : ''}`
                  : 'Pick who won the board'}
              </span>
              <Button className="ml-auto" disabled={disabled || busy || !winner} onClick={record}>Record board</Button>
            </div>
          </div>
        )}

        {/* The scoresheet, game by game. */}
        {match.games.length > 0 && (
          <div className="space-y-3">
            {match.games.map((g, gi) => (
              <div key={gi} className="rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-sm font-semibold dark:border-slate-800">
                  <span>{onlyBoards ? `Board ${gi + 1}` : `Game ${gi + 1}`}</span>
                  <span className="font-mono tabular-nums">{onlyBoards ? (g.winner ? `${nameOf(g.winner)} won` : '') : `${g.score[0]}–${g.score[1]}${g.winner ? ` · ${nameOf(g.winner)} won` : ''}`}</span>
                </div>
                {!onlyBoards && (
                  <ol className="divide-y divide-slate-100 text-xs text-slate-600 dark:divide-slate-800 dark:text-slate-300">
                    {g.boards.map((bd, bi) => (
                      <li key={bi} className="flex flex-wrap justify-between gap-2 px-3 py-1.5">
                        <span>Board {bi + 1} · {nameOf(bd.winner)} won{bd.slam ? ' · slam' : ''}</span>
                        <span className="text-slate-400 dark:text-slate-500">
                          {bd.coinsLeft} coin{bd.coinsLeft === 1 ? '' : 's'}{bd.points > bd.coinsLeft ? ' + queen' : ''} = <b className="text-slate-700 dark:text-slate-200">{bd.points}</b> · {nameOf(bd.breaker)} broke
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <span className={cn('text-sm', busy ? 'text-amber-600 dark:text-amber-300' : match.decided ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400')}>
            {status}
          </span>
          <div className="ml-auto flex gap-2">
            {state.boards.length > 0 && <Button variant="outline" disabled={disabled || busy} onClick={undo}>Undo last board</Button>}
            <Button disabled={disabled || busy || !match.decided} onClick={confirm}>Confirm result</Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center sm:gap-4">
      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</div>
      {children}
    </div>
  );
}

function Name({ name, breaking, winner, align = 'left' }: { name: string; breaking: boolean; winner: boolean; align?: 'left' | 'right' }) {
  return (
    <div className={cn('min-w-0', align === 'right' && 'text-right')}>
      <div className={cn('truncate text-sm font-bold sm:text-base', winner ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-900 dark:text-slate-100')}>{name}</div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400">{winner ? 'winner' : breaking ? 'breaks next' : ' '}</div>
    </div>
  );
}

const choiceCls = (selected: boolean) => cn(
  'min-w-0 rounded-lg border-2 px-3 py-2 text-sm font-semibold transition disabled:opacity-50',
  selected
    ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-transparent dark:text-slate-200',
);
