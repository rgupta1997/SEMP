import { useState } from 'react';
import { useEvent } from './EventLayout';
import { api } from '../../lib/api';
import { useApi, fmtDate } from '../../lib/hooks';
import { Avatar, Button, Card, EmptyState, Spinner } from '../../components/ui';
import { PeoplePicker } from '../../components/PeoplePicker';
import { EventOfficialsPage } from './EventOfficialsPage';

interface RoleAssignment {
  id: string;
  assigned_at: string;
  roles: { id: string; name: string };
  users_user_championship_roles_user_idTousers: { id: string; name: string; email: string; phone?: string | null };
}

// Add team members (co-organisers) by mobile/name, multi-select. A typed number
// with no existing user gets an invite to join, auto-applied when they sign up.
function AddOrganiserModal({ eventId, roleId, assignedIds, onClose }:
  { eventId: string; roleId: string; assignedIds: Set<string>; onClose: () => void }) {
  const assignUsers = async (userIds: string[]) => { await api('POST', `/championships/${eventId}/roles/bulk`, { user_ids: userIds, role_id: roleId }); };
  return (
    <PeoplePicker
      title="Add team members"
      subtitle="Search by phone and pick people to co-organise. Unknown numbers get an invite to join."
      assignedUserIds={assignedIds}
      assignedLabel="Organiser"
      invite={{ target_type: 'championship_organiser', target_id: eventId }}
      // Also refresh the bell - a newly-added organiser may already be eligible
      // for a pre-existing 'organiser'-audience notification for this championship.
      invalidateKeys={[`/championships/${eventId}/roles`, 'notifications']}
      onAssignUsers={assignUsers}
      onClose={onClose}
    />
  );
}

export function EventOrganisersPage() {
  const { eventId } = useEvent();
  const { data: roles = [], isLoading } = useApi<RoleAssignment[]>(`/championships/${eventId}/roles`);
  const { data: allRoles = [] } = useApi<any[]>('/roles');
  const [adding, setAdding] = useState(false);

  const organiserRoleId = allRoles.find((r) => r.name === 'Organiser')?.id;
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
        <Button onClick={() => setAdding(true)} disabled={!organiserRoleId}>+ Add team members</Button>
      </div>

      {organisers.length === 0 ? (
        <EmptyState icon="⚿" title="No co-organisers yet" description="Add teammates so more than one person can run this championship." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left">
              <tr>
                <th className="px-4 py-2 font-semibold text-slate-600 dark:text-slate-300">Organiser</th>
                <th className="px-4 py-2 font-semibold text-slate-600 dark:text-slate-300">Contact</th>
                <th className="px-4 py-2 font-semibold text-slate-600 dark:text-slate-300">Added</th>
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
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                      <div>{u?.email}</div>
                      {u?.phone && <div className="text-xs text-slate-400 dark:text-slate-500">{u.phone}</div>}
                    </td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{fmtDate(r.assigned_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="bg-slate-50 dark:bg-slate-800/60 p-4 text-sm text-slate-600 dark:text-slate-300">
        Co-organisers share full control of this championship - its setup, approvals, officials and schedule.
        Invite participating organizations from the <span className="font-medium">Invite</span> tab; assign officials in the section below.
      </Card>

      {adding && organiserRoleId && (
        <AddOrganiserModal eventId={eventId} roleId={organiserRoleId} assignedIds={assignedIds} onClose={() => setAdding(false)} />
      )}

      <div className="border-t border-slate-200 dark:border-slate-800 pt-8">
        <EventOfficialsPage />
      </div>
    </div>
  );
}
