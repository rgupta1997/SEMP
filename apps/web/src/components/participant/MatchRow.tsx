import { useNavigate } from 'react-router-dom';
import { fmtDateTime } from '../../lib/hooks';
import { cn } from '../ui';
import { ResultBadge } from './ResultBadge';
import type { MatchSummary } from './types';

// One match as a clickable card - stacks cleanly on mobile, row-like on desktop.
// `showEvent` adds the championship name (used on the cross-championship dashboard/list).
export function MatchRow({ match, showEvent = true }: { match: MatchSummary; showEvent?: boolean }) {
  const navigate = useNavigate();
  const hasScore = match.my_score != null && match.opp_score != null;
  const context = [showEvent ? match.championship?.name : null, match.sport, match.round]
    .filter(Boolean)
    .join(' · ');
  const myName = match.my_team?.name ?? 'Your team';
  const oppName = match.opponent?.name ?? 'TBD';
  const won = match.result === 'won';
  const lost = match.result === 'lost';

  // Show both teams (your team first), each with its own score, so the result reads
  // unambiguously without opening the match.
  const teamLine = (name: string, score: number | null, mine: boolean, winner: boolean) => (
    <div className="flex items-center justify-between gap-3">
      <span className={cn('min-w-0 truncate text-sm', winner ? 'font-bold text-slate-900 dark:text-slate-100' : mine ? 'font-semibold text-slate-700 dark:text-slate-300' : 'text-slate-600 dark:text-slate-400')}>{name}</span>
      {hasScore && <span className={cn('flex-none tabular-nums text-sm', winner ? 'font-bold text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400')}>{score}</span>}
    </div>
  );

  return (
    <button
      onClick={() => navigate(`/profile/matches/${match.id}`)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-brand-400"
    >
      <div className="min-w-0 flex-1">
        {context && <div className="truncate text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{context}</div>}
        <div className="mt-1 space-y-0.5">
          {teamLine(myName, match.my_score, true, hasScore && won)}
          {teamLine(oppName, match.opp_score, false, hasScore && lost)}
        </div>
        {match.opponent?.organization && <div className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">{match.opponent.organization}</div>}
        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{fmtDateTime(match.scheduled_at)}</div>
      </div>
      <div className="flex flex-none items-center">
        <ResultBadge result={match.result} />
      </div>
    </button>
  );
}
