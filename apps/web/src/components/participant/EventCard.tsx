import { useNavigate } from 'react-router-dom';
import { Card, StatusBadge } from '../ui';
import { fmtDateRange } from '../../lib/hooks';
import type { EventCardData } from './types';

// Clickable summary card for one championship the participant played in.
export function EventCard({ championship }: { championship: EventCardData }) {
  const navigate = useNavigate();
  return (
    <Card
      onClick={() => navigate(`/profile/championships/${championship.id}`)}
      className="cursor-pointer p-6 transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-400"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold text-slate-900 dark:text-slate-100">{championship.name}</h3>
        <StatusBadge status={championship.status} />
      </div>
      <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {championship.venue ? `${championship.venue} · ` : ''}{fmtDateRange(championship.start_date, championship.end_date)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
        <span><span className="font-semibold text-slate-800 dark:text-slate-200">{championship.sports.length}</span> {championship.sports.length === 1 ? 'sport' : 'sports'}</span>
        <span><span className="font-semibold text-slate-800 dark:text-slate-200">{championship.match_count}</span> {championship.match_count === 1 ? 'match' : 'matches'}</span>
        <span><span className="font-semibold text-emerald-600">{championship.win_count}</span> won</span>
      </div>
      {championship.sports.length > 0 && (
        <div className="mt-2 truncate text-xs text-slate-400 dark:text-slate-500">{championship.sports.join(' · ')}</div>
      )}
    </Card>
  );
}
