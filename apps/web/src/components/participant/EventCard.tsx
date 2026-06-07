import { useNavigate } from 'react-router-dom';
import { Card, StatusBadge } from '../ui';
import { fmtDateRange } from '../../lib/hooks';
import type { EventCardData } from './types';

// Clickable summary card for one event the participant played in.
export function EventCard({ event }: { event: EventCardData }) {
  const navigate = useNavigate();
  return (
    <Card
      onClick={() => navigate(`/me/events/${event.id}`)}
      className="cursor-pointer p-5 transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-400"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold text-slate-900 dark:text-slate-100">{event.name}</h3>
        <StatusBadge status={event.status} />
      </div>
      <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {event.venue ? `${event.venue} · ` : ''}{fmtDateRange(event.start_date, event.end_date)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
        <span><span className="font-semibold text-slate-800 dark:text-slate-200">{event.sports.length}</span> {event.sports.length === 1 ? 'sport' : 'sports'}</span>
        <span><span className="font-semibold text-slate-800 dark:text-slate-200">{event.match_count}</span> {event.match_count === 1 ? 'match' : 'matches'}</span>
        <span><span className="font-semibold text-emerald-600">{event.win_count}</span> won</span>
      </div>
      {event.sports.length > 0 && (
        <div className="mt-2 truncate text-xs text-slate-400 dark:text-slate-500">{event.sports.join(' · ')}</div>
      )}
    </Card>
  );
}
