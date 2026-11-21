import { useMemo, useState } from 'react';
import { Crown, Flag, Pencil, Plus, Trash2 } from 'lucide-react';
import { ARCHIVED_READ_ONLY_MESSAGE } from '@semp/shared';
import { useEvent } from './EventLayout';
import { api } from '../../lib/api';
import { useApi, useApiMutation, fmtDate } from '../../lib/hooks';
import { Avatar, Button, cn, confirmDialog, Modal, toast } from '../../components/ui';
import { useUrlState } from '../../components/primitives';
import { Contact, CrewEmpty, CrewHead, CrewPanel, IconAction } from '../../components/CrewPanel';
import { PillButton, SportChips, SportsDecor, TeamSkeleton, ViewTabs } from '../../features/schedule/ScheduleParts';
import { useAuth } from '../../lib/auth';
import { usePermissions } from '../../lib/permissions';
import { PeoplePicker } from '../../components/PeoplePicker';
import { OfficialsPanel, officialsPath, type Official } from './EventOfficialsPage';

interface RoleAssignment {
  id: string;
  assigned_at: string;
  roles: { id: string; name: string };
  /** The sports this organiser runs (catalogue sport ids); empty = all sports. */
  sport_ids?: string[];
  users_user_championship_roles_user_idTousers: { id: string; name: string; email: string; phone?: string | null };
  /** Either whoever the championship was created under, or - when it has one -
   * someone who manages its host organisation's events. Represents the event by default rather
   * than someone the organising team added, so this row has no Remove button
   * (the server refuses to remove it too). */
  is_host: boolean;
}

interface EventSport { id: string; name: string; icon?: string | null }

const CHIP = 'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';
const CHIP_ON = 'border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-500';
const CHIP_OFF = 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';

