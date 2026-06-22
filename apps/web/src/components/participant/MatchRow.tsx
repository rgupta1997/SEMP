import { useNavigate } from 'react-router-dom';
import { fmtDateTime } from '../../lib/hooks';
import { ResultBadge } from './ResultBadge';
import type { MatchSummary } from './types';

function scoreLine(m: MatchSummary): string | null {
  if (m.my_score == null || m.opp_score == null) return null;
  return `${m.my_score}–${m.opp_score}`;
}

// One match as a clickable card - stacks cleanly on mobile, row-like on desktop.
// `showEvent` adds the championship name (used on the cross-championship dashboard/list).
export function MatchRow({ match, showEvent = true }: { match: MatchSummary; showEvent?: boolean }) {
  const navigate = useNavigate();
  const score = scoreLine(match);
  const context = [showEvent ? match.championship?.name : null, match.sport, match.round]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      onClick={() => navigate(`/profile/matches/${match.id}`)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-brand-400"
    >
      <div className="min-w-0">
        {context && <div className="truncate text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{context}</div>}
        <div className="mt-0.5 truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
          vs {match.opponent?.name ?? 'TBD'}
          {match.opponent?.organization ? <span className="font-normal text-slate-400 dark:text-slate-500"> · {match.opponent.organization}</span> : null}
        </div>
        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{fmtDateTime(match.scheduled_at)}</div>
      </div>
      <div className="flex flex-none items-center gap-3">
        {score && <span className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-300">{score}</span>}
        <ResultBadge result={match.result} />
      </div>
    </button>
  );
}
