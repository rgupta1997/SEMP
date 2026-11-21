// Emoji reactions under a notification, shared by the feed cards (AnnouncementFeed).
import { useEffect, useState } from 'react';
import { NOTIFICATION_REACTIONS } from '@semp/shared';
import { api } from '../lib/api';
import type { NotificationDto, NotificationReactionSummary } from '../lib/notifications';
import { cn } from './ui';

/**
 * The emoji reactions under a notification. Owns its own state so toggling is snappy
 * without refetching the feed. Authors can't react to their own; they see a tally.
 */
export function ReactionBar({ n, className }: { n: NotificationDto; className?: string }) {
  const [reactions, setReactions] = useState<NotificationReactionSummary[]>(n.reactions);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReactions(n.reactions); }, [n.reactions]);
  const countFor = (emoji: string) => reactions.find((r) => r.emoji === emoji);

  const toggle = async (emoji: string) => {
    if (n.is_mine || busy) return;
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

  if (n.is_mine) {
    if (!reactions.some((r) => r.count > 0)) return null;
    return (
      <div className={cn('mt-2 flex flex-wrap items-center gap-1', className)}>
        {reactions.filter((r) => r.count > 0).map((r) => (
          <span key={r.emoji} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <span aria-hidden>{r.emoji}</span>
            <span className="tnum font-semibold">{r.count}</span>
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className={cn('mt-2 flex flex-wrap items-center gap-1', className)}>
      {NOTIFICATION_REACTIONS.map((emoji) => {
        const r = countFor(emoji);
        return (
          <button key={emoji} type="button" onClick={() => toggle(emoji)} disabled={busy} aria-pressed={!!r?.mine}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-60',
              r?.mine
                ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/15 dark:text-brand-300'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
            )}>
            <span aria-hidden>{emoji}</span>
            {r && r.count > 0 && <span className="tnum font-semibold">{r.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
