import { useState } from 'react';
import { useEvent } from './EventLayout';
import { api } from '../../lib/api';
import { useApi, useApiMutation, useTableControls, fmtDateTime } from '../../lib/hooks';
import { Avatar, Badge, BulkBar, Button, Checkbox, EmptyState, ListToolbar, Modal, Pagination, SearchInput, SortDirButton, StatusBadge, Table, toast } from '../../components/ui';

export function ApprovalsPage() {
  const { eventId } = useEvent();
  const path = `/championships/${eventId}/enrollments`;
  const { data: rows = [], isLoading } = useApi<any[]>(path);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
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
    pending: rows.filter((r) => r.status === 'pending').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
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

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
          <button key={f} onClick={() => { setFilter(f); setSelected(new Set()); }}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold capitalize ${filter === f ? 'bg-brand-500 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-1 ring-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
            {f}{f !== 'all' && counts[f] ? ` · ${counts[f]}` : ''}
          </button>
        ))}
        <ListToolbar inline className="ml-auto flex-1 justify-end">
          <SearchInput value={t.query} onChange={t.setQuery} placeholder="Search organization…" className="w-full sm:w-56" />
          <Button size="sm" variant="outline" onClick={() => t.setSortKey(t.sortKey === 'name' ? 'applied' : 'name')}>
            Sort: {t.sortKey === 'name' ? 'Name' : 'Applied'}
          </Button>
          <SortDirButton dir={t.dir} onToggle={() => t.setDir(t.dir === 'asc' ? 'desc' : 'asc')} />
        </ListToolbar>
      </div>

      <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button size="sm" disabled={bulkReview.isPending}
          onClick={() => bulkReview.mutate({ ids: [...selected], status: 'approved' }, { onSuccess: () => toast.success(`${selected.size} approved`), onError: (e: any) => toast.error(e.message) })}>
          Approve selected
        </Button>
        <Button size="sm" variant="outline" disabled={bulkReview.isPending}
          onClick={() => bulkReview.mutate({ ids: [...selected], status: 'rejected' }, { onSuccess: () => toast.success(`${selected.size} rejected`), onError: (e: any) => toast.error(e.message) })}>
          Reject selected
        </Button>
      </BulkBar>

      {isLoading ? null : t.total === 0 ? (
        <EmptyState icon="✓" title="Nothing here" description={t.query ? 'No organizations match your search.' : filter === 'pending' ? 'No organizations are waiting for approval.' : `No ${filter} organizations.`} />
      ) : (
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
                      <div className="text-xs text-slate-500 dark:text-slate-400">{[r.organizations?.code, r.organizations?.city].filter(Boolean).join(' · ') || '—'}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">{fmtDateTime(r.applied_at)}</td>
                <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {r.status !== 'approved' && (
                      <Button size="sm" onClick={() => review.mutate({ id: r.id, status: 'approved' })} disabled={review.isPending}>Approve</Button>
                    )}
                    {r.status !== 'rejected' && (
                      <Button size="sm" variant="outline" onClick={() => setRejecting(r)}>Reject</Button>
                    )}
                    {r.status === 'rejected' && r.rejection_note && <Badge tone="rose">{r.rejection_note}</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {t.total > 0 && <Pagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} />}

      {rejecting && (
        <Modal title={`Reject ${rejecting.organizations?.name}`} onClose={() => setRejecting(null)}>
          <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Optionally tell the organization why so they can fix and reapply.</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Reason (optional)…"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500" />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="danger" disabled={review.isPending}
              onClick={() => review.mutate({ id: rejecting.id, status: 'rejected', rejection_note: note || undefined })}>Reject</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
