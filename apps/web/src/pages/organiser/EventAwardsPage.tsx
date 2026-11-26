import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Award, Medal, Pencil, Plus, Sparkles, Trash2, Trophy } from 'lucide-react';
import { ARCHIVED_READ_ONLY_MESSAGE } from '@semp/shared';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { cn, confirmDialog, EmptyState, toast } from '../../components/ui';
import { IconAction } from '../../components/CrewPanel';
import { SportsDecor } from '../../features/schedule/ScheduleParts';
import { AwardTypeFormModal } from '../../features/awards/AwardTypeFormModal';
import { inScope, ScopeAwardsEditor, type AwardScopeRef, type ChampionshipAward } from '../../features/awards/ScopeAwardsEditor';
import { LEVEL_LABEL, RECIPIENT_LABEL, type AwardType, type AwardTypeBody } from '../../features/awards/types';
import { useEvent } from './EventLayout';
import { useEventPlan } from '../../lib/eventPlan';
import { CapabilityLock } from '../../components/CapabilityLock';

interface TournamentScope { id: string; name: string; sports: Array<{ id: string; sport_id: string; name: string }> }

const scopeKey = (s: AwardScopeRef) => `${s.level}|${s.tournament_id ?? ''}|${s.tournament_sport_id ?? ''}`;

