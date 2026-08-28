import { Fragment, useState } from 'react';
import { ChevronDown, Trophy } from 'lucide-react';
import { Avatar, Badge, EmptyState, Table, cn } from './ui';
import { StandingsBreakdown } from './StandingsBreakdown';

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

// Olympic-style medal tally: one row per organisation. Reads the same standings rows the
// points table uses (no extra fetch). Each row expands to its breakdown - which sports /
// disciplines earned the medals - via the shared StandingsBreakdown (needs base/scope).
export function StandingsMedalTable({ rows, base, scope, scopeId }:
  { rows: MedalStandingRow[]; base: string; scope: string; scopeId: string | null }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  // Show every org (medal winners ranked first, then the rest by points), not just medallists.
  const ranked = rankMedals(rows, { includeAll: true });

  if (ranked.length === 0) {
    return <EmptyState icon={<Trophy size={24} />} title="No standings yet" description="The medal tally fills in as ranking events and finals are decided." />;
  }

  return (
    <Table>
      <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <tr>
          <th className="px-4 py-3">#</th>
          <th className="px-4 py-3">Organization</th>
          <th className="px-3 py-3 text-center" title="Gold">🥇</th>
          <th className="px-3 py-3 text-center" title="Silver">🥈</th>
          <th className="px-3 py-3 text-center" title="Bronze">🥉</th>
          <th className="px-3 py-3 text-center">Total</th>
          <th className="px-4 py-3 text-center">Pts</th>
        </tr>
      </thead>
      <tbody>
        {ranked.map((r, i) => {
          const isOpen = expanded === r.row.entity_id;
          return (
            <Fragment key={r.row.entity_id}>
              <tr
                onClick={() => setExpanded(isOpen ? null : r.row.entity_id)}
                className={cn('cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40',
                  isOpen ? 'bg-slate-50 dark:bg-slate-800/40' : i === 0 && r.total > 0 && 'bg-amber-50/40 dark:bg-amber-500/5')}
                title="Show which sports & disciplines earned these medals"
              >
                <td className="px-4 py-3 font-bold tabular-nums text-slate-400 dark:text-slate-500">{i + 1}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <ChevronDown size={16} className={cn('shrink-0 text-slate-400 transition-transform dark:text-slate-500', isOpen && 'rotate-180')} />
                    <Avatar name={r.row.name} size={30} />
                    <span className="min-w-0">
                      <span className="block font-medium text-slate-800 dark:text-slate-200">{r.row.name}</span>
                      {r.row.org_unit?.parent && (
                        <span className="block text-[11.5px] text-slate-500 dark:text-slate-400">{r.row.org_unit.parent}</span>
                      )}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-3 text-center font-semibold tabular-nums text-slate-700 dark:text-slate-200">{r.gold || <span className="text-slate-300 dark:text-slate-600">-</span>}</td>
                <td className="px-3 py-3 text-center font-semibold tabular-nums text-slate-700 dark:text-slate-200">{r.silver || <span className="text-slate-300 dark:text-slate-600">-</span>}</td>
                <td className="px-3 py-3 text-center font-semibold tabular-nums text-slate-700 dark:text-slate-200">{r.bronze || <span className="text-slate-300 dark:text-slate-600">-</span>}</td>
                <td className="px-3 py-3 text-center font-bold tabular-nums text-slate-800 dark:text-slate-100">{r.total}</td>
                <td className="px-4 py-3 text-center"><Badge tone="brand">{r.row.points}</Badge></td>
              </tr>
              {isOpen && (
                <tr className="bg-slate-50/60 dark:bg-slate-800/20">
                  <td colSpan={7} className="px-4 pb-4 pt-0">
                    <StandingsBreakdown base={base} scope={scope} scopeId={scopeId} entityId={r.row.entity_id} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </Table>
  );
}
