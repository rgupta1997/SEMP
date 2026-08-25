import { useMemo } from 'react';
import { cn } from './ui';
import type { BracketFixture } from './Bracket';
import { describeSlot, describeTieBlocked, isTieBlockedFor } from '../lib/stageTree';

// Short column code for a team: initials of up to 3 words, else first 3 chars.
function shortCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 3).map((w) => w[0]?.toUpperCase()).join('');
  return name.slice(0, 3).toUpperCase();
}

// A crosstable participant key is either a real team_id, or - on a chained
// group→group→knockout draw whose inner pool hasn't resolved yet - the raw slot
// label ("A1") standing in for it. Resolves either into a display name/org and a
// compact column code, without ever dropping the unresolved side from the grid.
// `tieBlocked` (looked up by the caller from any fixture referencing this same
// label) overrides the name with a warning once the producing pool is stuck tied.
function resolveEntrant(
  key: string, teamName: (id: string | null) => string, teamOrg?: (id: string | null) => string,
  tieBlocked?: { pool: number; rank: number } | null,
) {
  const slot = describeSlot(key);
  if (slot) {
    const tieMsg = isTieBlockedFor(key, tieBlocked) ? describeTieBlocked(tieBlocked) : null;
    return { name: tieMsg ?? slot, org: '', code: key, warning: !!tieMsg };
  }
  const name = teamName(key);
  return { name, org: teamOrg?.(key) ?? '', code: shortCode(name), warning: false };
}

// Cell at (row team vs column team). The same match appears in both mirrored
// cells; the score is always shown from the row team's perspective.
function ResultCell({ fixture, teamId, opponentId, onSelect }:
  { fixture: BracketFixture | undefined; teamId: string; opponentId: string; onSelect?: (f: BracketFixture) => void }) {
  if (!fixture) {
    return <td className="h-11 w-14 border border-slate-100 text-center text-xs text-slate-300 dark:border-slate-800 dark:text-slate-700">-</td>;
  }
  const decided = fixture.winner_team_id != null || (fixture.home_score != null && fixture.away_score != null);
  const live = fixture.status === 'live';
  const hasScore = fixture.home_score != null && fixture.away_score != null;

  // Orient scores to the row team, regardless of which side it played on. teamId
  // may be a slot label (unresolved side) rather than a real team_id - matching on
  // either is safe since the two id spaces never collide (real ids are uuids).
  const rowIsHome = fixture.home_team_id === teamId || fixture.home_slot_label === teamId;
  const rowScore = rowIsHome ? fixture.home_score : fixture.away_score;
  const oppScore = rowIsHome ? fixture.away_score : fixture.home_score;

  let tone = 'text-slate-500 dark:text-slate-400';
  if (decided) {
    if (fixture.winner_team_id === teamId) tone = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300';
    else if (fixture.winner_team_id === opponentId) tone = 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300';
    else tone = 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'; // draw
  }

  const label = hasScore ? `${rowScore}–${oppScore}` : live ? 'live' : '·';
  const clickable = !!onSelect;

  return (
    <td className={cn('h-11 w-14 border border-slate-100 p-0 text-center dark:border-slate-800', tone)}>
      <button
        type="button"
        disabled={!clickable}
        onClick={() => clickable && onSelect!(fixture)}
        title={`Schedule${fixture.scheduled_at ? ' · ' + new Date(fixture.scheduled_at).toLocaleString() : ''}`}
        className={cn('h-full w-full text-xs font-semibold tabular-nums', clickable && 'cursor-pointer transition-colors hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-400/50')}
      >
        {live && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-rose-500 align-middle" />}
        {label}
      </button>
    </td>
  );
}

function Crosstable({ fixtures, teamName, teamOrg, onSelect, caption }:
  { fixtures: BracketFixture[]; teamName: (id: string | null) => string; teamOrg?: (id: string | null) => string; onSelect?: (f: BracketFixture) => void; caption?: string }) {
  const { teamIds, lookup } = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const f of fixtures) {
      // Fall back to the slot label when a side isn't resolved to a real team yet
      // (a chained group→group→knockout draw whose inner pool is still pending) -
      // otherwise that side would be silently dropped from the grid entirely.
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

  // A slot label's tie-blocked state is a property of the pool that produces it, not
  // of any one downstream fixture - so any fixture in this set that references the
  // label carries the same flag. Looked up once here rather than per-cell.
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

  if (teamIds.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      {caption && <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{caption}</div>}
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-[10rem] border border-slate-100 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
              Home ╲ Away
            </th>
            {teamIds.map((id) => {
              const entrant = resolveEntrant(id, teamName, teamOrg, tieBlockedByLabel.get(id));
              return (
                <th key={id} title={entrant.name} className={cn('h-11 w-14 border border-slate-100 bg-slate-50 px-1 text-center text-[10px] font-bold uppercase dark:border-slate-800 dark:bg-slate-800/60', entrant.warning ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400')}>
                  {entrant.warning && '⚠'}{entrant.code}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {teamIds.map((rowId) => {
            const entrant = resolveEntrant(rowId, teamName, teamOrg, tieBlockedByLabel.get(rowId));
            return (
            <tr key={rowId}>
              <th className={cn('sticky left-0 z-10 min-w-[10rem] border border-slate-100 bg-white px-3 py-2 text-left font-medium dark:border-slate-800 dark:bg-slate-900', entrant.warning ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200')}>
                <span className="block truncate leading-tight" title={entrant.name}>{entrant.warning && '⚠ '}{entrant.name}</span>
                {entrant.org && <span className="block truncate text-[11px] font-normal leading-tight text-slate-400 dark:text-slate-500">{entrant.org}</span>}
              </th>
              {teamIds.map((colId) =>
                rowId === colId ? (
                  <td key={colId} className="h-11 w-14 border border-slate-100 bg-slate-100/70 dark:border-slate-800 dark:bg-slate-800/40" />
                ) : (
                  <ResultCell
                    key={colId}
                    // The same match lives in both mirrored cells, so accept it
                    // played in either direction (single round-robin only seeds
                    // one of the two).
                    fixture={lookup.get(`${rowId}|${colId}`) ?? lookup.get(`${colId}|${rowId}`)}
                    teamId={rowId}
                    opponentId={colId}
                    onSelect={onSelect}
                  />
                ),
              )}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Graphical view for round-robin / league / group draws: a results crosstable
// (each cell = the match between the row's home team and the column's away
// team, coloured by result). Group/pool draws render one table per pool.
export function RoundRobinGrid({ fixtures, teamName, teamOrg, onSelect }:
  { fixtures: BracketFixture[]; teamName: (id: string | null) => string; teamOrg?: (id: string | null) => string; onSelect?: (f: BracketFixture) => void }) {
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

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-400 dark:text-slate-500">Each cell shows the home team's result vs the away team. Green = win, red = loss, amber = draw.</p>
      {pools.map(([pool, fx]) => (
        <Crosstable
          key={pool ?? 'league'}
          fixtures={fx}
          teamName={teamName}
          teamOrg={teamOrg}
          onSelect={onSelect}
          caption={multiPool ? `Pool ${pool != null ? String.fromCharCode(64 + pool) : '-'}` : undefined}
        />
      ))}
    </div>
  );
}
