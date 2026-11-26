import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, ArrowRight, Check, ChevronLeft, ChevronRight, Flag, Gem, MapPin, ScrollText, Sigma, type LucideIcon } from 'lucide-react';
import { ARCHIVE_RETENTION_DAYS, archiveDaysLeft, CHAMPIONSHIP_STATUS, citiesLabel, hostCitiesFor, type ChampionshipRemovalMode } from '@semp/shared';
import { useEvent } from './EventLayout';
import { api } from '../../lib/api';
import { fmtDate, fmtDateRange, useApi, useApiMutation } from '../../lib/hooks';
import { useEventPlan } from '../../lib/eventPlan';
import { titleCase } from '../../lib/format';
import { cn, confirmDialog, Input, PILL_PICK, Textarea, toast } from '../../components/ui';
import { PickList } from '../../components/PickList';
import { useUrlState } from '../../components/primitives';
import { useWorkspace } from '../../lib/useWorkspace';
import { ruleSummary, StandingsRulesCard } from '../../components/StandingsRulesCard';
import { EventPlanCard } from '../../components/EventPlanCard';

type Section = 'details' | 'lifecycle' | 'points' | 'plan' | 'archive';
interface SectionDef { id: Section; label: string; hint: string; icon: LucideIcon; danger?: boolean }
const SECTIONS: SectionDef[] = [
  { id: 'details', label: 'Details', hint: 'Name, dates, host and who can find the event', icon: ScrollText },
  { id: 'lifecycle', label: 'Lifecycle', hint: 'Where the event is: draft, registration, live or completed', icon: Flag },
  { id: 'points', label: 'Point system', hint: 'How results turn into points on the table', icon: Sigma },
  { id: 'plan', label: 'Plan', hint: 'What this event can hold, and how much is used', icon: Gem },
  { id: 'archive', label: 'Archive or delete', hint: 'Hide this event, or remove it for good', icon: Archive, danger: true },
];

const LABEL = 'mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-300';
const HINT = 'mt-1 text-xs text-slate-400 dark:text-slate-500';
const CARD = 'overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';

