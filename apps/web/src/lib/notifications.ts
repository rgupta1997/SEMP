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

export type NotificationIcon = 'megaphone' | 'check-circle-2' | 'bell' | 'clipboard-check' | 'x-circle' | 'user-plus';

// Small visual hint per notification type for the feed.
//
// The icon has to distinguish news from work. Until the enrollment family was split,
// five different messages all arrived as a green tick labelled "Approval" - including
// the one telling an organiser they had something to review, which is the opposite of
// a completed action.
export function notificationMeta(type: NotificationType): { icon: NotificationIcon; label: string } {
  switch (type) {
    case 'event_lifecycle': return { icon: 'megaphone', label: 'Championship update' };
    // Needs a decision from the reader.
    case 'enrollment_requested': return { icon: 'clipboard-check', label: 'Needs review' };
    case 'entry_submitted': return { icon: 'clipboard-check', label: 'Needs review' };
    case 'org_join_request': return { icon: 'clipboard-check', label: 'Needs review' };
    // A decision about the reader.
    case 'enrollment_approved': return { icon: 'check-circle-2', label: 'Approved' };
    case 'org_join_approved': return { icon: 'check-circle-2', label: 'Approved' };
    case 'enrollment_rejected': return { icon: 'x-circle', label: 'Declined' };
    case 'org_join_declined': return { icon: 'x-circle', label: 'Declined' };
    // News about somebody else.
    case 'enrollment_joined': return { icon: 'user-plus', label: 'New entrant' };
    case 'org_invitation': return { icon: 'user-plus', label: 'Invitation' };
    default: return { icon: 'bell', label: 'Announcement' };
  }
}
