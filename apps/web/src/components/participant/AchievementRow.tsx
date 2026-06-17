import { fmtDate } from '../../lib/hooks';
import type { Achievement } from './types';

// One award the participant has received, shown on their dashboard. Not clickable —
// it's a recognition, with the match/championship it came from as context.
export function AchievementRow({ achievement }: { achievement: Achievement }) {
  const context = [achievement.championship?.name, achievement.sport, achievement.opponent_team_name ? `vs ${achievement.opponent_team_name}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3">
      <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-amber-100 dark:bg-amber-500/20 text-lg" aria-hidden>🏆</span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{achievement.award_name}</div>
        {context && <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{context}</div>}
      </div>
      {achievement.date && <span className="ml-auto flex-none text-xs text-slate-400 dark:text-slate-500">{fmtDate(achievement.date)}</span>}
    </div>
  );
}
