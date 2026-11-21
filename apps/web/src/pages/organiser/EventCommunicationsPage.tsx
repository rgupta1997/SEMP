import { useMemo, useState } from 'react';
import { Megaphone, Sparkles } from 'lucide-react';
import { ARCHIVED_READ_ONLY_MESSAGE } from '@semp/shared';
import { useApi } from '../../lib/hooks';
import type { NotificationDto } from '../../lib/notifications';
import { NotificationComposeModal } from '../../components/NotificationComposeModal';
import { AnnouncementFeed, dayLabel, isAuto } from '../../components/AnnouncementFeed';
import { EmptyState, cn } from '../../components/ui';
import { useUrlState } from '../../components/primitives';
import { SportsDecor, ViewTabs } from '../../features/schedule/ScheduleParts';
import { useEvent } from './EventLayout';
import { LockMark, useEventPlan } from '../../lib/eventPlan';

// Communications for one event.
//
// Everything said about this championship, in the order it was said, plus the way
// to say something new. It reads the same feed the audience reads rather than a
// sender-side log, and that is the point: an organiser should see their
// announcement exactly as it landed, not a copy of what they typed.
//
// There is no draft, no schedule and no edit. An announcement that has been
// delivered has been read by somebody, and a product that lets you rewrite it
// afterwards is a product where nobody can quote what they were told.

type Source = 'all' | 'team' | 'auto';

export function EventCommunicationsPage() {
  const { championship, eventId, organises } = useEvent();
  const [composing, setComposing] = useState(false);
  const [sourceRaw, setSource] = useUrlState<string>('from', 'all');
  const source: Source = sourceRaw === 'team' || sourceRaw === 'auto' ? sourceRaw : 'all';
  // Refused by the server too; disabled here so nobody writes an announcement first.
  const archived = !!championship.archived_at;
  // Announcements are a plan capability; the history below stays readable either way.
  const commsOk = useEventPlan(eventId).has('event_communications');
  const { data: rows = [], isLoading, refetch } = useApi<NotificationDto[]>(
    `/notifications?championship_id=${eventId}&take=100`,
  );

  const fromTeam = rows.filter((n) => !isAuto(n)).length;
  const shown = useMemo(() => rows.filter((n) => source === 'all' || (source === 'auto') === isAuto(n)), [rows, source]);
  const announceTitle = archived ? ARCHIVED_READ_ONLY_MESSAGE : !commsOk ? 'Event communications are not on this event’s plan' : undefined;
  const announce = (onBlue: boolean) => (
    <button type="button" disabled={archived || !commsOk} title={announceTitle} onClick={() => setComposing(true)}
      className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-bold shadow-sm transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60',
        onBlue ? 'bg-white text-brand-700 shadow-lg hover:bg-brand-50 focus-visible:ring-white/70' : 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-400 dark:bg-brand-500')}>
      {!commsOk ? <LockMark capability="event_communications" /> : <Megaphone size={15} aria-hidden />}
      Make an announcement
    </button>
  );

  return (
    <div className="space-y-5 pb-16">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-4 text-white shadow-sm sm:p-5">
        <SportsDecor />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">Communications</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-black tabular-nums">{isLoading ? '…' : rows.length}</span>
              <span className="text-sm font-semibold text-white/80">{rows.length === 1 ? 'announcement' : 'announcements'}</span>
            </div>
            <p className="mt-0.5 text-sm text-white/75">
              {rows.length
                ? <>Last one {dayLabel(rows[0].created_at).toLowerCase() === 'today' ? 'today' : dayLabel(rows[0].created_at).toLowerCase() === 'yesterday' ? 'yesterday' : `on ${dayLabel(rows[0].created_at)}`} · {fromTeam} from the organising team, {rows.length - fromTeam} automatic</>
                : 'Everything said about this event shows here, newest first.'}
            </p>
          </div>
          {organises && announce(true)}
        </div>
      </section>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ViewTabs size="sm" value={source} onChange={(v) => setSource(v)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'team', label: 'From organisers', icon: Megaphone },
              { value: 'auto', label: 'Automatic', icon: Sparkles },
            ]} />
          <span className="text-xs font-semibold text-slate-400">{shown.length} shown</span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3" aria-label="Loading">
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Megaphone size={24} />}
          title="Nothing announced yet"
          description={organises
            ? 'Announcements you make here reach the audience you choose - everyone, or just captains, officials or points of contact.'
            : 'Announcements from the organising team will appear here.'}
          action={organises ? announce(false) : undefined}
        />
      ) : shown.length === 0 ? (
        <EmptyState icon={source === 'auto' ? <Sparkles size={22} /> : <Megaphone size={22} />}
          title={source === 'auto' ? 'No automatic updates yet' : 'Nothing from the organisers yet'}
          description={source === 'auto' ? 'Results and status changes post here on their own.' : 'Announcements the organising team makes show up here.'} />
      ) : (
        <AnnouncementFeed rows={shown} />
      )}

      {composing && (
        <NotificationComposeModal
          defaultEventId={eventId}
          onClose={() => { setComposing(false); refetch(); }}
        />
      )}
    </div>
  );
}
