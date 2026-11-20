import { Fragment, useState } from 'react';
import { ChevronDown, Trophy } from 'lucide-react';
import { EmptyState, cn } from './ui';
import { StandingsBreakdown } from './StandingsBreakdown';
import { CARD, HEAD_ROW, Pts, ROW } from './GroupTables';
import { TeamAvatar } from '../features/schedule/ScheduleParts';

// Minimal shape shared by the organiser + participant standings rows.
export interface MedalStandingRow {
  /**
   * The CONTINGENT this row is for - a campus or department id in a championship
   * contested inside one organisation, an organisation id in an open one. This is
   * the row's identity: in an intra event every row shares one organization_id, so
   * keying a list or an expand-state on that collapses twelve campuses into one.
   */
  entity_id: string;
  /** What to print. Resolved server-side so no two surfaces can label it differently. */
  name: string;
  short_name: string | null;
  org_unit: { id: string; name: string; code: string | null; type: string; parent: string | null } | null;
  organization_id: string;
  organization: { id: string; name: string; short_name?: string | null; logo_url?: string | null } | null;
  detail: Record<string, number>;
  points: number;
}

// Collapse a standings row's `detail` into gold/silver/bronze counts. Knockout draws
// emit winner/runner_up/third_place; medal + ranking-event draws emit gold/silver/bronze.
// Both map to the same podium so a mixed-scheme championship has one medal tally.
export function medalCounts(detail: Record<string, number> | undefined) {
  const d = detail ?? {};
  return {
    gold: (d.gold ?? 0) + (d.winner ?? 0),
    silver: (d.silver ?? 0) + (d.runner_up ?? 0),
    bronze: (d.bronze ?? 0) + (d.third_place ?? 0),
  };
}

export interface RankedMedalRow { row: MedalStandingRow; gold: number; silver: number; bronze: number; total: number }

