import type { NotificationAudience } from '@semp/shared';
import type { NotificationTypeKey } from '@semp/notifications/core/registry.js';

// Shapes returned by GET /notifications (see notifications.routes.ts).
export interface NotificationReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface NotificationDto {
  id: string;
  type: NotificationTypeKey;
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
export function notificationMeta(type: NotificationTypeKey): { icon: 'megaphone' | 'check-circle-2' | 'bell'; label: string } {
  switch (type) {
    case 'event_lifecycle': return { icon: 'megaphone', label: 'Championship update' };
    case 'enrollment_approved': return { icon: 'check-circle-2', label: 'Approval' };
    case 'registration_approved': return { icon: 'check-circle-2', label: 'Approval' };
    case 'match_official_assigned': return { icon: 'megaphone', label: 'Officiating' };
    case 'score_pending_validation': return { icon: 'bell', label: 'Needs review' };
    case 'team_eliminated': return { icon: 'bell', label: 'Result' };
    case 'player_of_the_match': return { icon: 'check-circle-2', label: 'Award' };
    case 'tournament_award': return { icon: 'check-circle-2', label: 'Award' };
    case 'certificate_validation_issue': return { icon: 'bell', label: 'Certificate' };
    case 'event_report_generated': return { icon: 'check-circle-2', label: 'Report' };
    case 'usage_limit_reached': return { icon: 'bell', label: 'Plan limit' };
    case 'standings_updated': return { icon: 'megaphone', label: 'Championship update' };
    default: return { icon: 'bell', label: 'Announcement' };
  }
}
