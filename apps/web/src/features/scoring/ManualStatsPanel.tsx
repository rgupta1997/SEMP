import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { eventMinuteLabels, parseStoredFormat, statSpecFor, type RallyEvent, type Side, type SportStatSpec, type StatEventSpec } from '@semp/shared';
import { Button, Input, Select, cn } from '../../components/ui';
import type { LogEntry } from './engine';

/**
 * PLAYER STATS ON THE FINAL-SCORE FORM.
 *
 * Final-score entry used to record the score and nothing else, so a football match
 * entered that way put no goals, assists or cards on anybody's record. The live deck
 * credits all of that one tap at a time. This panel collects the same facts after
 * the match, in the same shape: each row is an attributed `point` event, exactly
 * what the live deck pushes into its log. That is why the server needs no second
 * fold. It reads these from `live_state.manualEvents` through the same
 * `deriveTeamStats`.
 */

export type ManualEvent = Extract<RallyEvent, { t: 'point' }> & { minute?: number };
export interface StatPerson { id: string; name: string }

const isPoint = (e: unknown): e is ManualEvent => !!e && typeof e === 'object' && (e as RallyEvent).t === 'point';
const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');

/**
 * Which sports take player stats on this form: the ones whose stats come from
 * attributed actions. Racquet stats come from the point log through the kernel, and
 * cricket has its own scorecard, so a games tally or a run total has nothing to
 * attribute here.
 */
export function manualStatSpec(sport: string | null | undefined): SportStatSpec | null {
  const spec = statSpecFor(sport);
  if (!spec || spec.family === 'racquet' || spec.family === 'cricket' || spec.family === 'measured') return null;
  return spec.events.length ? spec : null;
}

/**
 * What the form opens with. Stats already typed with a final score win. Failing that,
 * the attributed actions of the live log this match was being scored on are used, so
 * a match switched to final-score part-way through keeps its scorers.
 */
export function seedManualEvents(liveState: any): ManualEvent[] {
  if (Array.isArray(liveState?.manualEvents)) return liveState.manualEvents.filter(isPoint);
  const rally: RallyEvent[] = Array.isArray(liveState?.rally) ? liveState.rally : [];
  const format = parseStoredFormat(liveState?.format);
  const minutes = format ? eventMinuteLabels(format, rally) : [];
  const out: ManualEvent[] = [];
  rally.forEach((e, i) => {
    if (!isPoint(e) || e.rescinded || !e.kind) return;
    const m = minutes[i] ? parseInt(minutes[i]!, 10) : NaN;
    out.push({
      t: 'point', side: e.side, pts: e.pts ?? 0, kind: e.kind,
      ...(e.label ? { label: e.label } : {}),
      ...(e.playerId ? { playerId: e.playerId, playerName: e.playerName } : {}),
      ...(e.secondId ? { secondId: e.secondId, secondName: e.secondName } : {}),
      ...(e.value !== undefined ? { value: e.value } : {}),
      ...(e.flags ? { flags: e.flags } : {}),
      ...(Number.isFinite(m) ? { minute: m } : {}),
    });
  });
  return out;
}

/** The timeline the match pages render, in minute order, newest first (as the live deck writes it). */
export function manualTimeline(events: ManualEvent[]): LogEntry[] {
  const ordered = events
    .map((e, i) => ({ e, i }))
    .sort((x, y) => (x.e.minute ?? Infinity) - (y.e.minute ?? Infinity) || x.i - y.i);
  return ordered.map(({ e }, n) => ({
    t: e.minute != null ? `${e.minute}'` : `#${n + 1}`,
    team: e.side,
    txt: `${e.label ?? e.kind}${e.playerName ? ` · ${e.playerName}` : ''}`,
    ...(e.playerName ? { player: e.playerName } : {}),
    ...(e.playerId ? { playerId: e.playerId } : {}),
    ...(e.secondId ? { secondId: e.secondId, secondName: e.secondName } : {}),
    ...(e.value !== undefined ? { value: e.value } : {}),
    kind: e.kind,
  })).reverse();
}

/** Scoreboard points the recorded actions add up to, per side. */
export function pointsFromEvents(events: ManualEvent[]): [number, number] {
  const out: [number, number] = [0, 0];
  for (const e of events) out[e.side === 'A' ? 0 : 1] += e.pts ?? 0;
  return out;
}

/** Families whose headline score IS the sum of their scoring actions, so the two can be checked. */
const scoreIsPoints = (spec: SportStatSpec) => spec.family === 'invasion' || spec.family === 'raid';

