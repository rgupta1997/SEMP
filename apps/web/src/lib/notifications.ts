import type { NotificationAudience, NotificationType } from '@semp/shared';

// Shapes returned by GET /notifications (see notifications.routes.ts).
export interface NotificationReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  audience: NotificationAudience;
  title: string;
  body: string | null;
  created_at: string;
  championship: { id: string; name: string; slug: string } | null;
  sender: { id: string; name: string } | null;
  is_mine: boolean;
  unread: boolean;
  reactions: NotificationReactionSummary[];
}

export interface PostableEvent { id: string; name: string }

// Small visual hint per notification type for the feed.
export function notificationMeta(type: NotificationType): { icon: 'megaphone' | 'check-circle-2' | 'bell'; label: string } {
  switch (type) {
    case 'event_lifecycle': return { icon: 'megaphone', label: 'Championship update' };
    case 'enrollment_approved': return { icon: 'check-circle-2', label: 'Approval' };
    default: return { icon: 'bell', label: 'Announcement' };
  }
}