// "All sports" (the overall organiser) or a chosen set. A sport organiser picks from
// their own sports only and never sees "All sports" - the server refuses both too.
function SportScopePicker({ sports, value, onChange, allowAll }:
  { sports: EventSport[]; value: string[]; onChange: (ids: string[]) => void; allowAll: boolean }) {
  const all = value.length === 0;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="mb-3 space-y-2">
      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">Sports they organise</div>
      <div className="flex flex-wrap gap-2">
        {allowAll && (
          <button type="button" onClick={() => onChange([])} aria-pressed={all} className={`${CHIP} ${all ? CHIP_ON : CHIP_OFF}`}>
            All sports
          </button>
        )}
        {sports.map((sp) => {
          const on = value.includes(sp.id);
          return (
            <button key={sp.id} type="button" onClick={() => toggle(sp.id)} aria-pressed={on} className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}>
              {sp.icon && <span aria-hidden>{sp.icon}</span>}{sp.name}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {all ? 'Overall organiser - runs every sport and the event itself.' : 'Sees the whole championship, but can act only on these sports.'}
      </p>
    </div>
  );
}

// Add team members (co-organisers) by mobile/name, multi-select. A typed number
// with no existing user gets an invite to join, auto-applied when they sign up.
function AddOrganiserModal({ eventId, roleId, assignedIds, sports, defaultSportIds, allowAll, onClose }:
  { eventId: string; roleId: string; assignedIds: Set<string>; sports: EventSport[]; defaultSportIds: string[]; allowAll: boolean; onClose: () => void }) {
  const [sportIds, setSportIds] = useState<string[]>(defaultSportIds);
  const assignUsers = async (userIds: string[]) => {
    if (!allowAll && sportIds.length === 0) throw new Error('Pick at least one sport.');
    await api('POST', `/championships/${eventId}/roles/bulk`, { user_ids: userIds, role_id: roleId, sport_ids: sportIds });
  };
  return (
    <PeoplePicker
      title="Add team members"
      subtitle="Search by phone and pick people to co-organise. Unknown numbers get an invite to join."
      assignedUserIds={assignedIds}
      assignedLabel="Organiser"
      invite={{ target_type: 'championship_organiser', target_id: eventId, sport_ids: sportIds }}
      roleControl={<SportScopePicker sports={sports} value={sportIds} onChange={setSportIds} allowAll={allowAll} />}
      // Also refresh the bell - a newly-added organiser may already be eligible
      // for a pre-existing 'organiser'-audience notification for this championship.
      invalidateKeys={[`/championships/${eventId}/roles`, 'notifications']}
      onAssignUsers={assignUsers}
      onClose={onClose}
    />
  );
}

function EditSportsModal({ eventId, row, sports, allowAll, onClose }:
  { eventId: string; row: RoleAssignment; sports: EventSport[]; allowAll: boolean; onClose: () => void }) {
  const [sportIds, setSportIds] = useState<string[]>(row.sport_ids ?? []);
  const save = useApiMutation(
    () => api('PATCH', `/championships/${eventId}/roles/${row.id}`, { sport_ids: sportIds }),
    [`/championships/${eventId}/roles`],
  );
  return (
    <Modal
      title={`Sports for ${row.users_user_championship_roles_user_idTousers?.name ?? 'organiser'}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={save.isPending || (!allowAll && sportIds.length === 0)}
            onClick={async () => {
              try { await save.mutateAsync(undefined); toast.success('Sports updated'); onClose(); }
              catch (e: any) { toast.error(e.message); }
            }}
          >Save</Button>
        </>
      )}
    >
      <SportScopePicker sports={sports} value={sportIds} onChange={setSportIds} allowAll={allowAll} />
    </Modal>
  );
}

type Tab = 'organisers' | 'officials';
// Organiser · Sports · Contact · Added · actions
const GRID = 'minmax(0,1.5fr) minmax(0,1.4fr) minmax(0,1.3fr) 6.5rem 4.5rem';
const SPORT_TAG = 'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold';

/** Faces shown in the hero before "+N". */
const MAX_FACES = 8;

/** Who runs the event: organisers and officials, and how well the sports are covered. */
function TeamHero({ organisers, officials, overall, covered, sportsTotal, faces }: {
  organisers: number; officials: number; overall: number; covered: number; sportsTotal: number; faces: string[];
}) {
  const people = organisers + officials;
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 text-white shadow-sm">
      <SportsDecor />
      <div className="relative flex flex-col gap-5 p-4 sm:p-5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">Organising team</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-black tabular-nums">{people}</span>
            <span className="text-sm font-semibold text-white/80">{people === 1 ? 'person' : 'people'} running this event</span>
          </div>
          <p className="mt-0.5 text-sm font-semibold text-white/85">
            {organisers} organiser{organisers === 1 ? '' : 's'} · {officials} official{officials === 1 ? '' : 's'}
          </p>
          {sportsTotal > 0 && (
            <>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/20 md:w-72" aria-hidden>
                <div className="h-full rounded-full bg-emerald-300 transition-all" style={{ width: `${(covered / sportsTotal) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-white/70">{covered} of {sportsTotal} sports have their own organiser</p>
            </>
          )}
        </div>
        <div className="flex flex-col gap-3 md:items-end">
          {faces.length > 0 && (
            <div className="flex items-center" aria-label={`${faces.length} people`}>
              {faces.slice(0, MAX_FACES).map((n, i) => (
                <span key={i} title={n} className="-ml-2 rounded-full ring-2 ring-brand-700 first:ml-0"><Avatar name={n} size={36} /></span>
              ))}
              {faces.length > MAX_FACES && (
                <span className="-ml-2 grid h-9 w-9 place-items-center rounded-full bg-white/15 text-[11px] font-black ring-2 ring-brand-700 backdrop-blur">+{faces.length - MAX_FACES}</span>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2 md:justify-end">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-semibold ring-1 ring-white/15">
              <span className="h-2 w-2 rounded-full bg-sky-300" aria-hidden />Run every sport<span className="rounded-full bg-white/15 px-1.5 text-[11px] font-black tabular-nums">{overall}</span>
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-semibold ring-1 ring-white/15">
              <span className="h-2 w-2 rounded-full bg-emerald-300" aria-hidden />Sport organisers<span className="rounded-full bg-white/15 px-1.5 text-[11px] font-black tabular-nums">{organisers - overall}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function EventOrganisersPage() {
  const { championship, eventId } = useEvent();
  // Refused by the server too; disabled here so nobody picks people first.
  const archived = !!championship.archived_at;
  const archivedTitle = archived ? ARCHIVED_READ_ONLY_MESSAGE : undefined;
  const { data: roles = [], isLoading } = useApi<RoleAssignment[]>(`/championships/${eventId}/roles`);
  const { data: officials = [], isLoading: officialsLoading } = useApi<Official[]>(officialsPath(eventId));
  const { data: allRoles = [] } = useApi<any[]>('/roles');
  const { data: draws = [] } = useApi<any[]>(`/championships/${eventId}/draws`);
  const { ctx } = useAuth();
  const { organiserScope } = usePermissions();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RoleAssignment | null>(null);
  const [tabRaw, setTab] = useUrlState<string>('tab', 'organisers');
  const tab: Tab = tabRaw === 'officials' ? 'officials' : 'organisers';
  const [search, setSearch] = useState('');
  const [sportParam, setSportParam] = useUrlState<string>('sport', '');
  const pickedSports = useMemo(() => (sportParam ? sportParam.split(',') : []), [sportParam]);

  // The event's sports, from its draws. A sport organiser is offered only their own.
  const eventSports = useMemo(() => {
    const byId = new Map<string, EventSport>();
    for (const d of draws) {
      const sp = d.tournament_sports?.sports;
      if (sp?.id) byId.set(sp.id, { id: sp.id, name: sp.name, icon: sp.icon ?? null });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [draws]);
  const sportById = useMemo(() => new Map(eventSports.map((sp) => [sp.id, sp])), [eventSports]);
  const myScope = organiserScope(eventId);
  const overall = myScope === 'all';
  const mySports = overall ? eventSports : eventSports.filter((sp) => (myScope ?? []).includes(sp.id));
  // Mirrors assertMayGrantSports on the server: an overall organiser manages every
  // row; a sport organiser only rows already inside their own sports.
  const mayManageRow = (r: RoleAssignment) => {
    if (overall) return true;
    const ids = r.sport_ids ?? [];
    return ids.length > 0 && ids.every((id) => (myScope ?? []).includes(id));
  };
  const removeMut = useApiMutation(
    (assignmentId: string) => api('DELETE', `/championships/${eventId}/roles/${assignmentId}`),
    [`/championships/${eventId}/roles`],
  );

  // The platform Organiser row; an institution's own copy only if there is no other.
  const organiserRoleId = (allRoles.find((r) => r.code === 'organiser' && !r.organization_id)
    ?? allRoles.find((r) => r.name === 'Organiser'))?.id;
  const organisers = roles.filter((r) => r.roles?.name === 'Organiser');
  const assignedIds = new Set(organisers.map((r) => r.users_user_championship_roles_user_idTousers?.id).filter(Boolean));
  const isOverall = (r: RoleAssignment) => (r.sport_ids?.length ?? 0) === 0;

  // Sport chips, counted in the organisers dedicated to each sport.
  const chipSports = eventSports.map((sp) => ({
    id: sp.id, name: sp.name, icon: sp.icon, live: 0,
    total: organisers.filter((r) => r.sport_ids?.includes(sp.id)).length,
  }));

  const q = search.trim().toLowerCase();
  const shown = organisers.filter((r) => {
    // A sport filter keeps that sport's organisers and the ones who run everything.
    if (pickedSports.length && !isOverall(r) && !r.sport_ids!.some((id) => pickedSports.includes(id))) return false;
    if (!q) return true;
    const u = r.users_user_championship_roles_user_idTousers;
    const sports = (r.sport_ids ?? []).map((id) => sportById.get(id)?.name ?? '').join(' ');
    return `${u?.name} ${u?.email} ${u?.phone ?? ''} ${sports}`.toLowerCase().includes(q);
  });

  if (isLoading || officialsLoading) return <TeamSkeleton />;

  const tabs = (
    <ViewTabs size="sm" value={tab} onChange={(v) => { setTab(v); setSearch(''); }}
      options={[
        { value: 'organisers', label: 'Organisers', icon: Crown, badge: <TabCount n={organisers.length} on={tab === 'organisers'} /> },
        { value: 'officials', label: 'Officials', icon: Flag, badge: <TabCount n={officials.length} on={tab === 'officials'} /> },
      ]} />
  );
  const addBtn = (
    <PillButton icon={Plus} tone="primary" onClick={() => setAdding(true)} disabled={!organiserRoleId || archived} title={archivedTitle}>Add</PillButton>
  );
  const sportsCell = (r: RoleAssignment) => (
    <span className="flex min-w-0 flex-wrap gap-1">
      {isOverall(r)
        ? <span className={cn(SPORT_TAG, 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200')}>All sports</span>
        : r.sport_ids!.map((id) => {
          const sp = sportById.get(id);
          return (
            <span key={id} className={cn(SPORT_TAG, 'gap-1 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>
              {sp?.icon && <span aria-hidden>{sp.icon}</span>}{sp?.name ?? 'Removed sport'}
            </span>
          );
        })}
    </span>
  );
  const actions = (r: RoleAssignment) => {
    const u = r.users_user_championship_roles_user_idTousers;
    return (
      <span className="flex shrink-0 items-center justify-end gap-0.5">
        {!r.is_host && mayManageRow(r) && u?.id !== ctx?.user.id && (
          <IconAction icon={Pencil} label={`Change sports for ${u?.name}`} onClick={() => setEditing(r)} disabled={archived} title={archivedTitle ?? 'Change sports'} />
        )}
        {!r.is_host && mayManageRow(r) && (
          <IconAction icon={Trash2} danger label={`Remove ${u?.name}`} disabled={removeMut.isPending || archived} title={archivedTitle ?? 'Remove'}
            onClick={async () => {
              if (await confirmDialog({ title: 'Remove organiser', confirmLabel: 'Remove', message: `Remove ${u?.name} from this championship's organising team?` })) removeMut.mutate(r.id);
            }} />
        )}
      </span>
    );
  };
  const nameTags = (r: RoleAssignment) => (
    <>
      {r.is_host && <span title="This championship's default organiser - can't be removed" className={cn(SPORT_TAG, 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200')}>Host</span>}
      {r.users_user_championship_roles_user_idTousers?.id === ctx?.user.id && <span className={cn(SPORT_TAG, 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400')}>You</span>}
    </>
  );

  return (
    <div className="space-y-5">
      <TeamHero organisers={organisers.length} officials={officials.length} overall={organisers.filter(isOverall).length}
        covered={chipSports.filter((s) => s.total > 0).length} sportsTotal={eventSports.length}
        faces={[...organisers.map((r) => r.users_user_championship_roles_user_idTousers?.name ?? ''), ...officials.map((o) => o.user.name)]} />

      {tab === 'organisers' && (
        <SportChips sports={chipSports} value={pickedSports} onChange={(ids) => setSportParam(ids.join(','))} label="Organisers for" />
      )}

      {tab === 'officials' ? <OfficialsPanel officials={officials} tabs={tabs} /> : (
        <CrewPanel tabs={tabs} action={addBtn}
          search={organisers.length ? search : undefined} onSearch={organisers.length ? setSearch : undefined} searchPlaceholder="Search organisers…"
          note={<>An organiser for <b className="font-semibold">all sports</b> runs the whole championship: setup, approvals, officials and schedule. One limited to some sports sees everything but acts only on those sports. Invite organisations from the Invite tab.</>}>
          {organisers.length === 0 ? (
            <CrewEmpty icon={<Crown size={22} />} title="No co-organisers yet" text="Add teammates so more than one person can run this championship." action={addBtn} />
          ) : shown.length === 0 ? (
            <CrewEmpty icon={<Crown size={22} />} title="Nothing matches" text="No organiser matches that search or sport." />
          ) : (
            <>
              <CrewHead grid={GRID} cols={['Organiser', 'Sports', 'Contact', 'Added', '']} />
              <ul>
                {shown.map((r) => {
                  const u = r.users_user_championship_roles_user_idTousers;
                  return (
                    <li key={r.id} className="border-t border-slate-100 transition-colors first:border-t-0 hover:bg-slate-50/60 lg:first:border-t dark:border-slate-800 dark:hover:bg-slate-800/30">
                      {/* Desktop: aligned columns. */}
                      <div className="hidden items-center gap-x-4 px-4 py-2.5 lg:grid" style={{ gridTemplateColumns: GRID }}>
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={u?.name} size={32} />
                          {/* Tags sit under the name so they never squeeze it. */}
                          <span className="min-w-0">
                            <span className="block break-words font-semibold leading-snug text-slate-800 dark:text-slate-100">{u?.name}</span>
                            {(r.is_host || u?.id === ctx?.user.id) && <span className="mt-0.5 flex gap-1">{nameTags(r)}</span>}
                          </span>
                        </span>
                        {sportsCell(r)}
                        <Contact email={u?.email} phone={u?.phone} />
                        <span className="text-sm text-slate-500 dark:text-slate-400">{fmtDate(r.assigned_at)}</span>
                        {actions(r)}
                      </div>
                      {/* Phone: name and tags, then sports, then contact. */}
                      <div className="flex items-start gap-3 px-4 py-3 lg:hidden">
                        <Avatar name={u?.name} size={36} />
                        <span className="min-w-0 flex-1 space-y-1">
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="break-words font-semibold text-slate-800 dark:text-slate-100">{u?.name}</span>
                            {nameTags(r)}
                          </span>
                          {sportsCell(r)}
                          <Contact email={u?.email} phone={u?.phone} />
                        </span>
                        {actions(r)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CrewPanel>
      )}

      {adding && organiserRoleId && (
        <AddOrganiserModal
          eventId={eventId} roleId={organiserRoleId} assignedIds={assignedIds}
          sports={mySports} allowAll={overall}
          defaultSportIds={overall ? [] : mySports.map((sp) => sp.id)}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <EditSportsModal eventId={eventId} row={editing} sports={mySports} allowAll={overall} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function TabCount({ n, on }: { n: number; on: boolean }) {
  return <span className={cn('rounded-full px-1.5 text-[11px] font-bold tabular-nums', on ? 'bg-white/20' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400')}>{n}</span>;
}
