import { Check, MailOpen, MapPin, X } from 'lucide-react';
import { api } from '../lib/api';
import { useApi, useApiMutation, fmtDateRange } from '../lib/hooks';
import { cn, toast } from './ui';

interface Invite {
  id: string;
  org_name: string;
  organization_id: string;
  championship_id: string;
  championship_name: string;
  championship_status: string;
  start_date: string;
  end_date: string;
  venue: string | null;
}

/** The event's start as a small navy date stub: "NOV" over "17". */
function DateStub({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <span className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-[#0a1630] py-1.5 text-center text-white">
      <span className="text-[9px] font-black uppercase tracking-[0.16em] text-[var(--accent)]">{d.toLocaleDateString(undefined, { month: 'short' })}</span>
      <span className="text-lg font-black leading-none tabular-nums">{d.getDate()}</span>
    </span>
  );
}

// Shown to an owner/admin of an organization that's been invited to a championship.
// Accepting auto-approves that org for the championship. Pass `organizationId` to scope
// the inbox to a single org (e.g. on that org's manage view); omit it for all your invitations.
export function InvitationsInbox({ organizationId, className = '' }: { organizationId?: string; className?: string } = {}) {
  const { data: allInvites = [] } = useApi<Invite[]>('/me/invitations');
  const invites = organizationId ? allInvites.filter((i) => i.organization_id === organizationId) : allInvites;

  const accept = useApiMutation(
    (id: string) => api('POST', `/invitations/${id}/accept`),
    // Accepting auto-approves the org, so enrollments, the bell (it fires 'enrollment_approved')
    // and the org's own Events page all read stale data without a refresh.
    ['/me/invitations', '/championships/mine', '/me/enrollments', 'notifications', '/organizations'],
  );
  const decline = useApiMutation((id: string) => api('POST', `/invitations/${id}/decline`), ['/me/invitations', '/organizations']);

  if (invites.length === 0) return null;

  return (
    <section className={cn('overflow-hidden rounded-2xl border border-[var(--accent-deep)]/30 bg-white shadow-sm dark:bg-slate-900', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-[var(--accent)]/10 px-4 py-3 dark:border-slate-800">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-slate-950"><MailOpen size={16} aria-hidden /></span>
          <span className="min-w-0">
            <span className="block text-sm font-black text-slate-900 dark:text-slate-100">You're invited</span>
            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">Accept to enter your organisation's teams</span>
          </span>
        </span>
        <span className="rounded-full bg-[var(--accent-deep)] px-2.5 py-0.5 text-xs font-black tabular-nums text-white">{invites.length}</span>
      </div>
      {invites.map((inv) => (
        <div key={inv.id} className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-3 first-of-type:border-t-0 dark:border-slate-800">
          <DateStub iso={inv.start_date} />
          <div className="min-w-0 flex-[1_1_220px]">
            <div className="truncate text-sm font-black text-slate-900 dark:text-slate-100">{inv.championship_name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">as {inv.org_name}</span>
              <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden />{inv.venue || 'Venue to be confirmed'}</span>
              <span>{fmtDateRange(inv.start_date, inv.end_date)}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" disabled={decline.isPending}
              onClick={() => decline.mutate(inv.id, { onSuccess: () => toast.success('Invitation declined'), onError: (e: any) => toast.error(e.message) })}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:text-rose-600 hover:ring-rose-200 disabled:opacity-60 dark:text-slate-300 dark:ring-slate-700">
              <X size={14} aria-hidden />Decline
            </button>
            <button type="button" disabled={accept.isPending}
              onClick={() => accept.mutate(inv.id, { onSuccess: () => toast.success('Joined the championship', 'You can enter teams now.'), onError: (e: any) => toast.error(e.message) })}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-4 py-1.5 text-[13px] font-black text-slate-950 shadow-lg shadow-[var(--accent)]/20 transition hover:brightness-105 disabled:opacity-60">
              <Check size={14} aria-hidden />Accept
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