// Rank orgs by gold, then silver, then bronze, then championship points. By default keeps
// only those with at least one medal (used by the page header to name the medal leader);
// pass `includeAll` to keep every org - medal winners stay on top, the rest fall in by
// points - so the medal table can list the whole field. Exported so the header card and
// the table share one ordering.
export function rankMedals(rows: MedalStandingRow[], opts?: { includeAll?: boolean }): RankedMedalRow[] {
  return rows
    .map((row) => { const m = medalCounts(row.detail); return { row, ...m, total: m.gold + m.silver + m.bronze }; })
    .filter((r) => opts?.includeAll || r.total > 0)
    .sort((a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || b.row.points - a.row.points);
}

const MEDALS = ['gold', 'silver', 'bronze'] as const;
const Count = ({ n }: { n: number }) => (n ? <>{n}</> : <span className="text-slate-300 dark:text-slate-600">-</span>);

// Olympic-style medal tally: one row per organisation. Reads the same standings rows the
// points table uses (no extra fetch). Each row expands to its breakdown - which sports /
// disciplines earned the medals - via the shared StandingsBreakdown (needs base/scope).
// `expanded` / `onToggle` let a page drive which row is open; without them it keeps its own.
export function StandingsMedalTable({ rows, base, scope, scopeId, expanded: openId, onToggle }: {
  rows: MedalStandingRow[]; base: string; scope: string; scopeId: string | null;
  expanded?: string | null; onToggle?: (id: string) => void;
}) {
  const [own, setOwn] = useState<string | null>(null);
  const expanded = openId !== undefined ? openId : own;
  const toggle = onToggle ?? ((id: string) => setOwn((cur) => (cur === id ? null : id)));
  // Show every org (medal winners ranked first, then the rest by points), not just medallists.
  const ranked = rankMedals(rows, { includeAll: true });

  if (ranked.length === 0) {
    return <EmptyState icon={<Trophy size={24} />} title="No standings yet" description="The medal tally fills in as ranking events and finals are decided." />;
  }

  const breakdown = (id: string) => <StandingsBreakdown base={base} scope={scope} scopeId={scopeId} entityId={id} showConverted />;

  return (
    <div className={cn(CARD, 'rounded-2xl')}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3">
        <span className="text-sm font-black text-slate-800 dark:text-slate-100">Medal tally</span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">Ranked by gold, then silver, then bronze · tap a row for the events</span>
      </div>

      {/* Phone: medal counts as coloured pips, so the counts never scroll off. */}
      <div className="sm:hidden">
        {ranked.map((r, i) => {
          const open = expanded === r.row.entity_id;
          return (
            <div key={r.row.entity_id} data-row={r.row.entity_id}
              className={cn('border-t border-slate-100 dark:border-slate-800', !open && i === 0 && r.total > 0 && 'bg-amber-50/40 dark:bg-amber-500/5')}>
              <button type="button" aria-expanded={open} onClick={() => toggle(r.row.entity_id)}
                className={cn('flex w-full items-center gap-2.5 px-3 py-2.5 text-left', open && 'bg-slate-50 dark:bg-slate-800/40')}>
                <span className="w-6 shrink-0 text-center text-[13px] font-bold tabular-nums text-slate-400 dark:text-slate-500">{i + 1}</span>
                <TeamAvatar name={r.row.name} short={r.row.short_name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-slate-800 dark:text-slate-100">{r.row.name || r.row.short_name}</span>
                  <span className="mt-0.5 flex items-center gap-2.5 text-[11px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                    {MEDALS.map((m) => (
                      <span key={m} className="inline-flex items-center gap-1"><span className={`medal-pip medal-pip--${m}`} />{r[m] || 0}</span>
                    ))}
                    <span className="text-slate-600 dark:text-slate-300">{r.total} total</span>
                  </span>
                </span>
                <Pts v={r.row.points} />
                <ChevronDown size={15} className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
              </button>
              {open && <div className="px-3 pb-3">{breakdown(r.row.entity_id)}</div>}
            </div>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className={HEAD_ROW}>
              <th className="w-14 px-4 py-2 text-left">#</th>
              <th className="px-2 py-2 text-left">Team</th>
              {MEDALS.map((m) => (
                <th key={m} className="w-14 px-2 py-2 text-center" title={m[0].toUpperCase() + m.slice(1)}>
                  <span className={`medal-pip medal-pip--${m} inline-block !h-3 !w-3 align-middle`} aria-label={m} />
                </th>
              ))}
              <th className="w-16 px-2 py-2 text-center">Total</th>
              <th className="w-16 px-2 py-2 text-center">Pts</th>
              <th className="w-10 px-3 py-2" aria-label="Expand" />
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => {
              const open = expanded === r.row.entity_id;
              return (
                <Fragment key={r.row.entity_id}>
                  <tr data-row={r.row.entity_id} onClick={() => toggle(r.row.entity_id)} title="Show which sports & disciplines earned these medals"
                    className={cn(ROW, 'cursor-pointer', open ? 'bg-slate-50 dark:bg-slate-800/40' : i === 0 && r.total > 0 && 'bg-amber-50/40 dark:bg-amber-500/5')}>
                    <td className="px-4 py-2.5 font-bold tabular-nums text-slate-400 dark:text-slate-500">{i + 1}</td>
                    <td className="px-2 py-2.5">
                      <span className="flex min-w-0 items-center gap-3">
                        <TeamAvatar name={r.row.name} short={r.row.short_name} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-slate-800 dark:text-slate-100">{r.row.name}</span>
                          {r.row.org_unit?.parent && <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{r.row.org_unit.parent}</span>}
                        </span>
                      </span>
                    </td>
                    {MEDALS.map((m) => <td key={m} className="px-2 py-2.5 text-center font-semibold tabular-nums text-slate-700 dark:text-slate-200"><Count n={r[m]} /></td>)}
                    <td className="px-2 py-2.5 text-center font-black tabular-nums text-slate-800 dark:text-slate-100">{r.total}</td>
                    <td className="px-2 py-2.5 text-center"><Pts v={r.row.points} /></td>
                    <td className="px-3 py-2.5"><ChevronDown size={16} className={cn('text-slate-400 transition-transform', open && 'rotate-180')} /></td>
                  </tr>
                  {open && (
                    <tr className="bg-slate-50/60 dark:bg-slate-800/20">
                      <td colSpan={8} className="px-4 pb-4 pt-0">{breakdown(r.row.entity_id)}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
