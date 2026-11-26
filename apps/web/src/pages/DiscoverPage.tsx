import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Compass, Lock, MapPin } from 'lucide-react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useWorkspace } from '../lib/useWorkspace';
import { citiesLabel, citiesShort, hostCitiesFor, ORG_ARCHIVED_READ_ONLY_MESSAGE } from '@semp/shared';
import { api } from '../lib/api';
import { useApi, useTableControls, fmtDateRange } from '../lib/hooks';
import { usePageTitle } from '../lib/pageTitle';
import { eventStatusLook } from '../lib/eventStatus';
import { Button, EmptyState, Field, Input, Modal, PillPagination, SearchInput, cn, toast } from '../components/ui';
import { PickList } from '../components/PickList';
import { ViewTabs } from '../features/schedule/ScheduleParts';
import { SportFilterButton, SportFilterPanel, useSportIcon, useSportOptions } from '../features/personal/SportFilter';
import { PosterSkeleton } from '../features/personal/EventSkeletons';
import { PERSONAL_NAVY, PILL_BRAND, PILL_TEAL } from '../features/personal/styles';

interface Championship {
  id: string; name: string; slug: string; status: string;
  venue?: string | null; host_cities?: string[] | null; start_date: string; end_date: string;
  sports?: string[];
  visibility?: string; // private ones appear only for people already involved
}

/** One of the user's organisation memberships, as the auth context carries it. */
interface OrgMembership {
  organization_id: string;
  status: string;
  role: string;
  organization?: { name?: string; short_name?: string; archived_at?: string | null } | null;
}

/** Status tabs, in the order someone browsing cares about. */
const STATUS_ORDER = ['registration_open', 'ongoing', 'completed', 'draft'];

/** An application's state, as a chip. */
const APPLIED_CHIP: Record<string, string> = {
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
  rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200',
};

/**
 * Who may enter an organisation into an event: an active owner or admin.
 * The same test the enroll guard makes on the server; an org role GRANT (Sports Admin) does not count.
 */
const canEnter = (m: OrgMembership) => m.status === 'active' && (m.role === 'owner' || m.role === 'admin');

const orgLabel = (m?: OrgMembership) => m?.organization?.short_name ?? m?.organization?.name ?? 'your organisation';

const DAY = 864e5;
const dayOf = (iso: string) => { const d = new Date(iso); d.setHours(0, 0, 0, 0); return d.getTime(); };

/**
 * A note on the event's dates that agrees with its status: "Starts in 3 days", "Ends tomorrow".
 * The organiser sets the status, so dates that ran out under a live event are flagged, not called "Ended".
 */
function timing(c: Championship): { text: string; warn?: boolean } | null {
  if (c.status === 'completed') return null; // the status already says it
  const today = dayOf(new Date().toISOString());
  const start = dayOf(c.start_date); const end = dayOf(c.end_date);
  const days = (n: number, word: string) => (n === 0 ? `${word} today` : n === 1 ? `${word} tomorrow` : `${word} in ${n} days`);
  if (today < start) return { text: days(Math.round((start - today) / DAY), 'Starts') };
  if (today <= end) return { text: days(Math.round((end - today) / DAY), 'Ends') };
  return { text: 'Past end date', warn: true };
}

/**
 * Everything that goes stale the moment an application exists: every /me/enrollments
 * variant, and the bell. These calls skip useApiMutation, so nothing invalidates them for us.
 */
async function refreshAfterEnroll(qc: QueryClient) {
  await qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/me/enrollments') });
  await qc.invalidateQueries({ queryKey: ['notifications'] });
}

