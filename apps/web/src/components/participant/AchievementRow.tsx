import { Trophy } from 'lucide-react';
import { fmtDate } from '../../lib/hooks';
import type { AchievementGroup, AchievementInstance } from './types';

// A single occurrence line: where the award was earned.
function instanceLine(it: AchievementInstance): string {
  return [
    it.championship,
    it.tournament,
    [it.sport, it.discipline].filter(Boolean).join(' ') || null,
    it.opponent_team_name ? `vs ${it.opponent_team_name}` : null,
    it.team ? `with ${it.team}` : null,
  // An event whose tournament shares its name would otherwise read "X · X".
  ].filter((p, i, all) => p && all.indexOf(p) === i).join(' · ');
}

// An honour, collapsed by award name: a medal disc with how many times, the award, and
// where it was last won. Hovering lists every occurrence.
export function AchievementRow({ group }: { group: AchievementGroup }) {
  const latest = group.instances[0];
  return (
    <div className="group relative flex cursor-help items-center gap-3 rounded-xl border border-amber-200/80 bg-gradient-to-r from-amber-50 to-white px-3 py-2.5 transition hover:border-amber-300 dark:border-amber-500/25 dark:from-amber-500/10 dark:to-slate-900">
      <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 shadow-md shadow-amber-500/30 ring-2 ring-white dark:ring-slate-900" aria-hidden>
        <Trophy size={18} />
        {group.count > 1 && (
          <span className="absolute -right-1.5 -top-1 rounded-full bg-[#0a1630] px-1.5 py-px text-[10px] font-black tabular-nums text-white">×{group.count}</span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black text-slate-900 dark:text-amber-50">{group.award_name}</span>
        <span className="block truncate text-xs text-slate-500 dark:text-amber-100/60">{(latest && instanceLine(latest)) || `${group.count} time${group.count === 1 ? '' : 's'}`}</span>
      </span>
      {group.latest_date && <span className="shrink-0 text-[11px] font-semibold text-amber-700 dark:text-amber-300">{fmtDate(group.latest_date)}</span>}

      {/* Hover: every occurrence (championship · tournament · match). */}
      <div role="tooltip"
        className="invisible absolute left-0 top-full z-20 mt-2 w-[min(30rem,90vw)] rounded-xl border border-slate-200 bg-white p-3 text-left opacity-0 shadow-xl transition-opacity duration-150 group-hover:visible group-hover:opacity-100 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {group.award_name} · {group.count} {group.count === 1 ? 'time' : 'times'}
        </div>
        <ul className="space-y-1">
          {group.instances.map((it) => (
            <li key={it.id} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-slate-600 dark:text-slate-300">{instanceLine(it) || '-'}</span>
              {it.date && <span className="flex-none text-slate-400 dark:text-slate-500">{fmtDate(it.date)}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
