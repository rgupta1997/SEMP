import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CHESS_ENDINGS, chessMatchOutcome, endingsFor, formatPoints, whiteInGame,
  type ChessEnding, type ChessGame, type ChessResult as Result, type Side,
} from '@semp/shared';
import { Button, Card, CardBody, CardHeader, cn, confirmDialog, toast } from '../../components/ui';

/** What the chess screen keeps in `live_state.chess`. */
export interface ChessState {
  games: ChessGame[];
  /** Who had white in game 1; colours alternate from there. */
  firstWhite: Side;
  /** A drawn match settled by the organiser's tie-break (Armageddon, blitz play-off). */
  tiebreakWinner?: Side;
}

export function hydrateChess(raw: unknown): ChessState {
  const r = (raw ?? {}) as Partial<ChessState>;
  const side = (v: unknown): Side | undefined => (v === 'A' || v === 'B' ? v : undefined);
  const games = Array.isArray(r.games)
    ? r.games.filter((g): g is ChessGame => !!g && (g.result === 'A' || g.result === 'B' || g.result === 'draw'))
    : [];
  return { games, firstWhite: side(r.firstWhite) ?? 'A', ...(side(r.tiebreakWinner) ? { tiebreakWinner: side(r.tiebreakWinner) } : {}) };
}

/** The match as it stands: points, and the winner - on the board, or on tie-break. */
export function chessSummary(state: ChessState, gamesInMatch: number) {
  const o = chessMatchOutcome(state.games, gamesInMatch);
  return { ...o, winner: o.winner ?? (o.drawn ? state.tiebreakWinner ?? null : null), drawnMatch: o.drawn && !state.tiebreakWinner };
}

/** Games in a chess match from its format: the top level is "units to win" (best of N). */
export function chessGamesIn(format: { levels: Array<{ target: number }> } | null | undefined): number {
  const top = format?.levels?.[format.levels.length - 1];
  return top && top.target > 0 ? top.target * 2 - 1 : 1;
}


/**
 * Chess records only each game's result (nothing counted in play); the match total is the
 * sum of game points (2½–½), and a level match is settled by tie-break without changing points.
 */