/**
 * More scoring actions than the score allows is a typo, and saving it would put a
 * goal on somebody's record that the result doesn't contain. Fewer is fine: those
 * goals simply have no named scorer.
 */
export function attributionError(spec: SportStatSpec | null | undefined, events: ManualEvent[], score: [number | null, number | null], names: [string, string]): string | null {
  if (!spec || !scoreIsPoints(spec)) return null;
  const got = pointsFromEvents(events);
  for (const i of [0, 1] as const) {
    const s = score[i];
    if (s != null && got[i] > s) {
      return `${names[i]}: the stats add up to ${got[i]} but the score says ${s}. Fix the score or remove a stat.`;
    }
  }
  return null;
}

const toneOf = (ev: StatEventSpec) =>
  ev.forOpponent ? 'border-rose-300 text-rose-700 dark:border-rose-500/40 dark:text-rose-300'
  : ev.tone === 'caution' || ev.tone === 'warning' ? 'border-amber-300 text-amber-800 dark:border-amber-500/40 dark:text-amber-200'
  : ev.tone === 'dismissal' ? 'border-rose-300 text-rose-700 dark:border-rose-500/40 dark:text-rose-300'
  : (ev.points ?? 0) > 0 || ev.tone === 'score' ? 'border-emerald-300 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300'
  : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300';

