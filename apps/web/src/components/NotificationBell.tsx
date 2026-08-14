import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import type {
  NotificationDto,
  PostableEvent,
} from '../lib/notifications';

import { NotificationItem } from './NotificationItem';
import { NotificationComposeModal } from './NotificationComposeModal';
import {
  Button,
  EmptyState,
  Spinner,
  cn,
} from './ui';

const UNREAD_KEY = '/notifications/unread-count';
const DRAWER_FEED = '/notifications?take=15';

// Header bell + right-side drawer. Visible to every authenticated user; the feed
// aggregates notifications from every championship the user belongs to.
export function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: [UNREAD_KEY],
    queryFn: () => api('GET', UNREAD_KEY),
  });

  const unread = countData?.count ?? 0;

  const {
    data: items = [],
    isLoading,
  } = useApi<NotificationDto[]>(
    open ? DRAWER_FEED : null,
  );

  const {
    data: postable = [],
  } = useApi<PostableEvent[]>(
    '/notifications/postable-championships',
  );

  const canPost = postable.length > 0;

  // Clear the unread badge when the drawer opens (server records the read receipts).
  useEffect(() => {
    if (!open) return;

    api('POST', '/notifications/read-all')
      .then(() => {
        qc.invalidateQueries({
          queryKey: [UNREAD_KEY],
        });
      })
      .catch(() => {});
  }, [open, qc]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        aria-label={
          unread > 0
            ? `Notifications (${unread} unread)`
            : 'Notifications'
        }
        title="Notifications"
      >
        <Bell size={18} aria-hidden />

        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* Scrim */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50"
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
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
            Notifications
          </div>

          <div className="flex items-center gap-1.5">
            {canPost && (
              <Button
                size="sm"
                onClick={() => setComposing(true)}
              >
                + New
              </Button>
            )}

            <button
              onClick={() => setOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {isLoading ? (
            <div className="grid place-items-center py-10">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Bell size={24} />}
              title="No notifications"
              description="You're all caught up."
            />
          ) : (
            items.map((n) => (
              <NotificationItem
                key={n.id}
                n={n}
                compact
              />
            ))
          )}
        </div>

        <div className="border-t border-slate-200 bg-white px-4 py-2.5 text-center dark:border-slate-800 dark:bg-slate-900">
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
          >
            View all notifications
          </Link>
        </div>
      </aside>

      {composing && (
        <NotificationComposeModal
          onClose={() => setComposing(false)}
        />
      )}
    </>
  );
}