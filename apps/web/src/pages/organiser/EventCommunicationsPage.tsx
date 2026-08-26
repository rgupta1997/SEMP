import { useState } from 'react';
import { Megaphone } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import type { NotificationDto } from '../../lib/notifications';
import { NotificationComposeModal } from '../../components/NotificationComposeModal';
import { NotificationItem } from '../../components/NotificationItem';
import { Button, EmptyState, PageHeader, Spinner } from '../../components/ui';
import { useEvent } from './EventLayout';

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

export function EventCommunicationsPage() {
  const { eventId, canManage } = useEvent();
  const [composing, setComposing] = useState(false);
  const { data: rows = [], isLoading, refetch } = useApi<NotificationDto[]>(
    `/notifications?championship_id=${eventId}&take=100`,
  );

  return (
    <div className="pb-16">
      <PageHeader
        title="Communications"
        subtitle="Every announcement made about this event, newest first."
      >
        {canManage && (
          <Button onClick={() => setComposing(true)}>
            <Megaphone size={15} aria-hidden />Make an announcement
          </Button>
        )}
      </PageHeader>

      {isLoading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState
          icon={<Megaphone size={24} />}
          title="Nothing announced yet"
          description={canManage
            ? 'Announcements you make here reach the audience you choose — everyone, or just captains, officials or points of contact.'
            : 'Announcements from the organising team will appear here.'}
          action={canManage
            ? <Button onClick={() => setComposing(true)}>Make an announcement</Button>
            : undefined}
        />
      ) : (
        <div className="space-y-2">
          {rows.map((n) => <NotificationItem key={n.id} n={n} />)}
        </div>
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