// Apply FROM MY SPACE: pick which of your organisations to apply as, or create one.
// Only personal space shows this; an organisation workspace has already answered it.
function ApplyModal({ championship, onClose }: { championship: Championship; onClose: () => void }) {
  const { ctx, refresh } = useAuth();
  const qc = useQueryClient();
  const myOrgs = useMemo(
    // An archived organisation can't apply, so it isn't offered.
    () => ((ctx?.organizations ?? []) as OrgMembership[]).filter((m) => canEnter(m) && !m.organization?.archived_at),
    [ctx],
  );
  const [mode, setMode] = useState<'pick' | 'create'>(myOrgs.length ? 'pick' : 'create');
  const [orgId, setOrgId] = useState(myOrgs[0]?.organization_id ?? '');
  const [newName, setNewName] = useState('');
  const [newCity, setNewCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      let applyOrgId = orgId;
      if (mode === 'create') {
        if (!newName.trim()) { setError('Organization name is required'); setBusy(false); return; }
        const org: any = await api('POST', '/organizations', { name: newName.trim(), city: newCity || undefined });
        applyOrgId = org.id;
        await refresh(); // pick the new org up in context (so the user can manage it)
      }
      if (!applyOrgId) { setError('Pick an organization to apply as'); setBusy(false); return; }
      await api('POST', `/championships/${championship.id}/enroll`, { organization_id: applyOrgId });
      await refreshAfterEnroll(qc);
      toast.success('Application submitted', 'You can enter teams once the organiser approves you.');
      onClose();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Participate in ${championship.name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Apply as one of your organizations, or create a new one to compete under.</p>
      {myOrgs.length > 0 && (
        <div className="mb-3">
          <ViewTabs size="sm" value={mode} onChange={setMode}
            options={[{ value: 'pick', label: 'Existing organization' }, { value: 'create', label: 'New organization' }]} />
        </div>
      )}
      {mode === 'pick' ? (
        <Field label="Apply as">
          <PickList value={orgId} onChange={setOrgId} ariaLabel="Apply as"
            options={myOrgs.map((m) => ({ value: m.organization_id, label: m.organization?.name ?? 'Organisation' }))} />
        </Field>
      ) : (
        <>
          <Field label="Organization name"><Input value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Rohit Sports Club" /></Field>
          <Field label="City (optional)"><Input value={newCity} onChange={(e) => setNewCity(e.target.value)} placeholder="Mumbai" /></Field>
        </>
      )}
      {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Apply to participate'}</Button>
      </div>
    </Modal>
  );
}

/** A poster for one event: its window and sports on navy, then name, place, and how to get in. */
function EventPoster({ c, iconOf, entry }: { c: Championship; iconOf: (s: string) => string; entry: ReactNode }) {
  const look = eventStatusLook(c.status);
  const when = timing(c);
  const sports = c.sports ?? [];
  // Like sports: the first two cities, then "+N", all of them on hover.
  const cities = hostCitiesFor(c);
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className={cn('relative overflow-hidden px-4 pb-4 pt-3 text-white', PERSONAL_NAVY)}>
        {/* Kit stripes, as on My Game's hero. */}
        <svg aria-hidden viewBox="0 0 200 100" preserveAspectRatio="xMaxYMid slice" className="pointer-events-none absolute inset-0 h-full w-full">
          <polygon points="120,100 140,100 190,0 170,0" fill="#5CE1E6" opacity=".08" />
          <polygon points="146,100 152,100 202,0 196,0" fill="#5CE1E6" opacity=".14" />
        </svg>
        <div className="relative flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] shadow-sm', look.solid)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', look.dot, c.status === 'ongoing' && 'animate-pulse')} aria-hidden />{look.label}
            </span>
            {c.visibility === 'private' && <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80 ring-1 ring-white/15"><Lock size={10} aria-hidden />Private</span>}
          </span>
          {when && <span className={cn('text-[11px] font-semibold', when.warn ? 'text-amber-300' : 'text-[var(--accent)]')}>{when.text}</span>}
        </div>
        <div className="relative mt-2 text-lg font-black tabular-nums">{fmtDateRange(c.start_date, c.end_date)}</div>
        <div className="relative mt-2 flex items-center gap-1.5" title={sports.join(', ') || undefined}>
          {sports.length === 0 ? <span className="text-xs text-white/50">Sports to be announced</span> : (
            <>
              {sports.slice(0, 6).map((s) => <span key={s} className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-sm ring-1 ring-white/15" aria-hidden>{iconOf(s)}</span>)}
              {sports.length > 6 && <span className="text-xs font-bold text-white/70">+{sports.length - 6}</span>}
            </>
          )}
        </div>
      </div>
      <div className="flex-1 space-y-1 p-4">
        <Link to={`/championships/${c.id}`} className="line-clamp-2 text-base font-black leading-snug text-slate-900 hover:text-[var(--accent-deep)] dark:text-slate-100 dark:hover:text-[var(--accent)]">{c.name}</Link>
        <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          <MapPin size={13} className="shrink-0" aria-hidden />
          <span className="truncate" title={citiesLabel(cities) || undefined}>{citiesShort(cities) || 'Venue to be confirmed'}</span>
        </div>
        {sports.length > 0 && <div className="truncate text-xs text-slate-400" title={sports.join(', ')}>{sports.join(' · ')}</div>}
      </div>
      <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">{entry}</div>
    </article>
  );
}

// Discover - every championship on the platform, open to any signed-in user.
// WHO IS ENTERING IS THE WORKSPACE'S QUESTION (F-052): in My Space, Register opens the
// popup that picks or creates the organisation; in an org, Register enters that org.
export function DiscoverPage() {
  usePageTitle('Discover');
  const ws = useWorkspace();
  const { ctx } = useAuth();
  const qc = useQueryClient();
  const { data: championships = [], isLoading } = useApi<Championship[]>('/championships');
  // scope=all so an application made under ANY of the user's orgs flips the CTA.
  const { data: enrollments = [] } = useApi<any[]>('/me/enrollments?scope=all');
  const iconOf = useSportIcon();
  const [sports, setSports] = useState<string[]>([]);
  const [sportsOpen, setSportsOpen] = useState(false);
  const [status, setStatus] = useState('all');
  const [applying, setApplying] = useState<Championship | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // The organisation this Discover belongs to, if any. Undefined in personal space.
  const activeOrg = useMemo(() => {
    if (ws.active?.kind !== 'org') return undefined;
    const id = ws.active.id;
    return ((ctx?.organizations ?? []) as OrgMembership[]).find((m) => m.organization_id === id);
  }, [ws.active, ctx]);
  const mayEnter = !activeOrg || canEnter(activeOrg);
  // An archived organisation enters nothing - the server refuses it too.
  const orgArchived = !!activeOrg?.organization?.archived_at;
  // Teal is the personal workspace's colour; an organisation keeps its blue.
  const accent = activeOrg ? 'brand' : 'teal';
  const PILL = activeOrg ? PILL_BRAND : PILL_TEAL;

  // In an organisation, only ITS application counts, not one made under another of your orgs.
  const enrollmentStatusFor = (eventId: string) =>
    enrollments.find((e) =>
      e.championship_id === eventId && (!activeOrg || e.organization_id === activeOrg.organization_id),
    )?.status as string | undefined;

  const registerActiveOrg = async (c: Championship) => {
    if (!activeOrg) return;
    setBusyId(c.id);
    try {
      await api('POST', `/championships/${c.id}/enroll`, { organization_id: activeOrg.organization_id });
      await refreshAfterEnroll(qc);
      toast.success('Application submitted', `${orgLabel(activeOrg)} has applied to ${c.name}. You can enter teams once the organiser approves.`);
    } catch (e: any) {
      toast.error('Could not register', e.message);
    } finally {
      setBusyId(null);
    }
  };

  const sportOptions = useSportOptions(useMemo(() => championships.map((c) => c.sports), [championships]), iconOf);
  const statusTabs = useMemo(() => {
    const present = new Set(championships.map((c) => c.status));
    const order = [...STATUS_ORDER.filter((s) => present.has(s)), ...[...present].filter((s) => !STATUS_ORDER.includes(s)).sort()];
    return [
      { value: 'all', label: 'All', badge: <span className="tabular-nums opacity-70">{championships.length}</span> },
      ...order.map((s) => ({ value: s, label: eventStatusLook(s).label, badge: <span className="tabular-nums opacity-70">{championships.filter((c) => c.status === s).length}</span> })),
    ];
  }, [championships]);

  const filtered = useMemo(
    () => championships.filter((c) =>
      (!sports.length || (c.sports ?? []).some((s) => sports.includes(s))) &&
      (status === 'all' || c.status === status)),
    [championships, sports, status],
  );

  const tc = useTableControls(filtered, {
    search: (c) => `${c.name} ${c.venue ?? ''} ${(c.host_cities ?? []).join(' ')} ${(c.sports ?? []).join(' ')}`,
    sorts: {
      start: (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime(),
      name: (a, b) => String(a.name).localeCompare(String(b.name)),
    },
    initialSort: 'start',
    pageSize: 12,
  });

  const viewLink = (c: Championship, label = 'View event') => (
    <Link to={`/championships/${c.id}`} className={cn('inline-flex items-center gap-1 text-[13px] font-bold transition hover:gap-1.5',
      activeOrg ? 'text-brand-600 dark:text-brand-300' : 'text-[var(--accent-deep)] dark:text-[var(--accent)]')}>
      {label}<ArrowRight size={14} aria-hidden />
    </Link>
  );

  // The card's foot: your application, a way in, or just a look.
  const entryFor = (c: Championship) => {
    const applied = enrollmentStatusFor(c.id);
    if (applied) {
      return (
        <>
          <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            {activeOrg ? orgLabel(activeOrg) : 'Your application'}
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider', APPLIED_CHIP[applied] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>{applied}</span>
          </span>
          {viewLink(c, 'View')}
        </>
      );
    }
    if (c.status !== 'registration_open') return <><span className="text-xs text-slate-400">Entries closed</span>{viewLink(c)}</>;
    if (activeOrg && !mayEnter) {
      // Sports Admin holds the org by grant, which the server won't accept, so name who can apply.
      return <><span className="text-xs text-slate-400" title={`An owner or admin of ${orgLabel(activeOrg)} can enter it into this championship.`}>Owner or admin only</span>{viewLink(c, 'View')}</>;
    }
    return (
      <>
        {viewLink(c, 'Details')}
        {activeOrg ? (
          <button type="button" className={PILL} disabled={busyId === c.id || orgArchived}
            title={orgArchived ? ORG_ARCHIVED_READ_ONLY_MESSAGE : `Register ${orgLabel(activeOrg)}`} onClick={() => registerActiveOrg(c)}>
            {busyId === c.id ? 'Registering…' : 'Register'}
          </button>
        ) : (
          <button type="button" className={PILL} onClick={() => setApplying(c)}>Register</button>
        )}
      </>
    );
  };

  return (
    // pb-20 keeps the bottom pagination clear of the floating Feedback button.
    <div className="space-y-4 pb-20">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {activeOrg
          ? `Championships open to ${activeOrg.organization?.name ?? 'your organisation'} - registering enters this organisation.`
          : 'Championships open to you - to play in yourself, or to enter an organisation into.'}
      </p>

      {championships.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="max-w-full overflow-x-auto">
              <ViewTabs value={status} onChange={setStatus} options={statusTabs} />
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              {/* SearchInput will not shrink on its own; this wrapper lets it give way to the Sports button. */}
              <div className="min-w-0 flex-1 sm:w-72 sm:flex-none"><SearchInput pill value={tc.query} onChange={tc.setQuery} placeholder="Search events, cities, sports" className="w-full" /></div>
              {sportOptions.length > 1 && (
                <SportFilterButton open={sportsOpen} picked={sports.length} onToggle={() => setSportsOpen((o) => !o)} controls="discover-sports" accent={accent} />
              )}
            </div>
          </div>
          {sportsOpen && sportOptions.length > 1 && (
            <SportFilterPanel id="discover-sports" sports={sportOptions} value={sports} onChange={setSports} allTotal={championships.length} />
          )}
        </>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading">
          {[0, 1, 2, 3, 4, 5].map((i) => <PosterSkeleton key={i} />)}
        </div>
      ) : tc.total === 0 ? (
        <EmptyState
          icon={<Compass size={22} />}
          title={championships.length === 0 ? 'No events yet' : 'No events match'}
          description={championships.length === 0
            ? 'When an organiser hosts an event, it shows up here.'
            : 'Try another status, sport or search.'}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {tc.view.map((c) => <EventPoster key={c.id} c={c} iconOf={iconOf} entry={entryFor(c)} />)}
          </div>
          <PillPagination page={tc.page} pageCount={tc.pageCount} total={tc.total} pageSize={tc.pageSize} onPage={tc.setPage} noun="event" />
        </>
      )}

      {applying && <ApplyModal championship={applying} onClose={() => setApplying(null)} />}
    </div>
  );
}
