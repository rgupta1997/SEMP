import { Trophy } from 'lucide-react';
import { fmtDate } from '../../lib/hooks';
import type { AchievementGroup, AchievementInstance } from './types';

// A single occurrence line inside the hover tooltip: where the award was earned.
function instanceLine(it: AchievementInstance): string {
  return [
    it.championship,
    it.tournament,
    [it.sport, it.discipline].filter(Boolean).join(' ') || null,
    it.opponent_team_name ? `vs ${it.opponent_team_name}` : null,
  ].filter(Boolean).join(' · ');
}

// A recognition the participant has earned, collapsed by award name and shown
// count-first ("7 · Player of the Match"). Hovering reveals each occurrence's
// championship / tournament / match; the full breakdown also lives on the
// dedicated achievements page.
export function AchievementRow({ group }: { group: AchievementGroup }) {
  return (
    <div className="group relative flex cursor-help items-center gap-4 rounded-2xl border border-[var(--gold-chip)] bg-[var(--gold-banner)] px-5 py-4 dark:border-amber-500/30 dark:bg-amber-500/10">
      <span className="grid h-10 min-w-[2.5rem] flex-none place-items-center rounded-lg bg-[var(--gold-chip)] px-2 text-sm font-bold tabular-nums text-[var(--gold-ink)] dark:bg-amber-500/30 dark:text-amber-100">
        {group.count}
      </span>
      <Trophy size={20} className="flex-none text-[var(--gold-ink)] dark:text-amber-400" aria-hidden />
      <span className="truncate text-base font-bold text-[var(--gold-ink-strong)] dark:text-amber-100">{group.award_name}</span>
      {group.latest_date && <span className="ml-auto flex-none text-sm font-medium text-[var(--gold-ink)] dark:text-slate-500">{fmtDate(group.latest_date)}</span>}

      {/* Hover tooltip - per-occurrence meta (championship · tournament · match). */}
      <div
        role="tooltip"
        className="invisible absolute left-0 top-full z-20 mt-2 w-[min(30rem,90vw)] rounded-xl border border-slate-200 bg-white p-3 text-left opacity-0 shadow-xl transition-opacity duration-150 group-hover:visible group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800"
      >
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
