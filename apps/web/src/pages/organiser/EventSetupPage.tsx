import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, type LucideIcon, CalendarRange, Medal, MapPin, Send } from 'lucide-react';
import { useEvent } from './EventLayout';
import { useApi, fmtDateRange } from '../../lib/hooks';
import { cn } from '../../components/ui';
import { useUrlState } from '../../components/primitives';
import { SportsDecor } from '../../features/schedule/ScheduleParts';
import { TournamentsTab } from './setup/TournamentsTab';
import { SportsTab } from './setup/SportsTab';
import { VenuesTab } from './setup/VenuesTab';
import { InvitePanel } from '../../components/InvitePanel';
import { INVITE_BUCKET, invitationBucket } from '../../lib/inviteStatus';

const TABS = ['tournaments', 'sports', 'venues', 'invite'] as const;
type Tab = typeof TABS[number];

interface Step { id: Tab; label: string; /** Phone label. */ short: string; icon: LucideIcon; done: boolean; summary: string; next: string }

/** What the open step is for, under its title. */
const STEP_INTRO: Record<Tab, string> = {
  tournaments: 'A season groups the sports that run together. Most events need just one.',
  sports: 'The sports this event runs, their formats, and the categories teams enter.',
  venues: 'Where matches are played: each venue and the grounds or courts inside it.',
  invite: 'Bring in the teams that will compete. They show up here as they join.',
};

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A slim branded header: which event, and how much of its setup is ready. */
function SetupHeader({ name, when, done, total, next, onNext }: {
  name: string; when: string; done: number; total: number; next?: Step; onNext: (t: Tab) => void;
}) {
  const ready = done === total;
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 px-4 py-4 text-white shadow-sm sm:px-5">
      <SportsDecor />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">Event setup</div>
          <h2 className="mt-0.5 truncate text-xl font-black sm:text-2xl" title={name}>{name}</h2>
          <p className="mt-0.5 text-xs text-white/70">{when}</p>
        </div>
        {ready || !next ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400 px-3 py-1.5 text-[13px] font-bold text-emerald-950 shadow-sm">
            <Check size={14} strokeWidth={3} aria-hidden />Ready to run
          </span>
        ) : (
          <button type="button" onClick={() => onNext(next.id)}
            className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[13px] font-bold text-brand-700 shadow-sm transition hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <span className="tabular-nums text-brand-500">{done}/{total}</span>Next: {next.next}<ArrowRight size={14} aria-hidden />
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * The four steps side by side above the work; each says where it stands. On a phone
 * the same strip compacts: marker over a short label, no summary line.
 */
function SetupStrip({ steps, active, onPick }: { steps: Step[]; active: Tab; onPick: (t: Tab) => void }) {
  return (
    <nav aria-label="Setup steps" className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <ol className="grid grid-cols-4 divide-x divide-slate-100 dark:divide-slate-800">
        {steps.map((s, i) => {
          const on = s.id === active;
          return (
            <li key={s.id} className="min-w-0">
              <button type="button" onClick={() => onPick(s.id)} aria-current={on ? 'step' : undefined} title={`${s.label}: ${s.summary}`}
                className={cn('relative flex h-full w-full flex-col items-center gap-1 px-1 py-2.5 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400 sm:flex-row sm:gap-3 sm:px-3 sm:py-3 sm:text-left lg:px-4',
                  on ? 'bg-brand-50/70 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50')}>
                {on && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand-600 dark:bg-brand-400" aria-hidden />}
                <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-black sm:h-8 sm:w-8 sm:text-xs',
                  s.done ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                    : on ? 'bg-brand-600 text-white' : 'border border-dashed border-slate-300 text-slate-400 dark:border-slate-600')}>
                  {s.done ? <Check size={14} strokeWidth={3} aria-hidden /> : i + 1}
                </span>
                <span className="w-full min-w-0 sm:flex-1">
                  <span className={cn('block truncate text-[11px] font-bold sm:text-sm', on ? 'text-brand-700 dark:text-brand-200' : 'text-slate-800 dark:text-slate-100')}>
                    <span className="sm:hidden">{s.short}</span><span className="max-sm:hidden">{s.label}</span>
                  </span>
                  <span className={cn('block truncate text-xs max-sm:hidden', s.done ? 'text-slate-500 dark:text-slate-400' : 'text-amber-600 dark:text-amber-400')}>{s.summary}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function EventSetupPage() {
  const { championship, eventId, canManage, canManageSport } = useEvent();
  // Seasons, venues and invitations are the whole event's. A sport organiser works
  // on their own sports here and nothing else.
  const tabs: readonly Tab[] = canManage ? TABS : ['sports'];
  const [params] = useSearchParams();
  const [tabRaw, setTabRaw] = useUrlState<string>('tab', 'sports');
  const tab: Tab = (tabs as readonly string[]).includes(tabRaw) ? tabRaw as Tab : 'sports';
  const setTab = (t: Tab) => setTabRaw(t);
  // Deep links (e.g. the dashboard checklist) can target a tab with ?tab=invite.
  const wanted = params.get('tab');
  useEffect(() => {
    if (wanted && wanted !== tabRaw && (tabs as readonly string[]).includes(wanted)) setTabRaw(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  // Step progress. Same query keys as the steps' panels, so nothing is fetched twice.
  const { data: tournaments = [] } = useApi<any[]>(`/tournaments?championship_id=${eventId}`);
  const [seasonParam, setSeason] = useUrlState<string>('season', '');
  const season = seasonParam || tournaments[0]?.id || '';
  const { data: tsports = [] } = useApi<any[]>(season ? `/tournament-sports?tournament_id=${season}` : null);
  const { data: draws = [] } = useApi<any[]>(`/championships/${eventId}/draws`);
  const { data: venues = [] } = useApi<any[]>(canManage ? `/venues?championship_id=${eventId}` : null);
  const { data: grounds = [] } = useApi<any[]>(canManage ? `/championships/${eventId}/grounds` : null);
  const { data: invites = [] } = useApi<any[]>(canManage ? `/championships/${eventId}/invitations` : null);
  // Open events also take entries that never had an invitation (applied and approved).
  const intra = !!championship.entry?.intra;
  const { data: entries = [] } = useApi<any[]>(canManage && !intra ? `/championships/${eventId}/organizations` : null);

  const steps = useMemo<Step[]>(() => {
    const seasonDraws = draws.filter((d) => tsports.some((ts) => ts.id === d.tournament_sport_id));
    const bucket = (s: string) => (intra ? invitationBucket(s) : s);
    const list: Array<{ status: string }> = intra ? invites : entries;
    const approved = list.filter((i) => bucket(i.status) === (intra ? INVITE_BUCKET.APPROVED : 'approved')).length;
    const pending = list.filter((i) => bucket(i.status) === (intra ? INVITE_BUCKET.PENDING : 'pending')).length + (intra ? 0 : invites.filter((i) => invitationBucket(i.status) === INVITE_BUCKET.PENDING).length);
    return [
      { id: 'tournaments', label: 'Seasons', short: 'Seasons', icon: CalendarRange, done: tournaments.length > 0,
        summary: tournaments.length ? n(tournaments.length, 'season') : 'None yet', next: 'add a season' },
      { id: 'sports', label: 'Sports & disciplines', short: 'Sports', icon: Medal, done: tsports.length > 0 && tsports.every((ts) => seasonDraws.some((d) => d.tournament_sport_id === ts.id)),
        summary: tsports.length ? `${n(tsports.length, 'sport')} · ${n(seasonDraws.length, 'discipline')}` : 'None yet', next: tsports.length ? 'finish disciplines' : 'add sports' },
      { id: 'venues', label: 'Venue', short: 'Venue', icon: MapPin, done: venues.length > 0,
        summary: venues.length ? `${n(venues.length, 'venue')} · ${n(grounds.length, 'ground')}` : 'None yet', next: 'add a venue' },
      { id: 'invite', label: 'Invite', short: 'Invite', icon: Send, done: approved > 0,
        summary: approved || pending ? `${approved} joined${pending ? ` · ${pending} pending` : ''}` : 'Nobody yet', next: 'invite teams' },
    ];
  }, [tournaments, tsports, draws, venues, grounds, invites, entries, intra]);

  const content = (
    <>
      {tab === 'tournaments' && <TournamentsTab eventId={eventId} onCreated={() => setTab('venues')} />}
      {tab === 'venues' && <VenuesTab eventId={eventId} />}
      {tab === 'sports' && <SportsTab eventId={eventId} season={season} onSeason={setSeason} canManageSport={canManageSport} canAddSports={canManage} onGoToVenues={canManage ? () => setTab('venues') : undefined} />}
      {tab === 'invite' && <InvitePanel eventId={eventId} readOnly={!!championship.archived_at} intro={false} />}
    </>
  );

  // A sport organiser has one step, so no checklist.
  if (!canManage) {
    return (
      <div className="space-y-5">
        <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">
          You organise some of this championship's sports - you can change those here. Seasons, venues and invitations are set by the overall organisers.
        </p>
        {content}
      </div>
    );
  }

  const current = steps.find((s) => s.id === tab)!;
  const Icon = current.icon;
  return (
    <div className="space-y-5">
      <SetupHeader name={championship.name} when={fmtDateRange(championship.start_date, championship.end_date)}
        done={steps.filter((s) => s.done).length} total={steps.length} next={steps.find((s) => !s.done)} onNext={setTab} />
      <SetupStrip steps={steps} active={tab} onPick={setTab} />
      <div>
        <div className="min-w-0 space-y-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"><Icon size={18} aria-hidden /></span>
            <div className="min-w-0">
              <h3 className="text-lg font-black text-slate-900 dark:text-slate-100">{current.label}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">{STEP_INTRO[tab]}</p>
            </div>
          </div>
          {content}
        </div>
      </div>
    </div>
  );
}
