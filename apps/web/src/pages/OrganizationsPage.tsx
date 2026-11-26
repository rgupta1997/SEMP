import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, Hourglass, Landmark, MapPin, Plus, Search, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth, type Organization, type OrgMembership } from '../lib/auth';
import { useWorkspace } from '../lib/useWorkspace';
import { api } from '../lib/api';
import { useApiMutation } from '../lib/hooks';
import { notificationHooks } from '../lib/notification';
import { titleCase } from '../lib/format';
import { usePageTitle } from '../lib/pageTitle';
import { InstitutionFormModal } from '../components/InstitutionFormModal';
import { JoinOrgModal } from '../components/JoinOrgModal';
import { EmptyState, cn, toast } from '../components/ui';
import { HEX_CLIP, PERSONAL_NAVY, PILL_GHOST, PILL_TEAL } from '../features/personal/styles';

const ADMIN_ROLES = ['owner', 'admin'];

export function OrganizationsPage() {
  usePageTitle('Organizations');
  const { ctx, refresh } = useAuth();
  const [creating, setCreating] = useState(false);
  const [finding, setFinding] = useState(false);

  const memberships = ctx?.organizations ?? [];
  const pending = memberships.filter((m) => m.status === 'pending');

  // A REQUEST ANSWERED ELSEWHERE shows here without a reload. The list comes from the
  // login context, read once; the answer arrives as a notification. So while a request
  // is pending, a rise in the unread count (live push, or the 2-minute poll) or coming
  // back to the tab re-reads it - "Pending" turns into "Member", or goes on a reject.
  const { data: unread } = notificationHooks.useUnreadCount();
  const lastUnread = useRef<number | undefined>(undefined);
  useEffect(() => {
    const before = lastUnread.current;
    lastUnread.current = unread;
    // Any new notification, not only while a request is pending: a declined request
    // can be reconsidered later, and that admission must show up here too.
    if (before !== undefined && unread !== undefined && unread > before) void refresh().catch(() => {});
  }, [unread]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pending.length) return;
    const onFocus = () => { void refresh().catch(() => {}); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [pending.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = memberships.filter((m) => m.status !== 'past' && m.status !== 'pending' && m.status !== 'rejected');
  const past = memberships.filter((m) => m.status === 'past');

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">The organizations &amp; groups you play for. Each fields teams per sport.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setFinding(true)} className={PILL_GHOST}><Search size={14} aria-hidden />Join organization</button>
          <button type="button" onClick={() => setCreating(true)} className={PILL_TEAL}><Plus size={14} aria-hidden />Create organization</button>
        </div>
      </div>

      {memberships.length === 0 ? (
        <EmptyState
          icon={<Landmark size={22} />}
          title="You're not in any organizations yet"
          description="Create your own to enter teams and register for championships, or find one and request to join."
          action={(
            <>
              <button type="button" onClick={() => setFinding(true)} className="bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700"><Search size={14} aria-hidden />Join organization</button>
              <button type="button" onClick={() => setCreating(true)} className="!bg-[var(--accent)] !text-slate-950"><Plus size={14} aria-hidden />Create organization</button>
            </>
          )}
        />
      ) : (
        <>
          {pending.length > 0 && <PendingSection memberships={pending} />}
          <Section title="Current" memberships={current} />
          {past.length > 0 && <Section title="Past" memberships={past} past />}
        </>
      )}

      {creating && (
        <InstitutionFormModal
          accent="teal"
          onClose={() => setCreating(false)}
          onSubmit={async (body) => {
            const org = await api('POST', '/organizations', body);
            await refresh();
            toast.success('Organization created', 'You are now its owner.');
            return org;
          }}
        />
      )}

      {finding && <JoinOrgModal onClose={() => setFinding(false)} />}
    </div>
  );
}

/** A section heading with its count, like the other personal pages. */
function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
      {title}<span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">{count}</span>
    </h2>
  );
}

/** The club's crest: its logo, or its code in the Sportagon hexagon. */
function Crest({ org, muted = false }: { org?: Organization | null; muted?: boolean }) {
  const code = (org?.short_name ?? org?.name ?? '?').slice(0, 3).toUpperCase();
  if (org?.logo_url) return <img src={org.logo_url} alt="" className="h-12 w-12 rounded-xl bg-white object-contain p-1" />;
  return (
    <span aria-hidden className={cn('grid h-[52px] w-[46px] place-items-center p-[2px]', muted ? 'bg-white/30' : 'bg-gradient-to-b from-[var(--accent)] to-[var(--accent-deep)]')} style={{ clipPath: HEX_CLIP }}>
      <span className={cn('grid h-full w-full place-items-center text-[13px] font-black tracking-tight text-white', muted ? 'bg-slate-600' : 'bg-gradient-to-br from-[#2453b8] to-[#1a3d8f]')} style={{ clipPath: HEX_CLIP }}>{code}</span>
    </span>
  );
}

