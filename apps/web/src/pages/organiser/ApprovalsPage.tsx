import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useEvent } from './EventLayout';
import { api } from '../../lib/api';
import { useApi, useApiMutation, useTableControls, fmtDateTime } from '../../lib/hooks';
import { Avatar, Badge, BulkBar, Button, Checkbox, EmptyState, ListToolbar, Modal, Pagination, SearchInput, SortDirButton, StatusBadge, Table, Textarea, confirmDialog, toast } from '../../components/ui';

// One decision applied to a whole selection. The server decides each enrolment in
// its own transaction and answers per row, so a batch reports what actually
// happened rather than collapsing to a single success or failure.
interface BulkReviewResponse {
  results: { enrollment_id: string; ok: boolean; error?: string }[];
  reviewed: number;
  failed: number;
}

export function ApprovalsPage() {
  const { eventId } = useEvent();
  const qc = useQueryClient();
  const path = `/championships/${eventId}/enrollments`;
  const { data: rows = [], isLoading } = useApi<any[]>(path);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  // One dialog for both routes into a rejection: the rows being declined.
  const [rejecting, setRejecting] = useState<any[] | null>(null);
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const review = useApiMutation(
    ({ id, status, rejection_note }: any) => api('PATCH', `/championship-organizations/${id}`, { status, rejection_note }),
    [path],
    () => { setRejecting(null); setNote(''); },
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
  // Only an undecided application can be swept up in a bulk decision - re-deciding
  // one that already has an outcome is a single, deliberate act.
  const selectableIds = visible.filter((r) => r.status === 'pending').map((r) => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    if (allSelected) selectableIds.forEach((id) => n.delete(id));
    else selectableIds.forEach((id) => n.add(id));
    return n;
  });

  // Shared by the bulk bar and the reject dialog: one request, a per-row answer.
  const runBulk = async (ids: string[], status: 'approved' | 'rejected', rejection_note?: string) => {
    setBulkBusy(true);
    try {
      const res = await api<BulkReviewResponse>('PATCH', '/championship-organizations/bulk', { ids, status, rejection_note });
      const verb = status === 'approved' ? 'approved' : 'rejected';
      if (res.failed === 0) toast.success(`${res.reviewed} ${verb}`);
      else toast.error(`${res.reviewed} ${verb}, ${res.failed} could not be`, res.results.find((r) => !r.ok)?.error);
      setSelected(new Set());
      return true;
    } catch (e: any) {
      toast.error(e.message);
      return false;
    } finally { setBulkBusy(false); }
  };

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const rejectCount = rejecting?.length ?? 0;
  const noteTooShort = note.trim().length < 5;

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
        <Button size="sm" disabled={bulkBusy}
          onClick={async () => {
            const ok = await confirmDialog({
              title: `Approve ${selected.size} application${selected.size === 1 ? '' : 's'}?`,
              message: 'Each organization is told it can now enter teams.',
              confirmLabel: 'Approve them',
            });
            if (ok) await runBulk([...selected], 'approved');
          }}>
          {bulkBusy ? 'Working…' : 'Approve selected'}
        </Button>
        <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => { setNote(''); setRejecting(selectedRows); }}>
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
                <td className="px-4 py-3">
                  {r.status === 'pending' && <Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}
                </td>
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
                    {r.status !== 'approved' && (
                      <Button size="sm" onClick={() => review.mutate({ id: r.id, status: 'approved' })} disabled={review.isPending}>Approve</Button>
                    )}
                    {r.status !== 'rejected' && (
                      <Button size="sm" variant="outline" onClick={() => { setNote(''); setRejecting([r]); }}>Reject</Button>
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
        <Modal
          title={rejectCount === 1 ? `Reject ${rejecting[0].organizations?.name}` : `Reject ${rejectCount} applications`}
          onClose={() => setRejecting(null)}
        >
          {/* The note is required, not a courtesy: a bare "rejected" tells an
              applicant nothing they can act on, and this is the only message they get. */}
          <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
            Tell {rejectCount === 1 ? 'the organization' : 'these organizations'} why. The note is shown to them on their
            applications list, so they can fix it and reapply.
          </p>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
            placeholder="e.g. Entries closed before this application arrived" />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="danger" disabled={review.isPending || bulkBusy || noteTooShort}
              onClick={async () => {
                if (rejectCount === 1) {
                  review.mutate({ id: rejecting[0].id, status: 'rejected', rejection_note: note.trim() });
                  return;
                }
                const ok = await runBulk(rejecting.map((r) => r.id), 'rejected', note.trim());
                if (ok) { setRejecting(null); setNote(''); }
              }}>
              {rejectCount === 1 ? 'Reject' : `Reject ${rejectCount}`}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