export function ManualStatsPanel({ spec, names, rosters, events, onChange, score, onUseScore, disabled }: {
  spec: SportStatSpec;
  names: [string, string];
  /** Who can be picked for each side: the team sheet when there is one, else the squad. */
  rosters: Record<Side, StatPerson[]>;
  events: ManualEvent[];
  onChange: (next: ManualEvent[]) => void;
  score: [number | null, number | null];
  /** Offered when no score is typed yet and the stats imply one. */
  onUseScore?: (a: number, b: number) => void;
  disabled?: boolean;
}) {
  const [side, setSide] = useState<Side>('A');
  const [kind, setKind] = useState<string>(spec.events[0]?.key ?? '');
  const [player, setPlayer] = useState('');
  const [second, setSecond] = useState('');
  const [value, setValue] = useState('1');
  const [minute, setMinute] = useState('');

  const ev = spec.events.find((e) => e.key === kind) ?? spec.events[0];
  const teamAction = ev?.perPlayer === false;
  const secondSide: Side = ev?.secondPlayer?.fromOpponent ? other(side) : side;
  const nameOf = (s: Side, id: string) => rosters[s].find((p) => p.id === id)?.name;

  const got = pointsFromEvents(events);
  const error = attributionError(spec, events, score, names);
  const noun = spec.events.some((e) => e.key === 'goal') ? 'goal' : 'point';
  const gaps = scoreIsPoints(spec)
    ? ([0, 1] as const).flatMap((i) => {
        const s = score[i];
        const missing = s != null ? s - got[i] : 0;
        return missing > 0 ? [`${names[i]}: ${missing} ${noun}${missing === 1 ? '' : 's'} with no scorer yet`] : [];
      })
    : [];

  const add = () => {
    if (!ev) return;
    if (!teamAction && !player) return;
    const n = ev.value ? Math.max(ev.value.min ?? 0, Number(value) || 0) : undefined;
    const m = minute === '' ? undefined : Math.max(0, Math.min(300, Math.floor(Number(minute))));
    const next: ManualEvent = {
      t: 'point',
      // An own goal's points go to the OTHER side; the player is filed back on their
      // own side by the stat fold, as the live deck does it.
      side: ev.forOpponent ? other(side) : side,
      pts: ev.scoresValue && n ? n : ev.points && ev.points > 0 ? ev.points : 0,
      kind: ev.key,
      label: ev.scoresValue && n ? `${ev.label} +${n}` : ev.label,
      ...(!teamAction && player ? { playerId: player, playerName: nameOf(side, player) } : {}),
      ...(ev.secondPlayer && second && !teamAction ? { secondId: second, secondName: nameOf(secondSide, second) } : {}),
      ...(n !== undefined ? { value: n } : {}),
      ...(m !== undefined && Number.isFinite(m) ? { minute: m } : {}),
    };
    onChange([...events, next]);
    // Keep the side and action (the next goal is often the same team's); clear the people.
    setPlayer(''); setSecond(''); setMinute('');
  };

  // The player's own team, which for an own goal is not the side the points went to.
  const playerSideOf = (e: ManualEvent): Side => {
    const s = spec.events.find((x) => x.key === e.kind);
    return s?.forOpponent ? other(e.side) : e.side;
  };
  const sorted = events.map((e, i) => ({ e, i }))
    .sort((x, y) => (x.e.minute ?? Infinity) - (y.e.minute ?? Infinity) || x.i - y.i);

  const canUseScore = !!onUseScore && scoreIsPoints(spec) && score[0] == null && score[1] == null && got[0] + got[1] > 0;

  return (
    <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800" data-qa="manual-stats">
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
        <div>
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Match stats</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Who scored, cards and the rest. These go on each player’s record.</div>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-slate-400">{events.length} recorded</span>
      </div>

      {sorted.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {sorted.map(({ e, i }) => {
            const s = spec.events.find((x) => x.key === e.kind);
            const ps = playerSideOf(e);
            return (
              <li key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="w-9 shrink-0 text-xs tabular-nums text-slate-400">{e.minute != null ? `${e.minute}'` : '-'}</span>
                <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold', s ? toneOf(s) : 'border-slate-300 text-slate-600')}>{e.label ?? e.kind}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
                  {e.playerName ?? <span className="text-slate-400">{names[ps === 'A' ? 0 : 1]}</span>}
                  {e.secondName && <span className="text-slate-400"> · {s?.secondPlayer?.label ?? 'with'} {e.secondName}</span>}
                  <span className="ml-1 text-xs text-slate-400">({names[ps === 'A' ? 0 : 1]})</span>
                </span>
                <button type="button" disabled={disabled} aria-label="Remove"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800"
                  onClick={() => onChange(events.filter((_, j) => j !== i))}>
                  <X size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 px-3 py-3 dark:border-slate-800 dark:bg-slate-800/30">
        {/* The player's team first: everything below is picked from its roster. */}
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
          {(['A', 'B'] as const).map((s, i) => (
            <button key={s} type="button" disabled={disabled}
              onClick={() => { setSide(s); setPlayer(''); setSecond(''); }}
              className={cn('truncate rounded-lg px-2 py-1.5 text-sm font-medium transition',
                side === s ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')}>
              {names[i]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {spec.events.map((e) => (
            <button key={e.key} type="button" disabled={disabled}
              onClick={() => { setKind(e.key); setSecond(''); }}
              className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold transition',
                e.key === ev?.key ? 'border-brand-600 bg-brand-600 text-white' : cn('bg-white dark:bg-slate-900', toneOf(e)))}>
              {e.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
          {!teamAction && (
            <Select value={player} disabled={disabled} onChange={(x) => setPlayer(x.target.value)} aria-label="Player">
              <option value="">{ev?.forOpponent ? 'Who put it in?' : 'Player'}</option>
              {rosters[side].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
          {ev?.secondPlayer && !teamAction ? (
            <Select value={second} disabled={disabled} onChange={(x) => setSecond(x.target.value)} aria-label={ev.secondPlayer.label}>
              <option value="">{ev.secondPlayer.label}{ev.secondPlayer.optional ? ' (optional)' : ''}</option>
              {rosters[secondSide].filter((p) => p.id !== player).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          ) : <span className="hidden sm:block" />}
          <div className="flex gap-2">
            {ev?.value && (
              <Input className="w-20 text-center" inputMode="numeric" value={value} disabled={disabled}
                onChange={(x) => setValue(x.target.value.replace(/[^\d]/g, '').slice(0, 3))}
                aria-label={ev.value.label} placeholder={ev.value.label} />
            )}
            <Input className="w-20 text-center" inputMode="numeric" value={minute} disabled={disabled}
              onChange={(x) => setMinute(x.target.value.replace(/[^\d]/g, '').slice(0, 3))}
              aria-label="Minute (optional)" placeholder="Min'" />
          </div>
          <Button type="button" variant="outline" disabled={disabled || (!teamAction && !player) || (!!ev?.secondPlayer && !ev.secondPlayer.optional && !second)} onClick={add}>
            <Plus size={15} /> Add
          </Button>
        </div>
        {!teamAction && rosters[side].length === 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{names[side === 'A' ? 0 : 1]} has nobody on its squad yet, so there’s no one to credit.</p>
        )}
      </div>

      {(error || gaps.length > 0 || canUseScore) && (
        <div className="space-y-1 border-t border-slate-100 px-3 py-2 text-xs dark:border-slate-800">
          {error && <p className="text-rose-700 dark:text-rose-300" data-qa="manual-stats-error">{error}</p>}
          {!error && gaps.map((g) => <p key={g} className="text-slate-500 dark:text-slate-400">{g}</p>)}
          {canUseScore && (
            <button type="button" className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
              onClick={() => onUseScore!(got[0], got[1])}>
              Set the score to {got[0]}-{got[1]} from these stats
            </button>
          )}
        </div>
      )}
    </div>
  );
}
