import { useState, type ReactNode } from 'react';
import { Flag, Plus, Trash2 } from 'lucide-react';
import { ARCHIVED_READ_ONLY_MESSAGE } from '@semp/shared';
import { useEvent } from './EventLayout';
import { useApiMutation, useTableControls, fmtDate } from '../../lib/hooks';
import { api } from '../../lib/api';
import { Avatar, PillPagination, confirmDialog } from '../../components/ui';
import { PeoplePicker } from '../../components/PeoplePicker';
import { PillButton } from '../../features/schedule/ScheduleParts';
import { Contact, CrewEmpty, CrewHead, CrewPanel, IconAction } from '../../components/CrewPanel';

export interface Official {
  id: string;
  user: { id: string; name: string; email: string; phone?: string };
  assigned_by?: { id: string; name: string };
  assigned_at: string;
  notes?: string;
}

export const officialsPath = (eventId: string) => `/championships/${eventId}/officials`;
// Official · Contact · Assigned · Notes · actions
const GRID = 'minmax(0,1.2fr) minmax(0,1.3fr) 9rem minmax(0,1fr) 2.5rem';

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
      invalidateKeys={[officialsPath(eventId), 'notifications']}
      onAssignUsers={assignUsers}
      onClose={onClose}
    />
  );
}

/** The Officials tab of the organising team page. */
export function OfficialsPanel({ officials, tabs }: { officials: Official[]; tabs: ReactNode }) {
  const { championship, eventId, canManage } = useEvent();
  // Any organiser may add officials - a sport organiser assigns them to their own
  // sport's matches - but the list is shared, so only an overall one removes.
  const archived = !!championship.archived_at;
  const archivedTitle = archived ? ARCHIVED_READ_ONLY_MESSAGE : undefined;
  const [assigning, setAssigning] = useState(false);
  const removeMut = useApiMutation(
    (officialId: string) => api('DELETE', `/championships/${eventId}/officials/${officialId}`),
    [officialsPath(eventId)],
  );
  const t = useTableControls(officials, {
    search: (o) => `${o.user.name} ${o.user.email} ${o.user.phone ?? ''} ${o.notes ?? ''}`,
    sorts: { assigned: (a, b) => new Date(a.assigned_at).getTime() - new Date(b.assigned_at).getTime() },
    initialSort: 'assigned',
    initialDir: 'desc',
    pageSize: 12,
  });
  const existingIds = new Set(officials.map((o) => o.user.id));
  const assign = (
    <PillButton icon={Plus} tone="primary" onClick={() => setAssigning(true)} disabled={archived} title={archivedTitle}>Assign</PillButton>
  );
  const remove = async (o: Official) => {
    if (await confirmDialog({ title: 'Remove official', confirmLabel: 'Remove', message: `Remove ${o.user.name} from this championship?` })) removeMut.mutate(o.id);
  };
  const removeBtn = (o: Official) => (
    <IconAction icon={Trash2} danger label={`Remove ${o.user.name}`} onClick={() => remove(o)}
      disabled={removeMut.isPending || archived || !canManage}
      title={archivedTitle ?? (canManage ? 'Remove' : 'Only an organiser for all sports can remove an official')} />
  );

  return (
    <>
      <CrewPanel tabs={tabs} action={assign}
        search={officials.length ? t.query : undefined} onSearch={officials.length ? t.setQuery : undefined} searchPlaceholder="Search officials…"
        note={'Officials see this championship\'s fixtures in "My Matches" and can score the matches they are assigned. Each championship has its own officials.'}>
        {officials.length === 0 ? (
          <CrewEmpty icon={<Flag size={22} />} title="No officials yet"
            text="Assign officials so they can score matches and run fixtures." action={assign} />
        ) : t.view.length === 0 ? (
          <CrewEmpty icon={<Flag size={22} />} title="Nothing matches" text="No official matches that search." />
        ) : (
          <>
            <CrewHead grid={GRID} cols={['Official', 'Contact', 'Assigned', 'Notes', '']} />
            <ul>
              {t.view.map((o) => (
                <li key={o.id} className="border-t border-slate-100 transition-colors first:border-t-0 hover:bg-slate-50/60 lg:first:border-t dark:border-slate-800 dark:hover:bg-slate-800/30">
                  {/* Desktop: aligned columns. */}
                  <div className="hidden items-center gap-x-4 px-4 py-2.5 lg:grid" style={{ gridTemplateColumns: GRID }}>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={o.user.name} size={32} />
                      <span className="truncate font-semibold text-slate-800 dark:text-slate-100">{o.user.name}</span>
                    </span>
                    <Contact email={o.user.email} phone={o.user.phone} />
                    <span className="min-w-0 text-sm text-slate-600 dark:text-slate-300">
                      {fmtDate(o.assigned_at)}
                      {o.assigned_by && <span className="block truncate text-xs text-slate-400">by {o.assigned_by.name}</span>}
                    </span>
                    <span className="truncate text-sm text-slate-500 dark:text-slate-400" title={o.notes}>{o.notes || '-'}</span>
                    <span className="flex justify-end">{removeBtn(o)}</span>
                  </div>
                  {/* Phone: name over contact and date. */}
                  <div className="flex items-start gap-3 px-4 py-3 lg:hidden">
                    <Avatar name={o.user.name} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-slate-800 dark:text-slate-100">{o.user.name}</span>
                      <Contact email={o.user.email} phone={o.user.phone} />
                      <span className="mt-0.5 block text-xs text-slate-400">Assigned {fmtDate(o.assigned_at)}{o.assigned_by ? ` by ${o.assigned_by.name}` : ''}</span>
                    </span>
                    {removeBtn(o)}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CrewPanel>
      {t.total > t.pageSize && <PillPagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} noun="official" />}
      {assigning && <AssignOfficialModal eventId={eventId} existingIds={existingIds} onClose={() => setAssigning(false)} />}
    </>
  );
}