function CardHead({ icon: Icon, title, sub, tone = 'brand' }: { icon: LucideIcon; title: string; sub?: string; tone?: 'brand' | 'rose' | 'amber' }) {
  return (
    <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
      <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl',
        tone === 'rose' ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'
          : tone === 'amber' ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300'
            : 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300')} aria-hidden><Icon size={18} /></span>
      <div className="min-w-0">
        <h2 className="text-[15px] font-black text-slate-900 dark:text-slate-100">{title}</h2>
        {sub && <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
      </div>
    </header>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className={LABEL}>{label}</span>
      {children}
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  );
}

/** A labelled value on an overview card: "Visibility · Public". */
function Fact({ label, value, tone }: { label: string; value: ReactNode; tone?: 'amber' | 'emerald' | 'rose' }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={cn('truncate text-sm font-semibold',
        tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'rose' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100')}>{value}</div>
    </div>
  );
}

export function EventSettingsPage() {
  const navigate = useNavigate();
  const { championship, eventId, lifecycle } = useEvent();
  const [tabRaw, setTab] = useUrlState<string>('tab', '');
  const open = SECTIONS.find((s) => s.id === tabRaw);
  const { plan } = useEventPlan(eventId);
  const { data: rules } = useApi<any>(`/championships/${eventId}/standings-rules`);
  const { data: removal } = useApi<Removal>(`/championships/${eventId}/removal`);

  const remove = useApiMutation(
    () => api('DELETE', `/championships/${eventId}`),
    ['/championships', '/championships/mine'],
    () => { toast.success('Championship deleted'); navigate('/championships'); },
  );

  // What each card says about the event right now.
  const host = (championship as any).host_organization?.name as string | undefined;
  const status = championship.status;
  const savedDefault = rules?.rules?.find((r: any) => r.scope_type === 'championship');
  const overrides = rules?.rules?.filter((r: any) => r.scope_type !== 'championship').length ?? 0;
  // The limit closest to full; on an unlimited plan, simply the first one.
  const busiest = plan?.limits?.filter((l) => l.fraction !== null).sort((a, b) => (b.fraction ?? 0) - (a.fraction ?? 0))[0] ?? plan?.limits?.[0];
  const facts: Record<Section, ReactNode> = {
    details: <>
      <Fact label="Visibility" value={championship.visibility === 'private' ? 'Private (invite-only)' : 'Public'} />
      <Fact label="Hosted by" value={host ?? 'Nobody yet'} tone={host ? undefined : 'amber'} />
      <Fact label="Dates" value={fmtDateRange(championship.start_date, championship.end_date)} />
    </>,
    lifecycle: <>
      <Fact label="Now" value={titleCase(status)} tone={status === 'ongoing' ? 'emerald' : undefined} />
      <Fact label="Next step" value={lifecycle?.label ?? (status === 'completed' ? 'All done' : '-')} />
    </>,
    points: <>
      <Fact label="Default" value={rules ? ruleSummary(savedDefault?.config ?? rules.default) : '…'} />
      <Fact label="Saved" value={!rules ? '…' : savedDefault ? 'Yes' : 'Not yet - using the built-in 2 / 1 / 0'} tone={rules && !savedDefault ? 'amber' : undefined} />
      <Fact label="Custom overrides" value={rules ? (overrides ? `${overrides}` : 'None') : '…'} />
    </>,
    plan: <>
      <Fact label="Plan" value={plan ? (plan.source === 'legacy' ? 'Unlimited' : plan.name) : '…'} />
      <Fact label={busiest ? busiest.label : 'Limits'} value={busiest ? `${busiest.current} / ${busiest.capLabel}` : plan ? 'No limits close' : '…'}
        tone={busiest && (busiest.fraction ?? 0) >= 0.9 ? 'rose' : busiest && (busiest.fraction ?? 0) >= 0.7 ? 'amber' : undefined} />
    </>,
    archive: <>
      <Fact label="Status" value={!removal ? '…' : removal.archived_at ? `Archived on ${fmtDate(removal.archived_at)}` : 'Active'} tone={removal?.archived_at ? 'amber' : undefined} />
      <Fact label="Can be" value={!removal ? '…' : removal.archived_at ? 'Retrieved' : removal.mode === 'archive' ? 'Archived only (it has results)' : 'Deleted or archived'} />
    </>,
  };

  // One section open: a way back, and pills to hop to the others.
  if (open) {
    const Icon = open.icon;
    return (
      <div className="space-y-5 pb-16">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <button type="button" onClick={() => setTab('')}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white py-1 pl-2 pr-3 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <ChevronLeft size={15} aria-hidden />All settings
          </button>
          <div role="tablist" aria-label="Settings sections" className="no-scrollbar -mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 sm:justify-end">
            {SECTIONS.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={s.id === open.id} onClick={() => setTab(s.id)}
                className={cn('shrink-0 rounded-full px-3 py-1 text-[13px] font-semibold transition',
                  s.id === open.id ? (s.danger ? 'bg-rose-600 text-white' : 'bg-brand-600 text-white dark:bg-brand-500') : 'text-slate-500 hover:bg-white hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200')}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-start gap-3">
          <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-2xl', open.danger ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300')} aria-hidden><Icon size={20} /></span>
          <div className="min-w-0">
            <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100">{open.label}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{open.hint}</p>
          </div>
        </div>
        {open.id === 'details' && <GeneralTab part="details" lifecycle={lifecycle} />}
        {open.id === 'lifecycle' && <GeneralTab part="lifecycle" lifecycle={lifecycle} />}
        {open.id === 'points' && <StandingsRulesCard eventId={eventId} />}
        {open.id === 'plan' && <EventPlanCard eventId={eventId} name={championship.name} />}
        {open.id === 'archive' && <DangerZone eventId={eventId} name={championship.name} onDelete={() => remove.mutateAsync(undefined)} deleting={remove.isPending} />}
      </div>
    );
  }

  // The overview: every area of settings, with what it is set to right now.
  return (
    <div className="space-y-5 pb-16">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">How <span className="font-semibold text-slate-700 dark:text-slate-200">{championship.name}</span> is set up. Open a card to change it.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map((s) => {
          const SIcon = s.icon;
          return (
            <button key={s.id} type="button" onClick={() => setTab(s.id)}
              className={cn('group flex min-w-0 flex-col rounded-2xl border bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dark:bg-slate-900',
                s.danger ? 'border-rose-200 hover:border-rose-300 md:col-span-2 dark:border-rose-500/30' : 'border-slate-200 hover:border-brand-300 dark:border-slate-800')}>
              <div className="flex items-start gap-3">
                <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-2xl', s.danger ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300')} aria-hidden><SIcon size={20} /></span>
                <div className="min-w-0 flex-1">
                  <div className={cn('text-base font-black', s.danger ? 'text-rose-700 dark:text-rose-300' : 'text-slate-900 dark:text-slate-100')}>{s.label}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{s.hint}</div>
                </div>
                <span className={cn('inline-flex shrink-0 items-center gap-0.5 text-xs font-bold', s.danger ? 'text-rose-600 dark:text-rose-300' : 'text-brand-600 dark:text-brand-300')}>
                  {s.danger ? 'Manage' : 'Edit'}<ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </div>
              {/* Current values, so the overview answers "how is this set up?" without opening anything. */}
              <div className={cn('mt-4 grid gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/40', s.danger ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>{facts[s.id]}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GeneralTab({ lifecycle, part }: { lifecycle: ReturnType<typeof useEvent>['lifecycle']; part: 'details' | 'lifecycle' }) {
  const { championship, eventId } = useEvent();
  const [name, setName] = useState(championship.name);
  // Read-only here: host cities follow the venues, so they are changed on the Venue tab.
  const cities = hostCitiesFor(championship as { host_cities?: string[]; venue?: string | null });
  const [description, setDescription] = useState(championship.description ?? '');
  const [startDate, setStartDate] = useState(championship.start_date?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(championship.end_date?.slice(0, 10) ?? '');
  const [visibility, setVisibility] = useState<'public' | 'private'>(championship.visibility === 'private' ? 'private' : 'public');

  // Which organisation is running this. It decides whose signature goes on the
  // event's certificates, so the Certificates page points people here when it is
  // unset - which means this control has to exist.
  const ws = useWorkspace();
  // An archived organisation can't host - the server refuses it too.
  const hostable = ws.contexts.filter(
    (c) => c.kind === 'org' && !c.archived && c.roleCodes.some((r) => r === 'owner' || r === 'org_admin'),
  );
  const initialHost = (championship as any).host_organization_id ?? '';
  const [hostOrgId, setHostOrgId] = useState<string>(initialHost);

  const save = useApiMutation(
    (body: any) => api('PATCH', `/championships/${eventId}`, body),
    [`/championships/${eventId}`, '/championships'],
  );
  const dirty = name !== championship.name || description !== (championship.description ?? '')
    || startDate !== (championship.start_date?.slice(0, 10) ?? '') || endDate !== (championship.end_date?.slice(0, 10) ?? '')
    || visibility !== (championship.visibility === 'private' ? 'private' : 'public') || (hostable.length > 0 && hostOrgId !== initialHost);

  const stage = CHAMPIONSHIP_STATUS.indexOf(championship.status as typeof CHAMPIONSHIP_STATUS[number]);

  return (
    <>
      {part === 'details' && (
      <section className={CARD}>
        <div className="space-y-5 p-4">
          <Field label="Championship name"><Input value={name} onChange={(e) => setName(e.target.value)} className="!h-11 w-full !rounded-xl" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="!h-11 w-full !rounded-xl" /></Field>
            <Field label="End date"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="!h-11 w-full !rounded-xl" /></Field>
          </div>
          <Field label="Host cities" hint={<>The cities your venues are in. Change them by editing venues on <Link to={`/championships/${eventId}/setup?tab=venues`} className="font-semibold text-brand-600 hover:underline dark:text-brand-400">Setup → Venue</Link>.</>}>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <MapPin size={14} className="text-slate-400" aria-hidden />{citiesLabel(cities) || 'None yet'}
            </span>
          </Field>
          {/* Only offered to somebody who could actually host on an organisation's
              behalf - the server refuses any other choice, and an option that is
              always rejected is worse than no option. */}
          {hostable.length > 0 ? (
            <Field label="Hosted by" hint="Whose event this is. Certificates for it carry this organisation's name and signature.">
              <PickList value={hostOrgId} onChange={setHostOrgId} ariaLabel="Hosted by"
                options={[{ value: '', label: 'Nobody - an individual is hosting' }, ...hostable.map((o) => ({ value: o.id, label: o.name }))]}
                className={cn(PILL_PICK, 'w-full sm:w-80')} />
            </Field>
          ) : (championship as any).host_organization ? (
            <Field label="Hosted by" hint="Only an owner or administrator of that organisation can change this.">
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{(championship as any).host_organization.name}</span>
            </Field>
          ) : null}
          <Field label="Description"><Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full !rounded-xl" placeholder="What is this event about? Who is it for?" /></Field>
          <Field label="Visibility">
            {/* Two choices as cards: what each one means is the decision. */}
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ['public', 'Public', 'Listed in Discover so any organisation can find it and apply.'],
                ['private', 'Private (invite-only)', 'Hidden from Discover. Organisations join only through your invitations.'],
              ] as const).map(([v, label, text]) => {
                const on = visibility === v;
                return (
                  <button key={v} type="button" aria-pressed={on} onClick={() => setVisibility(v)}
                    className={cn('flex items-start gap-2.5 rounded-xl border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
                      on ? 'border-brand-400 bg-brand-50/70 dark:border-brand-500/50 dark:bg-brand-500/10' : 'border-slate-200 hover:border-brand-300 dark:border-slate-700')}>
                    <span className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2', on ? 'border-brand-600 bg-brand-600' : 'border-slate-300 dark:border-slate-600')} aria-hidden>
                      {on && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </span>
                    <span>
                      <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">{label}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{text}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
          {dirty && <span className="mr-auto flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />Unsaved changes</span>}
          <button type="button" disabled={save.isPending || !dirty} title={!dirty ? 'Nothing to save' : undefined}
            onClick={() => save.mutate({
              name, description: description || undefined,
              start_date: startDate, end_date: endDate, visibility,
              ...(hostable.length > 0 ? { host_organization_id: hostOrgId || null } : {}),
            }, { onSuccess: () => toast.success('Championship saved'), onError: (e: any) => toast.error(e.message) })}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-500">
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </section>

      )}
      {part === 'lifecycle' && (
      <section className={cn(CARD, 'max-w-2xl')}>
        {/* A vertical track: done stages ticked, the current one highlighted. */}
        <ol className="relative space-y-0 px-4 py-4">
          {CHAMPIONSHIP_STATUS.map((st, i) => {
            const done = i < stage; const current = i === stage;
            return (
              <li key={st} className="relative flex items-start gap-3 pb-4 last:pb-0">
                {i < CHAMPIONSHIP_STATUS.length - 1 && <span aria-hidden className={cn('absolute left-[0.8rem] top-7 h-[calc(100%-1.25rem)] w-0.5', done ? 'bg-brand-500' : 'bg-slate-200 dark:bg-slate-700')} />}
                <span className={cn('relative grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black',
                  done ? 'bg-brand-600 text-white' : current ? 'bg-white text-brand-700 ring-2 ring-brand-500 dark:bg-slate-900' : 'bg-slate-100 text-slate-400 dark:bg-slate-800')}>
                  {done ? <Check size={14} strokeWidth={3} aria-hidden /> : i + 1}
                </span>
                <span className="min-w-0 pt-0.5">
                  <span className={cn('block text-sm', current ? 'font-black text-slate-900 dark:text-slate-100' : done ? 'font-semibold text-slate-500' : 'text-slate-400')}>{titleCase(st)}</span>
                  {current && <span className="text-xs font-semibold text-brand-600 dark:text-brand-300">You are here</span>}
                </span>
              </li>
            );
          })}
        </ol>
        {lifecycle && (
          <div className="border-t border-slate-100 p-3 dark:border-slate-800">
            <button type="button" onClick={lifecycle.advance} disabled={lifecycle.pending}
              className="flex w-full items-center justify-center gap-1.5 rounded-full bg-brand-600 py-2 text-[13px] font-bold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60 dark:bg-brand-500">
              {lifecycle.pending ? 'Updating…' : lifecycle.label}<ArrowRight size={14} aria-hidden />
            </button>
          </div>
        )}
      </section>
      )}
    </>
  );
}

interface Removal {
  mode: ChampionshipRemovalMode;
  reasons: string[];
  archived_at: string | null;
  archived_with_org?: boolean;
  purge_on: string | null;
  retention_days: number;
}

const DANGER_BTN = 'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rose-600 px-4 py-1.5 text-[13px] font-bold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-60';

// Delete OR archive, never both. Once the event has results - completed, a played or
// locked match, an issued certificate - it can only be archived: hidden, restorable,
// and permanently deleted after the retention period unless retrieved.
function DangerZone({ eventId, name, onDelete, deleting }: {
  eventId: string; name: string; onDelete: () => Promise<unknown>; deleting: boolean;
}) {
  const navigate = useNavigate();
  const removalPath = `/championships/${eventId}/removal`;
  const { data } = useApi<Removal>(removalPath);
  const lists = ['/championships', '/championships/mine', removalPath];
  const archive = useApiMutation(() => api('POST', `/championships/${eventId}/archive`), lists);
  const retrieve = useApiMutation(() => api('POST', `/championships/${eventId}/retrieve`), lists);

  if (!data) return <div aria-label="Loading" className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />;
  const days = data.retention_days ?? ARCHIVE_RETENTION_DAYS;

  const shell = (tone: 'rose' | 'amber', title: string, sub: string, body: ReactNode, action?: ReactNode) => (
    <section className={cn(CARD, tone === 'rose' ? 'border-rose-200 dark:border-rose-500/30' : 'border-amber-200 dark:border-amber-500/30')}>
      <CardHead icon={Archive} tone={tone} title={title} sub={sub} />
      <div className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="min-w-0 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">{body}</div>
        {action}
      </div>
    </section>
  );

  if (data.archived_at && data.archived_with_org) {
    return shell('amber', 'Archived', `Archived with its organisation on ${fmtDate(data.archived_at)}`,
      <>This championship was archived together with its organisation. It isn't on a 90-day clock - it comes back when the organisation is retrieved, from the organisation's Administration → Organization Profile.</>);
  }

  if (data.archived_at) {
    return shell('amber', 'Archived', `Archived on ${fmtDate(data.archived_at)}`,
      <>This championship is hidden from every list and will be permanently deleted on{' '}
        <span className="font-semibold text-slate-800 dark:text-slate-100">{fmtDate(data.purge_on!)}</span>{' '}
        ({archiveDaysLeft(data.archived_at)} days left) unless you retrieve it.</>,
      <button type="button" disabled={retrieve.isPending} onClick={() => retrieve.mutate(undefined, {
        onSuccess: () => toast.success('Championship retrieved'),
        onError: (e: any) => toast.error(e.message),
      })} className="inline-flex shrink-0 items-center rounded-full bg-brand-600 px-4 py-1.5 text-[13px] font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60">
        {retrieve.isPending ? 'Retrieving…' : 'Retrieve'}
      </button>);
  }

  if (data.mode === 'archive') {
    return shell('rose', 'Archive this championship', 'It has results, so it can be archived but not deleted',
      <>This championship can't be deleted because {data.reasons.join(', ')}. Archiving hides it from every list, and you can retrieve it from the Archived tab for {days} days. Players keep their results and certificates stay valid.</>,
      <button type="button" disabled={archive.isPending} className={DANGER_BTN}
        onClick={async () => {
          const ok = await confirmDialog({
            title: 'Archive championship',
            confirmLabel: 'Archive championship',
            message: `“${name}” will be hidden from every list. It will be permanently deleted after ${days} days unless you retrieve it from the Archived tab before then. Players keep their results and certificates stay valid.`,
          });
          if (!ok) return;
          archive.mutate(undefined, {
            onSuccess: () => { toast.success(`Archived - deleted in ${days} days unless retrieved`); navigate('/championships?tab=archived'); },
            onError: (e: any) => toast.error(e.message),
          });
        }}>
        <Archive size={14} aria-hidden />{archive.isPending ? 'Archiving…' : 'Archive championship'}
      </button>);
  }

  return shell('rose', 'Delete this championship', 'Permanently, with everything in it',
    <>Deletes all tournaments, venues, fixtures, enrollments and notifications for this championship. Teams are kept. This cannot be undone.</>,
    <button type="button" disabled={deleting} className={DANGER_BTN}
      onClick={async () => {
        if (await confirmDialog({ title: 'Delete championship', confirmLabel: 'Delete championship', message: `Delete “${name}” now? It is removed permanently, straight away, and cannot be retrieved.` })) {
          onDelete().catch((e: any) => toast.error(e.message));
        }
      }}>
      {deleting ? 'Deleting…' : 'Delete championship'}
    </button>);
}