/** A club card: a stub with the crest, the club, and a foot for what you can do there. */
function ClubCard({ m, stub, chips, foot, muted = false }: { m: OrgMembership; stub?: string; chips: ReactNode; foot: ReactNode; muted?: boolean }) {
  return (
    <article className={cn('flex overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition dark:border-slate-800 dark:bg-slate-900',
      muted ? 'opacity-80' : 'hover:-translate-y-0.5 hover:shadow-md')}>
      <div className={cn('relative flex w-20 shrink-0 items-center justify-center px-2 py-4 sm:w-24', stub ?? PERSONAL_NAVY)}>
        <Crest org={m.organization} muted={muted} />
        <span aria-hidden className="absolute inset-y-3 right-0 border-r-2 border-dashed border-white/20" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 space-y-1.5 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 text-base font-black leading-snug text-slate-900 dark:text-slate-100">{m.organization?.name}</h3>
            <div className="flex shrink-0 flex-wrap justify-end gap-1.5">{chips}</div>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden />{m.organization?.city || 'City not set'}</span>
            {m.joined_at && (
              <span className="inline-flex items-center gap-1"><CalendarDays size={13} aria-hidden />
                {m.status === 'pending' ? 'Asked' : 'Member since'} {new Date(m.joined_at).toLocaleDateString(undefined, { day: m.status === 'pending' ? 'numeric' : undefined, month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>
        </div>
        <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 dark:border-slate-800">{foot}</div>
      </div>
    </article>
  );
}

const CHIP = 'rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider';
const CHIP_AMBER = 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200';
const CHIP_SLATE = 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
/** Owners and admins in teal (they run it), everyone else neutral. */
const roleChip = (role: string) => cn(CHIP, ADMIN_ROLES.includes(role) ? 'bg-[var(--accent)] text-slate-950' : CHIP_SLATE);
const LINK = 'inline-flex items-center gap-1 text-[13px] font-bold text-[var(--accent-deep)] transition hover:gap-1.5 dark:text-[var(--accent)]';

// Pending join requests awaiting an owner/admin's approval. The user can withdraw.
function PendingSection({ memberships }: { memberships: OrgMembership[] }) {
  const { refresh } = useAuth();
  const withdraw = useApiMutation((orgId: string) => api('DELETE', `/organizations/${orgId}/join`), ['/auth/me']);
  return (
    <section>
      <SectionTitle title="Requested · awaiting approval" count={memberships.length} />
      <div className="grid gap-4 lg:grid-cols-2">
        {memberships.map((m) => (
          <ClubCard key={m.id} m={m} stub="bg-amber-500"
            chips={<span className={cn(CHIP, CHIP_AMBER)}>Pending</span>}
            foot={(
              <>
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"><Hourglass size={13} aria-hidden />An owner or admin will review it</span>
                <button type="button" disabled={withdraw.isPending}
                  onClick={() => withdraw.mutate(m.organization_id, { onSuccess: () => { refresh(); toast.success('Request withdrawn'); }, onError: (e: any) => toast.error(e.message) })}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-50 disabled:opacity-60 dark:text-rose-300 dark:ring-rose-500/30 dark:hover:bg-rose-500/10">
                  <X size={12} aria-hidden />Withdraw
                </button>
              </>
            )} />
        ))}
      </div>
    </section>
  );
}

function Section({ title, memberships, past = false }: { title: string; memberships: OrgMembership[]; past?: boolean }) {
  const ws = useWorkspace();
  const { pathname } = useLocation();

  // Opening an organisation SWITCHES CONTEXT rather than just following a link (F-054),
  // so the sidebar and the page agree on where you are.
  const open = (orgId: string) => ws.enter(orgId, `/organizations/${orgId}/overview`, pathname);

  if (memberships.length === 0) return null;
  return (
    <section>
      <SectionTitle title={title} count={memberships.length} />
      <div className="grid gap-4 lg:grid-cols-2">
        {memberships.map((m) => {
          const canManage = ADMIN_ROLES.includes(m.role);
          // Only owners and admins still see an archived organisation - it is theirs to retrieve.
          const archived = !!m.organization?.archived_at;
          return (
            <ClubCard key={m.id} m={m} muted={past || archived} stub={past ? 'bg-slate-500' : undefined}
              chips={(
                <>
                  {archived && <span title="Hidden from everyone else until you retrieve it" className={cn(CHIP, CHIP_AMBER)}>Archived</span>}
                  {past ? <span className={cn(CHIP, CHIP_SLATE)}>Past member</span> : <span className={roleChip(m.role)}>{titleCase(m.role)}</span>}
                </>
              )}
              foot={past ? (
                // A past member has no access to the workspace - their own record here is what is left.
                <>
                  <span className="text-xs text-slate-400">No longer a member</span>
                  <Link to={`/profile/matches?org=${m.organization_id}`} className={LINK}>Your matches here<ArrowRight size={14} aria-hidden /></Link>
                </>
              ) : (
                <>
                  <span className="text-xs text-slate-400">{canManage ? 'You run this workspace' : 'Teams and members'}</span>
                  <button type="button" onClick={() => open(m.organization_id)} className={LINK}>{canManage ? 'Manage' : 'View'}<ArrowRight size={14} aria-hidden /></button>
                </>
              )} />
          );
        })}
      </div>
    </section>
  );
}
