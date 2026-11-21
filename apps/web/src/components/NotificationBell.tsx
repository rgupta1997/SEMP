import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Bell, Plus, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useApi } from '../lib/hooks';
import { notificationHooks } from '../lib/notification';
import type {
  NotificationDto,
  PostableEvent,
} from '../lib/notifications';

import { AnnouncementFeed, dayLabel } from './AnnouncementFeed';
import { NotificationComposeModal } from './NotificationComposeModal';
import { EmptyState, cn } from './ui';

// Header bell + right-side drawer. Visible to every authenticated user; the feed
// aggregates notifications from every championship the user belongs to.
//
// Reads/mutations go through the shared `notificationHooks` (packages/notifications)
// instead of a local implementation, so this stays in sync with the rest of the app
// (Compose modal, Realtime provider) without duplicating query-key logic.
export function NotificationBell({ className, open: openProp, onOpenChange, hideTrigger = false }: {
  /** Trigger styling where the bell sits (the sidebar footer is darker than a header). */
  className?: string;
  /** Controlled from outside (the phone account sheet opens the drawer). */
  open?: boolean; onOpenChange?: (open: boolean) => void;
  /** Drawer only: something else opens it. */
  hideTrigger?: boolean;
} = {}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(open) : v;
    if (openProp === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [composing, setComposing] = useState(false);

  const { data: unreadCount } = notificationHooks.useUnreadCount();
  const unread = unreadCount ?? 0;

  // Only fetches while the drawer is open - mirrors the previous
  // `open ? DRAWER_FEED : null` lazy-fetch behavior.
  const {
    data: feedData,
    isLoading,
  } = notificationHooks.useNotificationFeed({
    take: 15,
    enabled: open,
  });

  // The shared client currently types getFeed's result as `unknown`;
  // cast at the boundary the same way the rest of the app already
  // relies on NotificationDto's shape.
  const items = (feedData as NotificationDto[] | undefined) ?? [];
  const newCount = items.filter((n) => n.unread).length;
  const todayCount = items.filter((n) => dayLabel(n.created_at) === 'Today').length;

  // postable-championships stays a local fetch - it's app-level
  // (compose-target listing), not a notifications-package concern,
  // matching the same choice already made in NotificationComposeModal.
  const {
    data: postable = [],
  } = useApi<PostableEvent[]>(
    '/notifications/postable-championships',
  );

  const canPost = postable.length > 0;

  const markAllRead = notificationHooks.useMarkAllNotificationsRead();
  const markSeen = notificationHooks.useMarkNotificationsSeen();

  // Drawer open clears both: per-item read state (markAllRead, for the
  // feed list) and the cursor watermark (markSeen, for the badge count).
  // Kept as two separate calls on purpose - see cursor.ts / hooks.ts notes.
  useEffect(() => {
    if (!open) return;

    markAllRead.mutate();
    markSeen.mutate();
    // Only re-run when the drawer opens/closes - not on every mutation identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      {!hideTrigger && <button
        onClick={() => setOpen((o) => !o)}
        className={cn('relative grid h-9 w-9 place-items-center rounded-lg', className ?? 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
          // Selected while the drawer is open: brand-coloured bell only. ! because cn() does not override the caller's colours.
          open && '!bg-transparent !text-brand-600 dark:!text-brand-300')}
        aria-expanded={open}
        aria-label={
          unread > 0
            ? `Notifications (${unread} unread)`
            : 'Notifications'
        }
        title="Notifications"
      >
        <Bell size={18} aria-hidden fill={open ? 'currentColor' : 'none'} />

        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>}

      {/* Portalled: the sidebar clips and transforms its children, which would trap a fixed drawer. */}
      {createPortal(<>
      {/* Scrim */}
      {open && (
        <div
          className="animate-backdrop fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Right drawer */}
      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-[min(92vw,380px)] flex-col border-l border-slate-200 bg-slate-50 shadow-xl transition-transform duration-200 dark:border-slate-800 dark:bg-slate-950',
          open
            ? 'translate-x-0'
            : 'translate-x-full',
        )}
        aria-hidden={!open}
      >
        {/* A soft brand tint carries the identity; no page banner in a drawer. */}
        <div className="relative border-b border-slate-200 bg-gradient-to-b from-brand-50/80 to-white dark:border-slate-800 dark:from-brand-500/10 dark:to-slate-900">
          <div className="flex items-start justify-between gap-2 px-4 pb-3 pt-4">
            <div className="min-w-0">
              <div className="text-lg font-black leading-tight text-slate-900 dark:text-slate-100">Notifications</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                {newCount > 0 && <><span className="inline-flex items-center gap-1 text-brand-700 dark:text-brand-300"><span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden />{newCount} new</span><span aria-hidden>·</span></>}
                <span>{todayCount} today</span><span aria-hidden>·</span><span>{items.length} in all</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {canPost && (
                <button type="button" onClick={() => setComposing(true)}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-3 py-1 text-[13px] font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dark:bg-brand-500">
                  <Plus size={14} aria-hidden />New
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-white hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                <X size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="space-y-2" aria-label="Loading">
              {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />)}
            </div>
          ) : items.length === 0 ? (
            <EmptyState compact icon={<Bell size={22} />} title="No notifications" description="You're all caught up." />
          ) : (
            <AnnouncementFeed rows={items} showEvent compact />
          )}
        </div>

        <div className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <Link to="/notifications" onClick={() => setOpen(false)}
            className="flex w-full items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white py-2 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:text-brand-300">
            View all notifications<ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      </aside>

      {composing && (
        <NotificationComposeModal
          onClose={() => setComposing(false)}
        />
      )}
      </>, document.body)}
    </>
  );
}