export function ChessResult({ homeName, awayName, gamesInMatch, needsWinner, timeControl, initial, disabled, busy, onSave }: {
  homeName: string; awayName: string;
  /** From the draw's format: 1 for a single game, 3 for "best of 3" and so on. */
  gamesInMatch: number;
  /** A knockout match: a level result must be settled on tie-break before sign-off. */
  needsWinner?: boolean;
  /** The format's time control, worded - "90 min + 30 s a move". Shown, not enforced. */
  timeControl?: string | null;
  initial: ChessState;
  disabled?: boolean;
  busy?: boolean;
  /** `done`: the official confirmed the result. The caller works out points and winner. */
  onSave: (state: ChessState, done: boolean) => void;
}) {
  const [state, setState] = useState<ChessState>(initial);
  const seeded = useRef(false);
  /** The scorer has changed something here: from then on this screen owns the state. */
  const edited = useRef(false);
  // Adopt the saved state once, never after a tap: each save echoes back through `initial`,
  // and adopting that echo dropped taps made mid-save (the next save then wiped them).
  useEffect(() => {
    if (seeded.current || edited.current) return;
    if (initial.games.length || initial.firstWhite !== 'A') { setState(initial); seeded.current = true; }
  }, [initial]);

  const nameOf = (s: Side) => (s === 'A' ? homeName : awayName);
  const outcome = useMemo(() => chessMatchOutcome(state.games, gamesInMatch), [state.games, gamesInMatch]);

  const update = (next: ChessState) => { edited.current = true; setState(next); onSave(next, false); };

  const setResult = (i: number, result: Result) => {
    const games = [...state.games];
    const prev = games[i];
    // An ending only fits its kind of result; changing win to draw drops it.
    const keepEnding = prev?.ending && CHESS_ENDINGS[prev.ending].drawn === (result === 'draw');
    games[i] = { white: whiteInGame(state.firstWhite, i), result, ...(keepEnding ? { ending: prev!.ending } : {}) };
    // A correction that now decides the match drops any games recorded after it.
    const decidedHere = chessMatchOutcome(games.slice(0, i + 1), gamesInMatch).decided;
    update({ ...state, games: decidedHere ? games.slice(0, i + 1) : games, tiebreakWinner: undefined });
  };

  const setEnding = (i: number, ending: ChessEnding | '') => {
    const games = state.games.map((g, idx) => {
      if (idx !== i) return g;
      const { ending: _drop, ...rest } = g;
      return ending ? { ...rest, ending } : rest;
    });
    update({ ...state, games });
  };

  const setFirstWhite = (s: Side) => {
    // Colours follow game 1, so every recorded game's colour follows too.
    update({ ...state, firstWhite: s, games: state.games.map((g, i) => ({ ...g, white: whiteInGame(s, i) })) });
  };

  const removeLast = () => update({ ...state, games: state.games.slice(0, -1), tiebreakWinner: undefined });

  // Rows: every recorded game, plus the next one while the match is undecided.
  const rows = outcome.decided || state.games.length >= gamesInMatch ? state.games.length : state.games.length + 1;

  const confirm = async () => {
    if (!outcome.decided) { toast.error('Record every game first.'); return; }
    const [a, b] = outcome.points;
    const drawnMatch = outcome.drawn && !state.tiebreakWinner;
    if (drawnMatch && needsWinner) { toast.error('This is a knockout match - record who won the tie-break.'); return; }
    const ok = await confirmDialog({
      title: drawnMatch ? 'Confirm a drawn match' : 'Confirm final result',
      confirmLabel: drawnMatch ? 'Sign off as a draw' : 'Sign off',
      message: drawnMatch
        ? `${homeName} ${formatPoints(a)} – ${formatPoints(b)} ${awayName}. The match is drawn; standings record it as a draw for both.`
        : `${homeName} ${formatPoints(a)} – ${formatPoints(b)} ${awayName}${outcome.drawn && state.tiebreakWinner ? `, ${nameOf(state.tiebreakWinner)} on tie-break` : ''}. This completes the match and updates standings.`,
    });
    if (!ok) return;
    onSave(state, true);
  };

  const [a, b] = outcome.points;
  // The game being recorded now: the open row, else the last one.
  const current = Math.min(rows, gamesInMatch) - 1;
  const whiteNow = whiteInGame(state.firstWhite, Math.max(0, current));
  // The buttons wait for the last save to land - so say that, rather than leave them dim.
  const status = busy
    ? 'Saving… the buttons unlock when the server confirms'
    : outcome.decided
    ? (outcome.drawn && !state.tiebreakWinner
      ? (needsWinner ? 'Level - record the tie-break winner' : 'Match drawn - ready to confirm')
      : 'Match decided - ready to confirm')
    : state.games.length === 0
      ? 'Record the result when the game ends'
      : `Game ${state.games.length + 1} of ${gamesInMatch} to play`;

  return (
    <Card>
      <CardHeader
        title={gamesInMatch > 1 ? `Chess · ${gamesInMatch}-game match` : 'Chess · single game'}
        subtitle="Only the result is recorded - nothing is scored during play."
        action={timeControl ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <span aria-hidden>⏱</span>{timeControl}
          </span>
        ) : undefined} />
      <CardBody className="space-y-5">
        {/* The match total, in chess notation, each side wearing its colour in the game being played. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/60">
          <PlayerSide name={homeName} white={whiteNow === 'A'} winner={outcome.decided && (outcome.winner ?? state.tiebreakWinner) === 'A'} />
          <div className="min-w-0 text-center">
            {gamesInMatch > 1 ? (
              // A match has a real running total: game points, 1½–½.
              <>
                <div className="font-mono text-4xl font-black tabular-nums tracking-tight text-slate-900 dark:text-white">
                  {formatPoints(a) || '0'}<span className="px-2 text-slate-300 dark:text-slate-600">–</span>{formatPoints(b) || '0'}
                </div>
                <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {state.games.length} of {gamesInMatch} games
                </div>
              </>
            ) : (
              // One game has no score to keep - only a result, so it is said in words.
              <div className="max-w-[16rem] text-base font-bold leading-tight sm:text-lg">
                {state.games[0]
                  ? <span className="text-emerald-700 dark:text-emerald-300">{state.games[0].result === 'draw' ? 'Draw' : `${nameOf(state.games[0].result)} won`}</span>
                  : <span className="text-slate-400 dark:text-slate-500">Awaiting result</span>}
              </div>
            )}
          </div>
          <PlayerSide name={awayName} white={whiteNow === 'B'} winner={outcome.decided && (outcome.winner ?? state.tiebreakWinner) === 'B'} align="right" />
        </div>

        {/* Colours: who had white in game 1; they alternate after that. */}
        <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] sm:items-center sm:gap-4">
          <div className="text-sm text-slate-600 dark:text-slate-300">
            White in game 1{gamesInMatch > 1 && <span className="text-slate-400 dark:text-slate-500"> · colours alternate</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(['A', 'B'] as Side[]).map((s) => (
              <button key={s} type="button" disabled={disabled}
                className={cn(choiceCls(state.firstWhite === s), 'inline-flex items-center justify-center gap-2')}
                onClick={() => { if (state.firstWhite !== s) setFirstWhite(s); }}>
                <Piece white /> <span className="truncate">{nameOf(s)}</span>
              </button>
            ))}
          </div>
        </div>

        <ol className="space-y-3">
          {Array.from({ length: rows }, (_, i) => {
            const g = state.games[i];
            const white = whiteInGame(state.firstWhite, i);
            return (
              <li key={i} className={cn(
                'rounded-xl border p-3 transition',
                g ? 'border-slate-200 dark:border-slate-800' : 'border-brand-300 bg-brand-50/40 dark:border-brand-500/40 dark:bg-brand-500/5',
              )}>
                <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{gamesInMatch > 1 ? `Game ${i + 1}` : 'Result'}</span>
                  <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                    <Piece white /> {nameOf(white)}
                  </span>
                </div>
                {/* Who won, in words - notation by colour and by side read differently,
                    and a scorer only needs to say who won. */}
                <div className="grid grid-cols-3 gap-2">
                  {(['A', 'draw', 'B'] as Result[]).map((r) => (
                    <button key={r} type="button" disabled={disabled}
                      className={cn(choiceCls(g?.result === r), 'flex flex-col items-center gap-0.5 py-2.5')}
                      onClick={() => setResult(i, r)}>
                      <span className="w-full truncate text-sm font-bold">{r === 'draw' ? 'Draw' : nameOf(r)}</span>
                      <span className="text-xs font-medium opacity-70">{r === 'draw' ? '½ each' : 'won'}</span>
                    </button>
                  ))}
                </div>
                {g && (
                  <EndingChips result={g.result} value={g.ending} disabled={disabled}
                    onChange={(ending) => setEnding(i, ending ?? '')} />
                )}
              </li>
            );
          })}
        </ol>

        {outcome.drawn && (
          <div className="grid gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
            <span className="font-semibold text-amber-900 dark:text-amber-200">{gamesInMatch > 1 ? `Level after ${gamesInMatch} games` : 'Drawn game'}</span>
            <span className="text-amber-900/80 dark:text-amber-200/80">
              {needsWinner
                ? 'A knockout match needs a winner: record who won the tie-break (Armageddon, blitz play-off).'
                : 'Sign off as a draw, or record who won the tie-break (Armageddon, blitz play-off).'}
              {' '}The points stay {formatPoints(a)}–{formatPoints(b)}.
            </span>
            <div className={cn('grid gap-2', needsWinner ? 'grid-cols-2' : 'grid-cols-3')}>
              {((needsWinner ? ['A', 'B'] : [undefined, 'A', 'B']) as Array<Side | undefined>).map((s) => (
                <button key={s ?? 'none'} type="button" disabled={disabled}
                  className={choiceCls(state.tiebreakWinner === s)}
                  onClick={() => update({ ...state, ...(s ? { tiebreakWinner: s } : { tiebreakWinner: undefined }) })}>
                  <span className="block truncate">{s ? `${nameOf(s)} on tie-break` : 'Drawn match'}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <span className={cn('text-sm', busy ? 'text-amber-600 dark:text-amber-300' : outcome.decided ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400')}>
            {status}
          </span>
          <div className="ml-auto flex gap-2">
            {state.games.length > 0 && (
              <Button variant="outline" disabled={disabled || busy} onClick={removeLast}>{gamesInMatch > 1 ? 'Undo last game' : 'Clear result'}</Button>
            )}
            <Button disabled={disabled || busy || !outcome.decided} onClick={confirm}>Confirm result</Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

/** Game endings as chips, since nobody opens a dropdown. Optional - the result is what scores. */
export function EndingChips({ result, value, disabled, onChange }: {
  result: Result; value?: ChessEnding; disabled?: boolean; onChange: (e: ChessEnding | undefined) => void;
}) {
  return (
    <div className="mt-3 grid gap-1.5">
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
        How did it end? <span className="font-normal text-slate-400 dark:text-slate-500">optional</span>
      </span>
      <div className="flex flex-wrap gap-1.5">
        {endingsFor(result).map((k) => (
          <button key={k} type="button" disabled={disabled} aria-pressed={value === k}
            onClick={() => onChange(value === k ? undefined : k)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-semibold transition disabled:opacity-50',
              value === k
                ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300',
            )}>
            {CHESS_ENDINGS[k].label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A king in the colour a side plays: the chess way of saying "has white". */
function Piece({ white }: { white: boolean }) {
  return (
    <span aria-label={white ? 'White' : 'Black'}
      className={cn(
        'inline-grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[13px] leading-none',
        white
          ? 'border-slate-300 bg-white text-slate-900 dark:border-slate-500'
          : 'border-slate-700 bg-slate-900 text-white dark:border-slate-500',
      )}>
      ♚
    </span>
  );
}

function PlayerSide({ name, white, winner, align = 'left' }: { name: string; white: boolean; winner: boolean; align?: 'left' | 'right' }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', align === 'right' && 'flex-row-reverse text-right')}>
      <Piece white={white} />
      <div className="min-w-0">
        <div className={cn('truncate text-sm font-bold sm:text-base', winner ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-900 dark:text-slate-100')}>{name}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">{white ? 'White' : 'Black'}{winner ? ' · winner' : ''}</div>
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
