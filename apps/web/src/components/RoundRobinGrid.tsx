import { useMemo } from 'react';
import { cn } from './ui';
import type { BracketFixture } from './Bracket';
import { describeSlot, describeTieBlocked, isTieBlockedFor } from '../lib/stageTree';
import { formatPoints } from '@semp/shared';
import { LiveDot, TeamAvatar } from '../features/schedule/ScheduleParts';

// Short column code for a team: initials of up to 3 words, else first 3 chars.
function shortCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 3).map((w) => w[0]?.toUpperCase()).join('');
  return name.slice(0, 3).toUpperCase();
}

// Key is a team_id or, on a chained draw with an unresolved inner pool, a slot label
// ("A1") - never dropped from the grid. `tieBlocked` swaps the name for a warning.
function resolveEntrant(
  key: string, teamName: (id: string | null) => string, teamOrg?: (id: string | null) => string,
  tieBlocked?: { pool: number; rank: number } | null, teamShort?: (id: string | null) => string | null,
) {
  const slot = describeSlot(key);
  if (slot) {
    const tieMsg = isTieBlockedFor(key, tieBlocked) ? describeTieBlocked(tieBlocked) : null;
    return { name: tieMsg ?? slot, org: '', code: key, warning: !!tieMsg, isSlot: true };
  }
  const name = teamName(key);
  const org = teamOrg?.(key) ?? '';
  // The squad's own abbreviation, else its organisation's (IIMC), so headers match the rows and tables.
  const code = teamShort?.(key) || (org && org.length <= 8 ? org : shortCode(name));
  return { name, org, code, warning: false, isSlot: false };
}

const CELL = 'h-12 w-[4.5rem] border-b border-l border-slate-100 p-1 text-center dark:border-slate-800';

