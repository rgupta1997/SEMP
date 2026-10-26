import { useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { ARCHIVED_READ_ONLY_MESSAGE } from '@semp/shared';
import { useEvent } from './EventLayout';
import { api } from '../../lib/api';
import { useApi, useApiMutation, fmtDate } from '../../lib/hooks';
import { Avatar, Badge, Button, Card, confirmDialog, EmptyState, Modal, PHONE_COMPACT_BUTTON, Spinner, toast } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { usePermissions } from '../../lib/permissions';
import { PeoplePicker } from '../../components/PeoplePicker';
import { EventOfficialsPage } from './EventOfficialsPage';

interface RoleAssignment {
  id: string;
  assigned_at: string;
  roles: { id: string; name: string };
  /** The sports this organiser runs (catalogue sport ids); empty = all sports. */
  sport_ids?: string[];
  users_user_championship_roles_user_idTousers: { id: string; name: string; email: string; phone?: string | null };
  /** Either whoever the championship was created under, or - when it has one -
   * a member of its host organisation. Represents the event by default rather
   * than someone the organising team added, so this row has no Remove button
   * (the server refuses to remove it too). */
  is_host: boolean;
}

interface EventSport { id: string; name: string }

const CHIP = 'rounded-full border px-3 py-1 text-sm';
const CHIP_ON = 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300';
const CHIP_OFF = 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300';

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
              {sp.name}
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

export function EventOrganisersPage() {
  const { championship, eventId } = useEvent();
  // Refused by the server too; disabled here so nobody picks people first.
  const archived = !!championship.archived_at;
  const archivedTitle = archived ? ARCHIVED_READ_ONLY_MESSAGE : undefined;
  const { data: roles = [], isLoading } = useApi<RoleAssignment[]>(`/championships/${eventId}/roles`);
  const { data: allRoles = [] } = useApi<any[]>('/roles');
  const { data: draws = [] } = useApi<any[]>(`/championships/${eventId}/draws`);
  const { ctx } = useAuth();
  const { organiserScope } = usePermissions();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RoleAssignment | null>(null);

  // The event's sports, from its draws. A sport organiser is offered only their own.
  const eventSports = useMemo(() => {
    const byId = new Map<string, EventSport>();
    for (const d of draws) {
      const sp = d.tournament_sports?.sports;
      if (sp?.id) byId.set(sp.id, { id: sp.id, name: sp.name });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [draws]);
  const sportName = useMemo(() => new Map(eventSports.map((sp) => [sp.id, sp.name])), [eventSports]);
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

  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Organising team</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{organisers.length} organiser{organisers.length === 1 ? '' : 's'} on this championship.</p>
        </div>
        <Button className={PHONE_COMPACT_BUTTON} onClick={() => setAdding(true)} disabled={!organiserRoleId || archived} title={archivedTitle}>+ Add team members</Button>
      </div>

      {organisers.length === 0 ? (
        <EmptyState icon="⚿" title="No co-organisers yet" description="Add teammates so more than one person can run this championship." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left">
              <tr>
                <th className="px-4 py-2 font-semibold text-slate-600 dark:text-slate-300">Organiser</th>
                <th className="px-4 py-2 font-semibold text-slate-600 dark:text-slate-300">Sports</th>
                <th className="px-4 py-2 font-semibold text-slate-600 dark:text-slate-300">Contact</th>
                <th className="px-4 py-2 font-semibold text-slate-600 dark:text-slate-300">Added</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {organisers.map((r) => {
                const u = r.users_user_championship_roles_user_idTousers;
                return (
                  <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2"><Avatar name={u?.name} size={28} /><span className="font-medium text-slate-800 dark:text-slate-200">{u?.name}</span></div>
                    </td>
                    <td className="px-4 py-2">
                      {(r.sport_ids?.length ?? 0) === 0 ? (
                        <Badge tone="brand">All sports</Badge>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.sport_ids!.map((id) => <Badge key={id}>{sportName.get(id) ?? 'Removed sport'}</Badge>)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                      <div>{u?.email}</div>
                      {u?.phone && <div className="text-xs text-slate-400 dark:text-slate-500">{u.phone}</div>}
                    </td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{fmtDate(r.assigned_at)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {!r.is_host && mayManageRow(r) && u?.id !== ctx?.user.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(r)}
                          disabled={archived}
                          aria-label={`Change sports for ${u?.name}`}
                          title={archivedTitle ?? 'Change sports'}
                        >
                          <Pencil size={14} />
                        </Button>
                      )}
                      {r.is_host ? (
                        <span className="text-xs text-slate-400 dark:text-slate-500" title="This championship's default organiser - can't be removed">Host</span>
                      ) : mayManageRow(r) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400"
                          onClick={async () => {
                            if (await confirmDialog({ title: 'Remove organiser', confirmLabel: 'Remove', message: `Remove ${u?.name} from this championship's organising team?` })) {
                              removeMut.mutate(r.id);
                            }
                          }}
                          disabled={removeMut.isPending || archived}
                          aria-label={`Remove ${u?.name}`}
                          title={archivedTitle ?? 'Remove'}
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="bg-slate-50 dark:bg-slate-800/60 p-4 text-sm text-slate-600 dark:text-slate-300">
        An organiser for <span className="font-medium">all sports</span> runs the whole championship - its setup, approvals, officials and schedule.
        One limited to some sports sees everything but acts only on those sports: their draws, schedule, officials and scoring.
        Invite participating organizations from the <span className="font-medium">Invite</span> tab; assign officials in the section below.
      </Card>

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

      <div className="border-t border-slate-200 dark:border-slate-800 pt-8">
        <EventOfficialsPage />
      </div>
    </div>
  );
}
