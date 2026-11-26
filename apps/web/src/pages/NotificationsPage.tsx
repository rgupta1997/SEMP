import { useEffect, useMemo, useState } from 'react';
import { Bell, Megaphone, Plus, Sparkles, Trophy } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import type { NotificationDto, PostableEvent } from '../lib/notifications';
import { NotificationComposeModal } from '../components/NotificationComposeModal';
import { AnnouncementFeed, isAuto } from '../components/AnnouncementFeed';
import { PickList } from '../components/PickList';
import { EmptyState, PILL_PICK, cn } from '../components/ui';
import { useUrlState } from '../components/primitives';
import { SportsDecor, ViewTabs } from '../features/schedule/ScheduleParts';

const FEED_KEY = '/notifications?take=100';
const UNREAD_KEY = '/notifications/unread-count';
type Show = 'all' | 'unread' | 'team' | 'auto';

// Full notification feed across every championship the user belongs to. Same hero,
// filters and timeline as an event's Communications, with the event named on each card.
export function NotificationsPage() {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useApi<NotificationDto[]>(FEED_KEY);
  const { data: postable = [] } = useApi<PostableEvent[]>('/notifications/postable-championships');
  const [eventId, setEventId] = useUrlState<string>('event', '');
  const [showRaw, setShow] = useUrlState<string>('show', 'all');
  const show: Show = (['unread', 'team', 'auto'] as const).includes(showRaw as never) ? showRaw as Show : 'all';
  const [composing, setComposing] = useState(false);

  // Mark everything read on view (clears the bell badge); we keep the unread
  // highlight visible for this visit by not refetching the feed.
  useEffect(() => {
    api('POST', '/notifications/read-all')
      .then(() => qc.invalidateQueries({ queryKey: [UNREAD_KEY] }))
      .catch(() => {});
  }, [qc]);

  const eventOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of items) if (n.championship) map.set(n.championship.id, n.championship.name);
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const unread = items.filter((n) => n.unread).length;
  const inEvent = eventId ? items.filter((n) => n.championship?.id === eventId) : items;
  const visible = inEvent.filter((n) => show === 'all' || (show === 'unread' ? n.unread : (show === 'auto') === isAuto(n)));
  const filtered = !!eventId || show !== 'all';

  return (
    <div className="space-y-5 pb-16">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-4 text-white shadow-sm sm:p-5">
        <SportsDecor />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">Notifications</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-black tabular-nums">{isLoading ? '…' : items.length}</span>
              <span className="text-sm font-semibold text-white/80">{items.length === 1 ? 'update' : 'updates'}</span>
              {unread > 0 && (
                <span className="ml-1 inline-flex items-center gap-1.5 self-center rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-bold ring-1 ring-white/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-300" aria-hidden />{unread} new
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-white/75">
              {eventOptions.length
                ? `From ${eventOptions.length} ${eventOptions.length === 1 ? 'championship' : 'championships'} you're part of`
                : 'Updates from every championship you\'re part of'}
            </p>
          </div>
          {postable.length > 0 && (
            <button type="button" onClick={() => setComposing(true)}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-4 py-1.5 text-[13px] font-bold text-brand-700 shadow-lg transition hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
              <Plus size={15} aria-hidden />New notification
            </button>
          )}
        </div>
      </section>

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <ViewTabs size="sm" value={show} onChange={(v) => setShow(v)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'unread', label: 'New', icon: Bell, badge: unread ? <span className={cn('rounded-full px-1.5 text-[11px] font-bold', show === 'unread' ? 'bg-white/20' : 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200')}>{unread}</span> : undefined },
              { value: 'team', label: 'From organisers', icon: Megaphone },
              { value: 'auto', label: 'Automatic', icon: Sparkles },
            ]} />
          {eventOptions.length > 1 && (
            <PickList value={eventId} onChange={setEventId} ariaLabel="Filter by championship" searchPlaceholder="Find a championship"
              options={[{ value: '', label: 'All championships' }, ...eventOptions.map((o) => ({ value: o.id, label: o.name, icon: <Trophy size={14} className="text-slate-400" /> }))]}
              className={cn(PILL_PICK, 'w-full sm:ml-auto sm:w-64')} />
          )}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3" aria-label="Loading">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Bell size={24} />} title="No notifications yet"
          description="Announcements and championship updates will show up here." />
      ) : visible.length === 0 ? (
        <EmptyState icon={<Bell size={24} />} title="Nothing here"
          description={show === 'unread' ? 'You are all caught up.' : 'Nothing matches these filters.'}
          action={filtered ? <button type="button" className="border border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" onClick={() => { setShow('all'); setEventId(''); }}>Show everything</button> : undefined} />
      ) : (
        <AnnouncementFeed rows={visible} showEvent={!eventId} />
      )}

      {composing && <NotificationComposeModal onClose={() => setComposing(false)} />}
    </div>
  );
}
