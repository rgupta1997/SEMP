import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CARROM_COINS, boardsOnly, carromBoardPoints, carromHeadline, carromMatch, queenCoversFor, readCarromState,
  type CarromBoard, type CarromBoardsState, type CarromGame, type CarromRules, type QueenCover, type Side,
} from '@semp/shared';
import { Button, Card, CardBody, CardHeader, cn, confirmDialog, toast } from '../../components/ui';

/** What the carrom screen keeps in `live_state.carrom` (or on a tie rubber). */
export type CarromState = CarromBoardsState;

export function hydrateCarrom(raw: unknown): CarromState {
  return readCarromState(raw) ?? { boards: [], firstBreak: 'A' };
}

/**
 * Carrom records each BOARD's result - who won it, the loser's coins left and who
 * covered the queen - and the points follow (carrom.ts). Nobody taps points one by one.
 */
export function CarromResult({ homeName, awayName, rules, initial, disabled, busy, onSave, rubber, formatName, provenance }: {
  homeName: string; awayName: string;
  rules: CarromRules;
  /** The format being scored ("ICF — best of 3 games to 25"), and where it came from. */
  formatName?: string;
  provenance?: string;
  /** A rubber of a team tie: confirming it settles the rubber, not the fixture. */
  rubber?: boolean;
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
  const queenCovers = queenCoversFor(rules);
  const update = (next: CarromState) => { edited.current = true; setState(next); onSave(next, false); };

  // The board being entered.
  const [winner, setWinner] = useState<Side | null>(null);
  // No default: a board ends on the winner's last coin, so the loser always has 1-9
  // left - and a pre-selected number got recorded without anyone choosing it.
  const [coins, setCoins] = useState<number | null>(null);
  const [queen, setQueen] = useState<QueenCover>('winner');
  const [extras, setExtras] = useState(false);
  const [slam, setSlam] = useState(false);
  const [fouls, setFouls] = useState({ A: 0, B: 0 });
  const resetEntry = () => { setWinner(null); setCoins(null); setQueen('winner'); setSlam(false); setFouls({ A: 0, B: 0 }); setExtras(false); };

  const game = match.decided ? null : match.games.find((g) => !g.winner) ?? null;
  const gameScore: [number, number] = game?.score ?? [0, 0];
  // The fixture's score: games won, or a one-game match's points (even once it is over).
  const headline = carromHeadline(match, rules);
  const multiGame = rules.gamesToWin > 1 && !onlyBoards;
  const headlineUnit = onlyBoards ? 'boards' : multiGame ? 'games' : 'points';
  // Ready to record: a winner, and - unless only the winner is recorded - the coins left.
  const ready = !!winner && (onlyBoards || coins !== null);
  const preview = winner && coins !== null
    ? carromBoardPoints({ winner, coinsLeft: coins, queen }, gameScore[winner === 'A' ? 0 : 1], rules)
    : 0;
  const queenCounts = queen === 'winner' && coins !== null && preview > coins;

  const record = () => {
    if (!winner) { toast.error('Pick who won the board.'); return; }
    if (!onlyBoards && coins === null) { toast.error("Pick how many coins the loser had left."); return; }
    const board: CarromBoard = {
      winner,
      coinsLeft: onlyBoards ? 0 : coins!,
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
      title: rubber ? 'Confirm this rubber' : 'Confirm final result',
      confirmLabel: rubber ? 'Record rubber' : 'Sign off',
      message: `${nameOf(match.winner)} win ${headline[match.winner === 'A' ? 0 : 1]}-${headline[match.winner === 'A' ? 1 : 0]}`
        + ` in ${headlineUnit}. `
        + (rubber ? 'The rubber goes to them in the tie.' : 'This completes the match and updates standings.'),
    });
    if (ok) onSave(state, true);
  };

  const status = busy
    ? 'Saving… the buttons unlock when the server confirms'
    : match.decided
      ? `${nameOf(match.winner!)} win the ${rubber ? 'rubber' : 'match'} - ready to confirm`
      : match.current.tieBreak
        ? `Level after ${rules.maxBoards} boards - the next board decides the game`
        : state.boards.length === 0
          ? 'Pick who breaks first, then record each board as it finishes'
          : 'Record the next board when it finishes';

  // Finished games newest first, collapsed; the game in progress is always open.
  const finishedGames = match.games.map((g, i) => ({ g, i })).filter(({ g }) => g.winner).reverse();

  return (
    <Card>
      <CardHeader
        title={onlyBoards ? `Carrom · first to ${rules.gamesToWin} boards` : `Carrom · ${multiGame ? `best of ${rules.gamesToWin * 2 - 1} games` : 'one game'} to ${rules.gameTarget}`}
        subtitle={onlyBoards
          ? 'Record who won each board.'
          : `Each board: who won, the loser's coins left, who covered the queen (+${rules.queenPoints}${rules.queenCutoff ? ` until ${rules.queenCutoff}` : ''})${rules.maxBoards ? ` · ${rules.maxBoards} boards a game` : ''}.`} />
      <CardBody className="space-y-5">
        {/* Which format is being scored - and where it came from - as the racquet consoles show it. */}
        {formatName && (
          <div className="-mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">Format</span>
            <span className="font-semibold text-slate-800 dark:text-slate-100">{formatName}</span>
            {provenance && <span className="text-xs">· {provenance}</span>}
          </div>
        )}
        {/* Scoreboard: the match score with its unit, and the game in progress as points to the target. */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            <Name name={homeName} colour={match.decided ? null : match.nextBreaker === 'A' ? 'white' : 'black'} winner={match.winner === 'A'} />
            <div className="text-center">
              <div className="font-mono text-4xl font-black tabular-nums text-slate-900 dark:text-white">
                {headline[0]}<span className="px-2 text-slate-300 dark:text-slate-600">–</span>{headline[1]}
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{headlineUnit}</div>
            </div>
            <Name name={awayName} colour={match.decided ? null : match.nextBreaker === 'B' ? 'white' : 'black'} winner={match.winner === 'B'} align="right" />
          </div>
          {multiGame && !match.decided && (
            <div className="mt-4 grid gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
                <span>Game {match.current.game}</span>
                <span className="font-normal text-slate-500 dark:text-slate-400">
                  {match.current.tieBreak
                    ? `level after ${rules.maxBoards} boards · tie-breaker board`
                    : `board ${match.current.board}${rules.maxBoards ? ` of ${rules.maxBoards}` : ''} · to ${rules.gameTarget}`}
                </span>
              </div>
              {(['A', 'B'] as Side[]).map((s) => (
                <Progress key={s} label={nameOf(s)} value={gameScore[s === 'A' ? 0 : 1]} max={rules.gameTarget} />
              ))}
            </div>
          )}
          {!multiGame && !onlyBoards && !match.decided && (
            <div className="mt-4 grid gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
              {(['A', 'B'] as Side[]).map((s) => (
                <Progress key={s} label={nameOf(s)} value={gameScore[s === 'A' ? 0 : 1]} max={rules.gameTarget} />
              ))}
            </div>
          )}
        </div>

        {/* The toss: who breaks the first board. Fixed once a board is recorded. */}
        {state.boards.length === 0 && (
          <Row label="Breaks first (plays white)">
            <div className="grid grid-cols-2 gap-2">
              {(['A', 'B'] as Side[]).map((s) => (
                <button key={s} type="button" disabled={disabled} className={choiceCls(state.firstBreak === s)}
                  onClick={() => { if (state.firstBreak !== s) update({ ...state, firstBreak: s }); }}>
                  <span className="block truncate">{nameOf(s)}</span>
                </button>
              ))}
            </div>
          </Row>
        )}

        {!match.decided && (
          <div className="grid gap-4 rounded-xl border border-brand-300 bg-brand-50/40 p-4 dark:border-brand-500/40 dark:bg-brand-500/5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-base font-bold text-slate-900 dark:text-slate-100">
                {multiGame && <span className="text-slate-500 dark:text-slate-400">Game {match.current.game} · </span>}
                {match.current.tieBreak ? 'Tie-breaker board' : `Board ${match.current.board}`}
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
                <Disc white /> {nameOf(match.nextBreaker)} breaks · plays white
              </span>
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
                <Row label={winner ? `Coins ${nameOf(winner === 'A' ? 'B' : 'A')} had left` : "Loser's coins left"}>
                  <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-9">
                    {Array.from({ length: CARROM_COINS }, (_, i) => i + 1).map((n) => (
                      <button key={n} type="button" disabled={disabled} aria-pressed={coins === n}
                        className={cn(choiceCls(coins === n), 'px-0 py-2 font-mono tabular-nums')} onClick={() => setCoins(n)}>
                        {n}
                      </button>
                    ))}
                  </div>
                </Row>
                <Row label="Queen covered by">
                  {/* "Nobody" only where covering is not compulsory - ICF never ends a board uncovered. */}
                  <div className={cn('grid gap-2', queenCovers.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
                    {queenCovers.map((q) => (
                      <button key={q} type="button" disabled={disabled} className={choiceCls(queen === q)} onClick={() => setQueen(q)}>
                        <span className="block truncate">
                          {q === 'winner'
                            ? `${winner ? nameOf(winner) : 'Board winner'} (+${rules.queenPoints})`
                            : q === 'loser'
                              ? winner ? nameOf(winner === 'A' ? 'B' : 'A') : 'The other side'
                              : 'Nobody (uncovered)'}
                        </span>
                      </button>
                    ))}
                  </div>
                </Row>
              </>
            )}

            {extras ? (
              <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Optional · for stats only</span>
                  <button type="button" className="text-xs text-slate-500 underline underline-offset-2 dark:text-slate-400" onClick={() => { setExtras(false); setSlam(false); setFouls({ A: 0, B: 0 }); }}>
                    Remove
                  </button>
                </div>
                <label className="flex items-start gap-2 text-slate-700 dark:text-slate-200">
                  <input type="checkbox" className="mt-0.5" checked={slam} disabled={disabled} onChange={(e) => setSlam(e.target.checked)} />
                  <span><b>Slam</b> - the winner pocketed every coin and the queen in one turn from the break</span>
                </label>
                {(['A', 'B'] as Side[]).map((s) => (
                  <div key={s} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-slate-700 dark:text-slate-200"><b>Fouls</b> (dues) · {nameOf(s)}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Button size="sm" variant="outline" disabled={disabled || fouls[s] === 0} onClick={() => setFouls({ ...fouls, [s]: fouls[s] - 1 })}>−</Button>
                      <span className="w-6 text-center font-mono tabular-nums">{fouls[s]}</span>
                      <Button size="sm" variant="outline" disabled={disabled} onClick={() => setFouls({ ...fouls, [s]: fouls[s] + 1 })}>+</Button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <button type="button" className="justify-self-start text-xs text-slate-500 underline underline-offset-2 dark:text-slate-400" onClick={() => setExtras(true)}>
                + Slam or fouls (optional)
              </button>
            )}

            {/* What recording this board will do, before it is recorded. */}
            <div className="flex flex-wrap items-center gap-3 border-t border-brand-200 pt-3 dark:border-brand-500/20">
              {ready && winner ? (
                <span className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
                  <b className="font-mono text-base tabular-nums">+{onlyBoards ? 1 : preview}</b>
                  <span className="min-w-0 truncate">
                    {nameOf(winner)}{onlyBoards ? ' take the board' : queenCounts ? ` · ${coins} coins + queen` : ` · ${coins} coin${coins === 1 ? '' : 's'}`}
                  </span>
                </span>
              ) : (
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  {winner ? 'Pick how many coins the loser had left' : 'Pick who won the board'}
                </span>
              )}
              <Button className="ml-auto" disabled={disabled || busy || !ready} onClick={record}>Record board</Button>
            </div>
          </div>
        )}

        {/* The scoresheet: the game in progress open, finished games folded, newest first. */}
        {game && <GameSheet title={`Game ${match.current.game} · in progress`} game={game} nameOf={nameOf} onlyBoards={onlyBoards} open />}
        {finishedGames.map(({ g, i }) => (
          <GameSheet key={i} title={onlyBoards ? `Board ${i + 1}` : `Game ${i + 1}`} game={g} nameOf={nameOf} onlyBoards={onlyBoards}
            open={match.decided && finishedGames.length === 1} />
        ))}

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <span className={cn('text-sm', busy ? 'text-amber-600 dark:text-amber-300' : match.decided ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400')}>
            {status}
          </span>
          <div className="ml-auto flex gap-2">
            {state.boards.length > 0 && <Button variant="outline" disabled={disabled || busy} onClick={undo}>Undo last board</Button>}
            <Button disabled={disabled || busy || !match.decided} onClick={confirm}>{rubber ? 'Confirm rubber' : 'Confirm result'}</Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

/** One game's boards as a table, with the running score after each board. */
function GameSheet({ title, game, nameOf, onlyBoards, open }: {
  title: string; game: CarromGame; nameOf: (s: Side) => string; onlyBoards: boolean; open?: boolean;
}) {
  const running: [number, number] = [0, 0];
  const rows = game.boards.map((b) => {
    running[b.winner === 'A' ? 0 : 1] += onlyBoards ? 1 : b.points;
    return { b, after: [running[0], running[1]] as [number, number] };
  });
  return (
    <details open={open} className="group rounded-xl border border-slate-200 dark:border-slate-800">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm">
        <span className="font-semibold text-slate-900 dark:text-slate-100">{title}</span>
        <span className="flex min-w-0 items-center gap-2">
          {!onlyBoards && <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">{game.score[0]}–{game.score[1]}</span>}
          {game.winner && <span className="truncate text-xs text-emerald-700 dark:text-emerald-300">{nameOf(game.winner)} won</span>}
          <span className="text-slate-400 transition group-open:rotate-180" aria-hidden>▾</span>
        </span>
      </summary>
      {!onlyBoards && rows.length > 0 && (
        <table className="w-full border-t border-slate-200 text-xs dark:border-slate-800">
          <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
            <tr>
              <th className="px-3 py-1.5 font-semibold">Board</th>
              <th className="px-3 py-1.5 font-semibold">Won by</th>
              <th className="px-3 py-1.5 text-right font-semibold">Points</th>
              <th className="hidden px-3 py-1.5 font-semibold sm:table-cell">White (broke)</th>
              <th className="px-3 py-1.5 text-right font-semibold">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700 dark:divide-slate-800 dark:text-slate-300">
            {rows.map(({ b, after }, i) => (
              <tr key={i}>
                <td className="px-3 py-1.5 tabular-nums">{i + 1}</td>
                <td className="max-w-[10rem] truncate px-3 py-1.5">{nameOf(b.winner)}{b.slam ? ' · slam' : ''}</td>
                <td className="px-3 py-1.5 text-right">
                  <b className="font-mono tabular-nums">{b.points}</b>
                  {b.points > b.coinsLeft && <span className="ml-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400" title="Includes the queen">+Q</span>}
                </td>
                <td className="hidden max-w-[10rem] truncate px-3 py-1.5 text-slate-500 sm:table-cell dark:text-slate-400"><span className="inline-flex items-center gap-1.5"><Disc white /> {nameOf(b.breaker)}</span></td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{after[0]}–{after[1]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}

/**
 * A carrom coin in the colour a side plays. ICF: whoever breaks plays white, so the
 * colours alternate with the break - nothing extra is recorded.
 */
function Disc({ white }: { white: boolean }) {
  return (
    <span aria-label={white ? 'White' : 'Black'}
      className={cn('inline-block h-3 w-3 shrink-0 rounded-full border',
        white ? 'border-slate-400 bg-white' : 'border-slate-700 bg-slate-900 dark:border-slate-400')} />
  );
}

function Progress({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs">
      <span className="truncate text-slate-600 dark:text-slate-300">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <span className="block h-full rounded-full bg-brand-500 transition-all" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </span>
      <span className="text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</span>
    </div>
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

/** A side's name, with the colour it plays on the next board (white breaks). */
function Name({ name, colour, winner, align = 'left' }: {
  name: string; colour: 'white' | 'black' | null; winner: boolean; align?: 'left' | 'right';
}) {
  return (
    <div className={cn('min-w-0', align === 'right' && 'text-right')}>
      <div className={cn('truncate text-sm font-bold sm:text-base', winner ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-900 dark:text-slate-100')}>{name}</div>
      <div className={cn('mt-0.5 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400', align === 'right' && 'justify-end')}>
        {winner ? 'match winner'
          : colour === 'white' ? (<><Disc white /> white · breaks next</>)
          : colour === 'black' ? (<><Disc white={false} /> black</>)
          : ' '}
      </div>
    </div>
  );
}

const choiceCls = (selected: boolean) => cn(
  'min-w-0 rounded-lg border-2 px-3 py-2 text-sm font-semibold transition disabled:opacity-50',
  selected
    ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-transparent dark:text-slate-200',
);
