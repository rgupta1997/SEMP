import { useMemo, useState } from 'react';
import { useEvent } from './EventLayout';
import { api } from '../../lib/api';
import { useApi, useApiMutation, fmtDate } from '../../lib/hooks';
import { Avatar, Button, Card, EmptyState, Modal, SearchInput, Spinner, toast } from '../../components/ui';
import { UserFormModal, type UserFormBody } from '../../components/UserFormModal';
import { EventOfficialsPage } from './EventOfficialsPage';

interface RoleAssignment {
  id: string;
  assigned_at: string;
  roles: { id: string; name: string };
  users_user_championship_roles_user_idTousers: { id: string; name: string; email: string; phone?: string | null };
}

// Pick an existing user (by name/email) or create a brand-new organiser login,
// then grant them the championship's Organiser role.
function AddOrganiserModal({ eventId, roleId, assignedIds, onClose }:
  { eventId: string; roleId: string; assignedIds: Set<string>; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const { data: users = [], isLoading } = useApi<any[]>('/users');

  const assign = useApiMutation(
    (userId: string) => api('POST', `/championships/${eventId}/roles`, { user_id: userId, role_id: roleId }),
    [`/championships/${eventId}/roles`],
  );

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => !assignedIds.has(u.id))
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .slice(0, 50);
  }, [users, assignedIds, search]);

  if (creating) {
    return (
      <UserFormModal
        title="New organiser"
        submitLabel="Create & add"
        onClose={() => setCreating(false)}
        onSubmit={async (body: UserFormBody) => {
          const u = await api<any>('POST', '/users', body);
          await assign.mutateAsync(u.id);
          onClose();
        }}
      />
    );
  }

  return (
    <Modal title="Add co-organiser" onClose={onClose}>
      <div className="mb-3 flex items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search users by name or email…" className="w-full" />
      </div>
      {isLoading ? <Spinner /> : (
        <div className="max-h-64 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
          {candidates.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">No matching users. Create a new organiser below.</p>
          ) : candidates.map((u) => (
            <div key={u.id} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-3 py-2 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/60">
              <div className="flex items-center gap-2">
                <Avatar name={u.name} size={28} />
                <div>
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{u.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div>
                </div>
              </div>
              <Button size="sm" variant="outline" disabled={assign.isPending}
                onClick={() => assign.mutate(u.id, { onSuccess: () => { toast.success(`${u.name} added as organiser`); onClose(); }, onError: (e: any) => toast.error(e.message) })}>
                Add
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-between">
        <Button variant="outline" onClick={() => setCreating(true)}>+ Create new organiser</Button>
        <Button variant="ghost" onClick={onClose}>Done</Button>
      </div>
    </Modal>
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
        <Button onClick={() => setAdding(true)} disabled={!organiserRoleId}>+ Add organiser</Button>
      </div>

      {organisers.length === 0 ? (
        <EmptyState icon="⚿" title="No co-organisers yet" description="Add teammates so more than one person can run this championship." />
      ) : (
        <Card className="overflow-hidden">
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
        Co-organisers share full control of this championship — its setup, approvals, officials and schedule.
        Need an organization in the master list? Add it from <span className="font-medium">Approvals</span>; assign officials in the section below.
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
