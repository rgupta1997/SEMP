import { useEffect, useMemo, useState } from 'react';
import { Bell } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import type { NotificationDto, PostableEvent } from '../lib/notifications';
import { NotificationItem } from '../components/NotificationItem';
import { NotificationComposeModal } from '../components/NotificationComposeModal';
import { Button, EmptyState, PageHeader, Select, Spinner } from '../components/ui';

const FEED_KEY = '/notifications?take=100';
const UNREAD_KEY = '/notifications/unread-count';

// Full notification feed across every championship the user belongs to.
export function NotificationsPage() {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useApi<NotificationDto[]>(FEED_KEY);
  const { data: postable = [] } = useApi<PostableEvent[]>('/notifications/postable-championships');
  const [eventId, setEventId] = useState('');
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
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [items]);

  const visible = eventId ? items.filter((n) => n.championship?.id === eventId) : items;

  return (
    <div>
      <PageHeader title="Notifications" subtitle="Updates from every championship you're part of">
        {eventOptions.length > 1 && (
          <Select value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Filter by championship">
            <option value="">All championships</option>
            {eventOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        )}
        {postable.length > 0 && <Button onClick={() => setComposing(true)}>+ New notification</Button>}
      </PageHeader>

      {isLoading ? (
        <div className="grid place-items-center py-16"><Spinner /></div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Bell size={24} />}
          title="No notifications yet"
          description="Announcements and championship updates will show up here."
        />
      ) : (
        <div className="mx-auto max-w-2xl space-y-2.5">
          {visible.map((n) => <NotificationItem key={n.id} n={n} />)}
        </div>
      )}

      {composing && <NotificationComposeModal onClose={() => setComposing(false)} />}
    </div>
  );
}
