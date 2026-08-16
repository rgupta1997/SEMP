import { useEffect, useState, type ReactNode } from 'react';
import { Bell, CheckCircle2, ClipboardCheck, Megaphone, UserPlus, XCircle } from 'lucide-react';
import { NOTIFICATION_REACTIONS } from '@semp/shared';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/hooks';
import { notificationMeta, type NotificationDto, type NotificationReactionSummary } from '../lib/notifications';
import { cn } from './ui';

// Colour carries meaning here, so it is not decoration: something waiting on the
// reader must not look the same as something already settled.
const NOTIF_ICONS: Record<string, ReactNode> = {
  'megaphone': <Megaphone size={15} />,
  'check-circle-2': <CheckCircle2 size={15} className="text-emerald-500" />,
  'clipboard-check': <ClipboardCheck size={15} className="text-amber-500" />,
  'x-circle': <XCircle size={15} className="text-rose-500" />,
  'user-plus': <UserPlus size={15} />,
  'bell': <Bell size={15} />,
};

// One notification card - shared by the bell drawer and the full page. Owns its own
// reaction state so toggling is snappy without refetching the whole feed.
export function NotificationItem({ n, compact = false }: { n: NotificationDto; compact?: boolean }) {
  const [reactions, setReactions] = useState<NotificationReactionSummary[]>(n.reactions);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReactions(n.reactions); }, [n.reactions]);

  const meta = notificationMeta(n.type);
  const countFor = (emoji: string) => reactions.find((r) => r.emoji === emoji);

  const toggle = async (emoji: string) => {
    if (n.is_mine || busy) return; // authors cannot react to their own notification
    setBusy(true);
    try {
      const res = await api<{ reactions: NotificationReactionSummary[] }>(
        'POST', `/notifications/${n.id}/reactions`, { reaction: emoji },
      );
      setReactions(res.reactions);
    } catch {
      /* leave existing state; a toast is overkill for a reaction */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn(
      'rounded-xl border bg-white p-3 dark:bg-slate-900',
      n.unread ? 'border-brand-200 bg-brand-50/40 dark:border-brand-500/30 dark:bg-brand-500/5' : 'border-slate-200 dark:border-slate-800',
    )}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex-none text-slate-400 dark:text-slate-500" aria-hidden>{NOTIF_ICONS[meta.icon] ?? <Bell size={15} />}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className={cn('truncate text-sm font-semibold text-slate-900 dark:text-slate-100', !n.unread && 'font-medium')}>
                {n.title}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {n.championship && <span className="font-medium text-slate-600 dark:text-slate-300">{n.championship.name}</span>}
                {n.championship && <span aria-hidden>·</span>}
                <span>{n.sender?.name ?? 'System'}</span>
                <span aria-hidden>·</span>
                <span>{fmtDateTime(n.created_at)}</span>
                {n.audience === 'organizations_captains' && (
                  <span className="rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    Organizations + captains
                  </span>
                )}
              </div>
            </div>
            {n.unread && <span className="mt-1 h-2 w-2 flex-none rounded-full bg-brand-500" aria-label="Unread" />}
          </div>

          {n.body && (
            <p className={cn('mt-1.5 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300', compact && 'line-clamp-3')}>
              {n.body}
            </p>
          )}

          {/* Reaction bar - hidden for the author (they can't react to their own). */}
          {!n.is_mine && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {NOTIFICATION_REACTIONS.map((emoji) => {
                const r = countFor(emoji);
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => toggle(emoji)}
                    disabled={busy}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-60',
                      r?.mine
                        ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/15 dark:text-brand-300'
                        : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
                    )}
                    aria-pressed={!!r?.mine}
                  >
                    <span aria-hidden>{emoji}</span>
                    {r && r.count > 0 && <span className="tnum font-semibold">{r.count}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* For the author, show a read-only tally of any reactions received. */}
          {n.is_mine && reactions.some((r) => r.count > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {reactions.filter((r) => r.count > 0).map((r) => (
                <span key={r.emoji} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <span aria-hidden>{r.emoji}</span>
                  <span className="tnum font-semibold">{r.count}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