/** "3:30 PM" today, "Tue" another day - enough for a cell that hasn't been played. */
function cellTime(iso?: string | null): string {
  if (!iso) return 'TBD';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'TBD';
  if (d.toDateString() === new Date().toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
  }
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

// Cell at (row team vs column team). The same match appears in both mirrored
// cells; the score is always shown from the row team's perspective.
function ResultCell({ fixture, teamId, opponentId, onSelect }:
  { fixture: BracketFixture | undefined; teamId: string; opponentId: string; onSelect?: (f: BracketFixture) => void }) {
  if (!fixture) return <td className={cn(CELL, 'text-xs text-slate-300 dark:text-slate-700')}>-</td>;
  const live = fixture.status === 'live';
  const walkover = fixture.status === 'walkover';
  const hasScore = fixture.home_score != null && fixture.away_score != null;
  const decided = fixture.winner_team_id != null || (hasScore && fixture.status === 'completed');

  // teamId may be a slot label rather than a team_id - safe to match on either,
  // since real ids are uuids and never collide with labels.
  const rowIsHome = fixture.home_team_id === teamId || fixture.home_slot_label === teamId;
  const rowScore = rowIsHome ? fixture.home_score : fixture.away_score;
  const oppScore = rowIsHome ? fixture.away_score : fixture.home_score;
  const result = !decided ? null : fixture.winner_team_id === teamId ? 'W' : fixture.winner_team_id === opponentId ? 'L' : 'D';
  // A walkover has no real score, so "0-0" would read as a played match.
  const score = walkover ? 'W/O' : hasScore ? `${formatPoints(rowScore)}-${formatPoints(oppScore)}` : '';

  let body;
  if (live) {
    body = (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-rose-50 px-1.5 py-1 text-[11px] font-black tabular-nums text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
        <LiveDot className="h-1.5 w-1.5" />{hasScore ? score : 'LIVE'}
      </span>
    );
  } else if (result) {
    const tone = { W: 'bg-emerald-500 text-white', L: 'bg-rose-500 text-white', D: 'bg-amber-400 text-amber-950' }[result];
    const soft = { W: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200', L: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200', D: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200' }[result];
    body = (
      <span className={cn('inline-flex items-center overflow-hidden whitespace-nowrap rounded-md text-[11px] font-bold tabular-nums', soft)}>
        <span className={cn('px-1 py-1 font-black', tone)}>{result}</span>
        {score && <span className="px-1.5 py-1">{score}</span>}
      </span>
    );
  } else {
    body = <span className="whitespace-nowrap text-[10px] font-semibold text-slate-400 dark:text-slate-500">{cellTime(fixture.scheduled_at)}</span>;
  }

  const clickable = !!onSelect;
  return (
    <td className={CELL}>
      <button
        type="button"
        disabled={!clickable}
        onClick={() => clickable && onSelect!(fixture)}
        title={`${fixture.round ?? 'Match'}${fixture.scheduled_at ? ' · ' + new Date(fixture.scheduled_at).toLocaleString() : ''}`}
        className={cn('grid h-full w-full place-items-center rounded-md', clickable && 'cursor-pointer transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50 dark:hover:bg-slate-800/60')}
      >
        {body}
      </button>
    </td>
  );
}

function Crosstable({ fixtures, teamName, teamOrg, teamShort, onSelect, caption }:
  { fixtures: BracketFixture[]; teamName: (id: string | null) => string; teamOrg?: (id: string | null) => string; teamShort?: (id: string | null) => string | null; onSelect?: (f: BracketFixture) => void; caption?: string }) {
  const { teamIds, lookup } = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const f of fixtures) {
      // Fall back to the slot label for an unresolved side, else it's dropped from the grid.
      for (const id of [f.home_team_id ?? f.home_slot_label, f.away_team_id ?? f.away_slot_label]) {
        if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
      }
    }
    ids.sort((a, b) => resolveEntrant(a, teamName, teamOrg).name.localeCompare(resolveEntrant(b, teamName, teamOrg).name));
    const lookup = new Map<string, BracketFixture>();
    for (const f of fixtures) {
      const home = f.home_team_id ?? f.home_slot_label;
      const away = f.away_team_id ?? f.away_slot_label;
      if (home && away) lookup.set(`${home}|${away}`, f);
    }
    return { teamIds: ids, lookup };
  }, [fixtures, teamName, teamOrg]);

  // Tie-blocked belongs to the producing pool, so any fixture referencing the label
  // carries the same flag - looked up once here rather than per-cell.
  const tieBlockedByLabel = useMemo(() => {
    const m = new Map<string, { pool: number; rank: number }>();
    for (const f of fixtures) {
      const tb = (f as any).live_state?.tie_blocked;
      if (!tb) continue;
      if (f.home_slot_label && isTieBlockedFor(f.home_slot_label, tb)) m.set(f.home_slot_label, tb);
      if (f.away_slot_label && isTieBlockedFor(f.away_slot_label, tb)) m.set(f.away_slot_label, tb);
    }
    return m;
  }, [fixtures]);

  // Each entrant's W-L(-D) record in this pool.
  const record = useMemo(() => {
    const r = new Map<string, { w: number; l: number; d: number }>();
    for (const f of fixtures) {
      const done = f.winner_team_id != null || (f.status === 'completed' && f.home_score != null);
      if (!done) continue;
      const home = f.home_team_id ?? f.home_slot_label; const away = f.away_team_id ?? f.away_slot_label;
      if (!home || !away) continue;
      for (const id of [home, away]) if (!r.has(id)) r.set(id, { w: 0, l: 0, d: 0 });
      if (!f.winner_team_id) { r.get(home)!.d++; r.get(away)!.d++; }
      else if (f.winner_team_id === home) { r.get(home)!.w++; r.get(away)!.l++; }
      else { r.get(away)!.w++; r.get(home)!.l++; }
    }
    return r;
  }, [fixtures]);

  if (teamIds.length === 0) return null;
  const real = fixtures.filter((f) => f.status !== 'bye');
  const played = real.filter((f) => ['completed', 'walkover'].includes(f.status ?? '')).length;
  const anyDraw = [...record.values()].some((x) => x.d > 0);

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <span className="text-sm font-black text-slate-800 dark:text-slate-100">{caption ?? 'League table'}</span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">{teamIds.length} teams · {played}/{real.length} played</span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50/80 dark:bg-slate-800/40">
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:bg-slate-800 dark:text-slate-500">Team</th>
              {teamIds.map((id) => {
                const e = resolveEntrant(id, teamName, teamOrg, tieBlockedByLabel.get(id), teamShort);
                return (
                  <th key={id} title={e.name} className="w-[4.5rem] border-l border-slate-100 px-1 py-2 dark:border-slate-800">
                    <div className="flex flex-col items-center gap-0.5">
                      {e.warning ? <span className="text-amber-500" aria-hidden>⚠</span> : <TeamAvatar name={e.isSlot ? null : e.name} short={e.isSlot ? null : e.code} size="sm" />}
                      <span className={cn('max-w-[4rem] truncate text-[10px] font-bold', e.warning ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400')}>{e.code}</span>
                    </div>
                  </th>
                );
              })}
              <th className="w-14 border-l border-slate-100 px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">{anyDraw ? 'W-L-D' : 'W-L'}</th>
            </tr>
          </thead>
          <tbody>
            {teamIds.map((rowId) => {
              const e = resolveEntrant(rowId, teamName, teamOrg, tieBlockedByLabel.get(rowId), teamShort);
              const rec = record.get(rowId);
              // The org line only when the squad name doesn't already carry it.
              const showOrg = !!e.org && !e.name.toLowerCase().includes(e.org.toLowerCase());
              return (
                <tr key={rowId} className="border-t border-slate-100 dark:border-slate-800">
                  <th className={cn('sticky left-0 z-10 bg-white px-3 py-1.5 text-left font-medium dark:bg-slate-900', e.warning ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200')}>
                    <div className="flex min-w-0 items-center gap-2">
                      {e.warning ? <span aria-hidden>⚠</span> : <TeamAvatar name={e.isSlot ? null : e.name} short={e.isSlot ? null : e.code} size="sm" />}
                      {/* Phone: the code only, so the result cells keep the width. */}
                      <span className="text-xs font-bold sm:hidden" title={e.name}>{e.code}</span>
                      <span className="hidden min-w-0 sm:block">
                        <span className={cn('block max-w-[14rem] truncate text-[13px] leading-tight', e.isSlot && 'pr-1 italic text-slate-400')} title={e.name}>{e.name}</span>
                        {showOrg && <span className="block truncate text-[10px] font-normal leading-tight text-slate-400 dark:text-slate-500">{e.org}</span>}
                      </span>
                    </div>
                  </th>
                  {teamIds.map((colId) =>
                    rowId === colId ? (
                      // Diagonal: a team never plays itself.
                      <td key={colId} className={cn(CELL, 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(148_163_184/0.12)_6px_7px)]')} />
                    ) : (
                      <ResultCell
                        key={colId}
                        // Mirrored cells share a match; single round-robin seeds only
                        // one direction, so accept either.
                        fixture={lookup.get(`${rowId}|${colId}`) ?? lookup.get(`${colId}|${rowId}`)}
                        teamId={rowId}
                        opponentId={colId}
                        onSelect={onSelect}
                      />
                    ),
                  )}
                  <td className="border-l border-slate-100 px-2 text-center text-xs font-black tabular-nums text-slate-700 dark:border-slate-800 dark:text-slate-200">
                    {rec ? `${rec.w}-${rec.l}${anyDraw ? `-${rec.d}` : ''}` : <span className="font-semibold text-slate-300 dark:text-slate-600">-</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Results crosstable for round-robin / league / group draws (row = home, column = away);
// group draws render one table per pool, side by side where there is room.
export function RoundRobinGrid({ fixtures, teamName, teamOrg, teamShort, onSelect }:
  { fixtures: BracketFixture[]; teamName: (id: string | null) => string; teamOrg?: (id: string | null) => string; teamShort?: (id: string | null) => string | null; onSelect?: (f: BracketFixture) => void }) {
  const pools = useMemo(() => {
    const byPool = new Map<number | null, BracketFixture[]>();
    for (const f of fixtures) {
      const key = (f as any).pool_number ?? null;
      const bucket = byPool.get(key) ?? byPool.set(key, []).get(key)!;
      bucket.push(f);
    }
    return [...byPool.entries()].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  }, [fixtures]);

  const multiPool = pools.length > 1 || (pools.length === 1 && pools[0][0] != null);
  const chip = (letter: string, cls: string, label: string) => (
    <span className="inline-flex items-center gap-1"><span className={cn('grid h-4 w-4 place-items-center rounded text-[9px] font-black', cls)}>{letter}</span>{label}</span>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span>Read each row left to right:</span>
        {chip('W', 'bg-emerald-500 text-white', 'won')}
        {chip('L', 'bg-rose-500 text-white', 'lost')}
        {chip('D', 'bg-amber-400 text-amber-950', 'drawn')}
        <span>· W/O = walkover</span>
      </div>
      <div className={cn('grid gap-4', multiPool && pools.length > 1 && 'xl:grid-cols-2')}>
        {pools.map(([pool, fx]) => (
          <Crosstable
            key={pool ?? 'league'}
            fixtures={fx}
            teamName={teamName}
            teamOrg={teamOrg}
            teamShort={teamShort}
            onSelect={onSelect}
            caption={multiPool ? `Pool ${pool != null ? String.fromCharCode(64 + pool) : '-'}` : undefined}
          />
        ))}
      </div>
    </div>
  );
}