// Awards above match level for one event: per sport within a tournament, per
// tournament, and for the whole event - plus award types that exist only here.
// Match awards stay on the match console, where the scorer gives them.
export function EventAwardsPage() {
  // An overall organiser gives awards at every level; a sport organiser only within
  // the sports they run (the server enforces the same).
  const { championship, eventId, canManage, organises, canManageSport } = useEvent();
  const archived = !!championship.archived_at;
  const qc = useQueryClient();
  const awardsOk = useEventPlan(eventId).has('event_awards');

  const { data: tournaments = [], isLoading } = useApi<TournamentScope[]>(organises ? `/championships/${eventId}/awards/scopes` : null);
  const { data: awards = [] } = useApi<ChampionshipAward[]>(organises ? `/championships/${eventId}/awards` : null);
  const { data: catalogue = [] } = useApi<Array<{ id: string; icon?: string | null }>>('/sports');
  const sportIcon = (sportId?: string) => catalogue.find((c) => c.id === sportId)?.icon || '🏅';
  const ownTypesPath = `/championships/${eventId}/award-types`;
  const { data: ownTypes = [] } = useApi<AwardType[]>(canManage ? ownTypesPath : null);

  const scopes = useMemo<Array<AwardScopeRef & { sport_id?: string }>>(() => {
    const multi = tournaments.length > 1;
    const list: Array<AwardScopeRef & { sport_id?: string }> = canManage ? [{
      level: 'championship', title: 'Event awards', subtitle: `Across the whole of ${championship.name}`,
    }] : [];
    for (const t of tournaments) {
      if (canManage) {
        list.push({
          level: 'tournament', tournament_id: t.id,
          title: multi ? `${t.name} - whole tournament` : 'Whole tournament',
          subtitle: `Across every sport in ${t.name}`,
        });
      }
      for (const s of t.sports.filter((x) => canManage || canManageSport(x.sport_id))) {
        list.push({
          sport_id: s.sport_id,
          level: 'tournament_sport', tournament_id: t.id, tournament_sport_id: s.id,
          title: multi ? `${s.name} · ${t.name}` : s.name,
          subtitle: `Within ${s.name}${multi ? ` in ${t.name}` : ''}`,
        });
      }
    }
    return list;
  }, [tournaments, championship.name, canManage, canManageSport]);

  const eventSports = useMemo(() => {
    const m = new Map<string, string>();
    tournaments.forEach((t) => t.sports.forEach((s) => m.set(s.sport_id, s.name)));
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [tournaments]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = scopes.find((s) => scopeKey(s) === selectedKey) ?? scopes[0];

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AwardType | null>(null);

  // A new or changed event award type changes what every scope can offer.
  const refreshTypes = () => qc.invalidateQueries({
    predicate: (q) => {
      const k = String(q.queryKey[0] ?? '');
      return k === ownTypesPath || k.startsWith(`/championships/${eventId}/awards/options`) || k.startsWith('/award-types');
    },
  });
  const saveType = async (p: Promise<unknown>) => { const r = await p; await refreshTypes(); return r; };

  async function removeType(t: AwardType) {
    const used = t.usage ?? 0;
    const ok = await confirmDialog({
      title: used ? 'Deactivate this award' : 'Delete this award',
      confirmLabel: used ? 'Deactivate' : 'Delete',
      message: used
        ? `"${t.label}" has been given ${used} time${used === 1 ? '' : 's'}. It will stop being offered but stays on those awards.`
        : `Delete "${t.label}"?`,
    });
    if (!ok) return;
    try {
      await saveType(api('DELETE', `${ownTypesPath}/${t.id}`));
      toast.success(used ? 'Award deactivated' : 'Award deleted');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  if (!organises) {
    return <EmptyState icon={<Award size={24} />} title="Awards" description="Only the event's organisers can give awards here." />;
  }
  if (isLoading) {
    return (
      <div className="space-y-5" role="status" aria-label="Loading">
        <div className="h-36 animate-pulse rounded-2xl bg-gradient-to-br from-brand-600/90 via-brand-700/90 to-brand-900/90" />
        <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="hidden h-64 animate-pulse rounded-2xl border border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-slate-900" />
          <div className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
        </div>
      </div>
    );
  }
  if (scopes.length === 0) {
    return <EmptyState icon={<Award size={24} />} title="Awards" description="None of the sports you organise is in this event's tournaments yet." />;
  }

  const countIn = (s: AwardScopeRef) => awards.filter((a) => inScope(a, s)).length;

  if (!awardsOk) return <CapabilityLock capability="event_awards" />;

  const scopeIcon = (s: AwardScopeRef & { sport_id?: string }) => (s.level === 'championship'
    ? <Trophy size={16} className="text-amber-500" />
    : s.level === 'tournament' ? <Medal size={16} className="text-brand-500" /> : <span className="text-base leading-none">{sportIcon(s.sport_id)}</span>);
  const givenAt = scopes.filter((s) => countIn(s) > 0).length;
  const newTypeButton = (onBlue: boolean) => (
    <button type="button" disabled={archived} title={archived ? ARCHIVED_READ_ONLY_MESSAGE : undefined} onClick={() => setCreating(true)}
      className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-bold shadow-sm transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60',
        onBlue ? 'bg-white text-brand-700 shadow-lg hover:bg-brand-50 focus-visible:ring-white/70' : 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-400 dark:bg-brand-500')}>
      <Plus size={15} aria-hidden />New award type
    </button>
  );

  return (
    <div className="space-y-5 pb-16">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-4 text-white shadow-sm sm:p-5">
        <SportsDecor />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">Awards</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-black tabular-nums">{awards.length}</span>
              <span className="text-sm font-semibold text-white/80">{awards.length === 1 ? 'award' : 'awards'} given</span>
            </div>
            <p className="mt-0.5 text-sm text-white/75">
              {awards.length ? `Across ${givenAt} of ${scopes.length} places` : canManage ? 'For a sport, a whole tournament or the whole event' : 'Within the sports you organise'}
              <span className="text-white/60"> · Player of the Match is given on each match's scoring screen</span>
            </p>
          </div>
          {canManage && newTypeButton(true)}
        </div>
      </section>

      {/* Phone and tablet: where to give awards, as chips. */}
      <nav aria-label="Where the award is given" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] lg:hidden">
        {scopes.map((s) => {
          const active = scopeKey(s) === scopeKey(selected);
          const n = countIn(s);
          return (
            <button key={scopeKey(s)} type="button" aria-pressed={active} onClick={() => setSelectedKey(scopeKey(s))}
              className={cn('flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold shadow-sm transition',
                active ? 'border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-500' : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200')}>
              <span aria-hidden className={cn(active && '[&_svg]:text-white')}>{scopeIcon(s)}</span>{s.title}
              {n > 0 && <span className={cn('rounded-full px-1.5 text-[11px] font-bold', active ? 'bg-white/20' : 'bg-amber-50 text-amber-700')}>{n}</span>}
            </button>
          );
        })}
      </nav>

      <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* Desktop: the same places as a list beside the editor. */}
        <nav aria-label="Where the award is given" className="hidden self-start overflow-hidden rounded-2xl border border-slate-200 bg-white lg:sticky lg:top-4 lg:block dark:border-slate-800 dark:bg-slate-900">
          <div className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Give awards for</div>
          <ul className="space-y-0.5 px-2 pb-2">
            {scopes.map((s) => {
              const active = scopeKey(s) === scopeKey(selected);
              const n = countIn(s);
              return (
                <li key={scopeKey(s)}>
                  <button type="button" data-qa="award-scope" aria-pressed={active} onClick={() => setSelectedKey(scopeKey(s))}
                    className={cn('relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition',
                      s.level === 'tournament_sport' && 'pl-5',
                      active ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-200' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60')}>
                    {active && <span className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-brand-600 dark:bg-brand-400" aria-hidden />}
                    <span className="grid w-5 shrink-0 place-items-center" aria-hidden>{scopeIcon(s)}</span>
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    {n > 0 && <span className="shrink-0 rounded-full bg-amber-50 px-1.5 text-[11px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{n}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {selected && (
          <ScopeAwardsEditor
            eventId={eventId}
            scope={selected}
            icon={scopeIcon(selected)}
            saved={awards.filter((a) => inScope(a, selected))}
            readOnly={archived}
          />
        )}
      </div>

      {/* The event's own award types apply across sports, so they are the overall organiser's. */}
      {canManage && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300" aria-hidden><Sparkles size={18} /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-black text-slate-900 dark:text-slate-100">Awards for this event only</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Your own awards on top of the standard list, e.g. Spirit of the Games. Nobody outside this event sees them.</p>
            </div>
          </header>
          {ownTypes.length === 0 ? (
            <EmptyState bare compact icon={<Sparkles size={22} />} title="No awards of your own yet"
              description="Create one and it can be given anywhere in this event, alongside the standard awards."
              action={<button type="button" disabled={archived} onClick={() => setCreating(true)} className="bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"><Plus size={14} aria-hidden />New award type</button>} />
          ) : (
            <ul>
              {ownTypes.map((ty) => (
                <li key={ty.id} className={cn('flex items-center gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0 dark:border-slate-800', !ty.is_active && 'opacity-60')}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-sm" aria-hidden><Medal size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-800 dark:text-slate-100">{ty.label}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {ty.levels.map((l) => <span key={l} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{LEVEL_LABEL[l]}</span>)}
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', ty.recipient_kind === 'team' ? 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' : 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300')}>{RECIPIENT_LABEL[ty.recipient_kind]}</span>
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">{ty.all_sports ? 'All sports' : ty.sports.map((sp) => sp.name).join(', ')}</span>
                      {!ty.is_active && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">Inactive</span>}
                    </div>
                  </div>
                  {!archived && (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <IconAction icon={Pencil} label={`Edit ${ty.label}`} onClick={() => setEditing(ty)} title="Edit" />
                      {ty.is_active && <IconAction icon={Trash2} danger label={`Delete ${ty.label}`} onClick={() => removeType(ty)} title="Delete" />}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {creating && (
        <AwardTypeFormModal
          sports={eventSports}
          onClose={() => setCreating(false)}
          onSubmit={(body: AwardTypeBody) => saveType(api('POST', ownTypesPath, body))}
        />
      )}
      {editing && (
        <AwardTypeFormModal
          initial={editing}
          sports={eventSports}
          onClose={() => setEditing(null)}
          onSubmit={(body: AwardTypeBody) => saveType(api('PATCH', `${ownTypesPath}/${editing.id}`, body))}
        />
      )}
    </div>
  );
}
