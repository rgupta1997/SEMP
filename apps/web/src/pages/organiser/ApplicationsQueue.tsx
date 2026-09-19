import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi, useApiMutation, useTableControls, fmtDateTime } from '../../lib/hooks';
import { Avatar, Badge, BulkBar, Button, Checkbox, EmptyState, ListToolbar, Modal, Pagination, SearchInput, SortDirButton, StatusBadge, Table, toast , FilterChips} from '../../components/ui';
import { APPLICATION_STATUS, INVITE_BUCKET, INVITE_FILTER_OPTIONS, type InviteFilter } from '../../lib/inviteStatus';

// Organisations that APPLIED to an open championship, and the approve/reject queue
// for them.
//
// No longer a page of its own. It was the "Entrants" tab, which duplicated Setup →
// Invite: both answer "who is in", one from the side of people asking and one from
// the side of people being asked. Splitting them meant an organiser deciding the
// field worked in two places and saw half of it in each. It now renders inside the
// Invite tab, above the invitations.
//
// Never rendered for an internal championship: nobody applies to one, so the queue
// could only ever be empty, and an empty table reads as "nobody yet" rather than as
// "this does not apply here".

// `filter` is controlled by the parent (OrganisationInvites) rather than owned here,
// because the invitations list below shares the same tabs - a host-side "Pending"
// application and a host-sent "Pending" invitation are the same concept from two
// directions, and switching tabs must move both lists together.
export function ApplicationsQueue({
  eventId, filter, onFilterChange, extraCounts, invitesEmpty = true,
}: {
  eventId: string;
  filter: InviteFilter;
  onFilterChange: (f: InviteFilter) => void;
  /** Invitation counts per bucket, folded into the tab pills so a count reflects both halves of the pair. */
  extraCounts?: { pending: number; approved: number; rejected: number };
  /** Whether the invitations list has nothing for the current tab - so the "Nothing here" placeholder only shows when NEITHER half of the pair has anything. */
  invitesEmpty?: boolean;
}) {
  const path = `/championships/${eventId}/enrollments`;
  const { data: rows = [], isLoading } = useApi<any[]>(path);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const review = useApiMutation(
    ({ id, status, rejection_note }: any) => api('PATCH', `/championship-organizations/${id}`, { status, rejection_note }),
    [path],
    () => { setRejecting(null); setNote(''); },
  );
  // Bulk review runs the PATCHes in parallel then refetches once.
  const bulkReview = useApiMutation(
    async ({ ids, status }: { ids: string[]; status: string }) => {
      await Promise.all(ids.map((id) => api('PATCH', `/championship-organizations/${id}`, { status })));
    },
    [path],
    () => setSelected(new Set()),
  );

  const counts = {
    [INVITE_BUCKET.PENDING]: rows.filter((r) => r.status === APPLICATION_STATUS.PENDING).length + (extraCounts?.pending ?? 0),
    [INVITE_BUCKET.APPROVED]: rows.filter((r) => r.status === APPLICATION_STATUS.APPROVED).length + (extraCounts?.approved ?? 0),
    [INVITE_BUCKET.REJECTED]: rows.filter((r) => r.status === APPLICATION_STATUS.REJECTED).length + (extraCounts?.rejected ?? 0),
  };
  const statusFiltered = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

  const t = useTableControls(statusFiltered, {
    search: (r) => `${r.organizations?.name ?? ''} ${r.organizations?.code ?? ''} ${r.organizations?.city ?? ''}`,
    sorts: {
      applied: (a, b) => new Date(a.applied_at).getTime() - new Date(b.applied_at).getTime(),
      name: (a, b) => (a.organizations?.name ?? '').localeCompare(b.organizations?.name ?? ''),
    },
    initialSort: 'applied',
    initialDir: 'desc',
    pageSize: 12,
  });
  const visible = t.view;
  const selectableIds = visible.map((r) => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    if (allSelected) selectableIds.forEach((id) => n.delete(id));
    else selectableIds.forEach((id) => n.add(id));
    return n;
  });

  // Same rule the per-row buttons already follow (`r.status !== 'approved'` etc.) -
  // a bulk action offered "Approve selected" with every selected row already
  // approved, which processed as a real PATCH and toasted "Approved" for
  // organisations that needed nothing done to them. Only the rows a bulk action
  // would actually change go into it, and the button itself hides once no
  // selected row needs that action.
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const toApprove = selectedRows.filter((r) => r.status !== APPLICATION_STATUS.APPROVED).map((r) => r.id);
  const toReject = selectedRows.filter((r) => r.status !== APPLICATION_STATUS.REJECTED).map((r) => r.id);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterChips
          className="mb-0"
          value={filter}
          onChange={(f) => { onFilterChange(f); setSelected(new Set()); }}
          options={INVITE_FILTER_OPTIONS
            .map((f) => ({ key: f, label: <span className="capitalize">{f}</span>, count: f === 'all' ? undefined : counts[f] }))}
        />
        <ListToolbar inline className="ml-auto flex-1 justify-end">
          <SearchInput value={t.query} onChange={t.setQuery} placeholder="Search organization…" className="w-full sm:w-56" />
          <Button size="sm" variant="outline" onClick={() => t.setSortKey(t.sortKey === 'name' ? 'applied' : 'name')}>
            Sort: {t.sortKey === 'name' ? 'Name' : 'Applied'}
          </Button>
          <SortDirButton dir={t.dir} onToggle={() => t.setDir(t.dir === 'asc' ? 'desc' : 'asc')} />
        </ListToolbar>
      </div>

      <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        {toApprove.length > 0 && (
          <Button size="sm" disabled={bulkReview.isPending}
            onClick={() => bulkReview.mutate({ ids: toApprove, status: APPLICATION_STATUS.APPROVED }, { onSuccess: () => toast.success(`${toApprove.length} approved`), onError: (e: any) => toast.error(e.message) })}>
            Approve selected
          </Button>
        )}
        {toReject.length > 0 && (
          <Button size="sm" variant="outline" disabled={bulkReview.isPending}
            onClick={() => bulkReview.mutate({ ids: toReject, status: APPLICATION_STATUS.REJECTED }, { onSuccess: () => toast.success(`${toReject.length} rejected`), onError: (e: any) => toast.error(e.message) })}>
            Reject selected
          </Button>
        )}
      </BulkBar>

      {isLoading ? null : t.total === 0 && invitesEmpty ? (
        <EmptyState icon="✓" title="Nothing here" description={t.query ? 'No organizations match your search.' : filter === INVITE_BUCKET.PENDING ? 'No organizations are waiting for approval.' : `No ${filter} organizations.`} />
      ) : t.total === 0 ? null : (
        <Table>
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 w-px"><Checkbox checked={allSelected} indeterminate={selected.size > 0} onChange={toggleAll} /></th>
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">Applied</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className={`border-t border-slate-100 dark:border-slate-800 ${selected.has(r.id) ? 'bg-brand-50/50' : ''}`}>
                <td className="px-4 py-3"><Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={r.organizations?.name} size={34} />
                    <div>
                      <div className="font-medium text-slate-800 dark:text-slate-200">{r.organizations?.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{[r.organizations?.code, r.organizations?.city].filter(Boolean).join(' · ') || '-'}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">{fmtDateTime(r.applied_at)}</td>
                <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {r.status !== APPLICATION_STATUS.APPROVED && (
                      <Button size="sm" onClick={() => review.mutate({ id: r.id, status: APPLICATION_STATUS.APPROVED })} disabled={review.isPending}>Approve</Button>
                    )}
                    {r.status !== APPLICATION_STATUS.REJECTED && (
                      <Button size="sm" variant="outline" onClick={() => setRejecting(r)}>Reject</Button>
                    )}
                    {r.status === APPLICATION_STATUS.REJECTED && r.rejection_note && <Badge tone="rose">{r.rejection_note}</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {t.total > 0 && <Pagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} />}

      {rejecting && (
        <Modal
          title={`Reject ${rejecting.organizations?.name}`}
          onClose={() => setRejecting(null)}
          banner={(
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-300">Reject application</div>
              <div className="mt-1 truncate text-lg font-bold text-white">{rejecting.organizations?.name}</div>
            </div>
          )}
        >
          <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Optionally tell the organization why so they can fix and reapply.</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Reason (optional)…"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500" />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="danger" disabled={review.isPending}
              onClick={() => review.mutate({ id: rejecting.id, status: APPLICATION_STATUS.REJECTED, rejection_note: note || undefined })}>Reject</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
