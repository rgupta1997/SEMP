import { useMemo } from 'react';
import { Bell, Megaphone, Sparkles, Trophy, Users } from 'lucide-react';
import type { NotificationAudience } from '@semp/shared';
import { fmtDate } from '../lib/hooks';
import type { NotificationDto } from '../lib/notifications';
import { ReactionBar } from './NotificationItem';
import { cn } from './ui';

/** Who an announcement reached, as a reader would say it. */
const AUDIENCE_LABEL: Record<NotificationAudience, string> = {
  all: 'Everyone',
  organizations_captains: 'Organisations + captains',
  org_admins: 'Organisation admins',
};
const DAY_MS = 86_400_000;

/** Sent by a person (an organiser), or by the app itself (results, lifecycle). */
export const isAuto = (n: NotificationDto) => !n.sender;

/** "Today", "Yesterday", or the date: the timeline's day headings. */
export function dayLabel(iso: string): string {
  const d = new Date(iso); const start = new Date(); start.setHours(0, 0, 0, 0);
  const diff = start.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return diff <= 0 ? 'Today' : diff <= DAY_MS ? 'Yesterday' : fmtDate(iso);
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

function AnnouncementCard({ n, showEvent, compact }: { n: NotificationDto; showEvent: boolean; compact: boolean }) {
  const auto = isAuto(n);
  return (
    <article className={cn('relative rounded-2xl border bg-white transition dark:bg-slate-900', compact ? 'p-3' : 'p-4',
      n.unread ? 'border-brand-200 shadow-sm dark:border-brand-500/40' : 'border-slate-200 dark:border-slate-800')}>
      <div className="flex items-start gap-3">
        <span className={cn('grid shrink-0 place-items-center rounded-xl', compact ? 'h-8 w-8 [&_svg]:h-[15px] [&_svg]:w-[15px]' : 'h-10 w-10',
          auto ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' : 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300')} aria-hidden>
          {auto ? <Sparkles size={18} /> : <Megaphone size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className={cn('min-w-0 font-black text-slate-900 dark:text-slate-100', compact ? 'text-sm' : 'text-[15px]')}>{n.title}</h3>
            {n.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-label="Unread" />}
          </div>
          {/* The event gets its own line, so the sender line never wraps with a stray "·" up front. */}
          {showEvent && n.championship && (
            <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs font-semibold text-brand-700 dark:text-brand-300">
              <Trophy size={11} className="shrink-0" aria-hidden /><span className="truncate" title={n.championship.name}>{n.championship.name}</span>
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-600 dark:text-slate-300">{n.sender?.name ?? 'Sportagon'}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{timeOf(n.created_at)}</span>
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold',
              auto ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' : 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200')}>
              {auto ? <Bell size={10} aria-hidden /> : <Users size={10} aria-hidden />}
              {auto ? 'Automatic' : AUDIENCE_LABEL[n.audience] ?? 'Everyone'}
            </span>
          </div>
          {n.body && <p className={cn('mt-2 whitespace-pre-wrap leading-relaxed text-slate-600 dark:text-slate-300', compact ? 'line-clamp-3 text-[13px]' : 'text-sm')}>{n.body}</p>}
          <ReactionBar n={n} className={compact ? 'mt-2' : 'mt-3'} />
        </div>
      </div>
    </article>
  );
}

/**
 * Announcements as a timeline, newest first: a heading per day, then that day's
 * cards along a rail. Shared by an event's Communications and the Notifications page.
 */
export function AnnouncementFeed({ rows, showEvent = false, compact = false }: {
  rows: NotificationDto[]; showEvent?: boolean;
  /** The bell drawer: smaller cards, long messages clipped. */
  compact?: boolean;
}) {
  const days = useMemo(() => {
    const out: Array<{ label: string; items: NotificationDto[] }> = [];
    for (const n of rows) {
      const label = dayLabel(n.created_at);
      if (out[out.length - 1]?.label === label) out[out.length - 1].items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [rows]);
  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      {days.map((d) => (
        <section key={d.label}>
          <h2 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
            <span>{d.label}</span><span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          </h2>
          <ol className={cn('border-l-2 border-slate-100 dark:border-slate-800', compact ? 'ml-1 space-y-2 pl-3.5' : 'space-y-3 pl-4 sm:ml-1.5 sm:pl-5')}>
            {d.items.map((n) => (
              <li key={n.id} className="relative">
                <span aria-hidden className={cn('absolute h-2.5 w-2.5 rounded-full ring-4 ring-slate-50 dark:ring-slate-950', compact ? '-left-[1.2rem] top-5' : '-left-[1.3rem] top-6 sm:-left-[1.6rem]',
                  isAuto(n) ? 'bg-slate-300 dark:bg-slate-600' : 'bg-brand-500')} />
                <AnnouncementCard n={n} showEvent={showEvent} compact={compact} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
