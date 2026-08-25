import { useState } from 'react';
import { useEvent } from './EventLayout';
import { useApi, useApiMutation, useTableControls, fmtDate } from '../../lib/hooks';
import { api } from '../../lib/api';
import { Card, Spinner, Button, Avatar, SearchInput, Pagination, ListToolbar, confirmDialog } from '../../components/ui';
import { PeoplePicker } from '../../components/PeoplePicker';

interface Official {
  id: string;
  user: { id: string; name: string; email: string; phone?: string };
  assigned_by?: { id: string; name: string };
  assigned_at: string;
  notes?: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  account_type?: string;
}

// Assign officials by mobile/name, multi-select. A typed number with no existing
// user gets an invite to join, auto-applied when they sign up with that number.
function AssignOfficialModal({ eventId, existingIds, onClose }: { eventId: string; existingIds: Set<string>; onClose: () => void }) {
  const assignUsers = async (userIds: string[]) => { await api('POST', `/championships/${eventId}/officials/bulk`, { user_ids: userIds }); };
  return (
    <PeoplePicker
      title="Assign officials"
      subtitle="Search by phone and pick officials. Unknown numbers get an invite to join."
      assignedUserIds={existingIds}
      assignedLabel="Official"
      invite={{ target_type: 'championship_official', target_id: eventId }}
      // Also refresh the bell - a newly-added official may already be eligible
      // for a pre-existing 'official'-audience notification for this championship.
      invalidateKeys={[`/championships/${eventId}/officials`, 'notifications']}
      onAssignUsers={assignUsers}
      onClose={onClose}
    />
  );
}

export function EventOfficialsPage() {
  const { eventId } = useEvent();
  const { data: officials, isLoading } = useApi<Official[]>(`/championships/${eventId}/officials`);
  const [assigning, setAssigning] = useState(false);
  const removeMut = useApiMutation(
    (officialId: string) => api('DELETE', `/championships/${eventId}/officials/${officialId}`),
    [`/championships/${eventId}/officials`],
  );

  const list = officials ?? [];
  const t = useTableControls(list, {
    search: (o) => `${o.user.name} ${o.user.email} ${o.notes ?? ''}`,
    sorts: {
      name: (a, b) => a.user.name.localeCompare(b.user.name),
      assigned: (a, b) => new Date(a.assigned_at).getTime() - new Date(b.assigned_at).getTime(),
    },
    initialSort: 'assigned',
    initialDir: 'desc',
    pageSize: 12,
  });

  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>;

  const existingIds = new Set(officials?.map((o) => o.user.id) ?? []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Officials</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {officials?.length || 0} officials assigned to this championship
          </p>
        </div>
        <ListToolbar inline>
          {list.length > 0 && <SearchInput value={t.query} onChange={t.setQuery} placeholder="Search officials…" className="w-56" />}
          <Button onClick={() => setAssigning(true)}>+ Assign Official</Button>
        </ListToolbar>
      </div>

      {officials && officials.length > 0 ? (
        <Card className="overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-300">Official</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-300">Contact</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-300">Assigned</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-300">Notes</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {t.view.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar name={o.user.name} size={32} />
                      <span className="font-medium text-slate-900 dark:text-slate-100">{o.user.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-600 dark:text-slate-300">{o.user.email}</div>
                    {o.user.phone && <div className="text-xs text-slate-400 dark:text-slate-500">{o.user.phone}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    <div>{fmtDate(o.assigned_at)}</div>
                    {o.assigned_by && <div className="text-xs text-slate-400 dark:text-slate-500">by {o.assigned_by.name}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{o.notes || '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-600 dark:text-rose-400 hover:bg-rose-50 hover:text-rose-700"
                      onClick={async () => {
                        if (await confirmDialog({ title: 'Remove official', confirmLabel: 'Remove', message: `Remove ${o.user.name} from this championship?` })) {
                          removeMut.mutate(o.id);
                        }
                      }}
                      disabled={removeMut.isPending}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
              {t.total === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">No officials match your search.</td></tr>
              )}
            </tbody>
          </table>
          <div className="px-4 pb-3">
            <Pagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} />
          </div>
        </Card>
      ) : (
        <Card className="p-8 text-center text-slate-500 dark:text-slate-400">
          <div className="text-4xl mb-3">⚑</div>
          <div className="font-medium text-slate-700 dark:text-slate-300 mb-1">No officials assigned yet</div>
          <p className="text-sm mb-4">
            Assign officials to this championship so they can score matches and manage fixtures.
          </p>
          <Button onClick={() => setAssigning(true)}>+ Assign Official</Button>
        </Card>
      )}

      <Card className="bg-slate-50 dark:bg-slate-800/60 p-4">
        <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
          <span className="text-lg">ℹ️</span>
          <span>
            Officials assigned to this championship will see this championship's fixtures in their "My Matches" view and can score assigned matches.
            Each championship has its own set of officials.
          </span>
        </div>
      </Card>

      {assigning && <AssignOfficialModal eventId={eventId} existingIds={existingIds} onClose={() => setAssigning(false)} />}
    </div>
  );
}
