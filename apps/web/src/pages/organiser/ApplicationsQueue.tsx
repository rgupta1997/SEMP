import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, CheckCircle2, X } from 'lucide-react';
import { PillButton, TeamAvatar } from '../../features/schedule/ScheduleParts';
import { HEAD_ROW } from '../../components/GroupTables';
import { ARCHIVED_READ_ONLY_MESSAGE } from '@semp/shared';
import { api } from '../../lib/api';
import { useApi, useApiMutation, useTableControls, fmtDateTime } from '../../lib/hooks';
import { BulkBar, Button, Checkbox, EmptyState, Modal, PillPagination, SearchInput, StatusBadge, cn, toast, FilterChips } from '../../components/ui';
import { APPLICATION_STATUS, INVITE_BUCKET, INVITE_FILTER_OPTIONS, type InviteFilter } from '../../lib/inviteStatus';

// Select · Organisation · Applied · Status · Actions
const APP_GRID = '1.25rem minmax(0,1.6fr) 8.5rem minmax(0,1fr) 13rem';

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
  eventId, filter, onFilterChange, extraCounts, invitesEmpty = true, readOnly = false,
}: {
  eventId: string;
  /** Archived event: applications can be seen, not approved or rejected. */
  readOnly?: boolean;
  filter: InviteFilter;
  onFilterChange: (f: InviteFilter) => void;
  /** Invitation counts per bucket, folded into the tab pills so a count reflects both halves of the pair. */
  extraCounts?: { pending: number; approved: number; rejected: number };
  /** Whether the invitations list has nothing for the current tab - so the "Nothing here" placeholder only shows when NEITHER half of the pair has anything. */
  invitesEmpty?: boolean;
}) {
  const path = `/championships/${eventId}/enrollments`;
  const readOnlyTitle = readOnly ? ARCHIVED_READ_ONLY_MESSAGE : undefined;
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
      {/* Phone: filter and sort share a row, search below at full width.
          sm+: one row, the inner wrapper dissolving into it. */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center justify-between gap-2 sm:contents">
          <FilterChips
            className="mb-0"
            value={filter}
            onChange={(f) => { onFilterChange(f); setSelected(new Set()); }}
            options={INVITE_FILTER_OPTIONS
              .map((f) => ({ key: f, label: <span className="capitalize">{f}</span>, count: f === 'all' ? undefined : counts[f] }))}
          />
          <div className="flex shrink-0 items-center gap-1.5 sm:order-last">
            <PillButton icon={ArrowUpDown} onClick={() => t.setSortKey(t.sortKey === 'name' ? 'applied' : 'name')} title="Sort by">
              {t.sortKey === 'name' ? 'Name' : 'Applied'}
            </PillButton>
            <PillButton icon={t.dir === 'asc' ? ArrowUp : ArrowDown} onClick={() => t.setDir(t.dir === 'asc' ? 'desc' : 'asc')}
              title={t.dir === 'asc' ? 'Sort ascending' : 'Sort descending'}>
              {t.dir === 'asc' ? 'Asc' : 'Desc'}
            </PillButton>
          </div>
        </div>
        <SearchInput pill value={t.query} onChange={t.setQuery} placeholder="Search organization…" className="w-full sm:ml-auto sm:w-56" />
      </div>

      <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        {toApprove.length > 0 && (
          <Button size="sm" disabled={bulkReview.isPending || readOnly} title={readOnlyTitle}
            onClick={() => bulkReview.mutate({ ids: toApprove, status: APPLICATION_STATUS.APPROVED }, { onSuccess: () => toast.success(`${toApprove.length} approved`), onError: (e: any) => toast.error(e.message) })}>
            Approve selected
          </Button>
        )}
        {toReject.length > 0 && (
          <Button size="sm" variant="outline" disabled={bulkReview.isPending || readOnly} title={readOnlyTitle}
            onClick={() => bulkReview.mutate({ ids: toReject, status: APPLICATION_STATUS.REJECTED }, { onSuccess: () => toast.success(`${toReject.length} rejected`), onError: (e: any) => toast.error(e.message) })}>
            Reject selected
          </Button>
        )}
      </BulkBar>

      {isLoading ? null : t.total === 0 && invitesEmpty ? (
        <EmptyState icon={<CheckCircle2 size={24} />} title="Nothing here" description={t.query ? 'No organizations match your search.' : filter === INVITE_BUCKET.PENDING ? 'No organizations are waiting for approval.' : `No ${filter} organizations.`} />
      ) : t.total === 0 ? null : (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {/* Desktop headings share the rows' grid. */}
          <div className={cn('hidden items-center gap-x-4 px-4 py-2 lg:grid', HEAD_ROW)} style={{ gridTemplateColumns: APP_GRID }}>
            <Checkbox checked={allSelected} indeterminate={selected.size > 0} onChange={toggleAll} aria-label="Select all" />
            <span>Organisation</span><span>Applied</span><span>Status</span><span className="text-right">Actions</span>
          </div>
          <ul>
            {visible.map((r) => {
              const name = r.organizations?.name ?? 'Organisation';
              const meta = [r.organizations?.code, r.organizations?.city].filter(Boolean).join(' · ');
              const on = selected.has(r.id);
              const actions = (
                <span className="flex shrink-0 items-center justify-end gap-1.5">
                  {r.status !== APPLICATION_STATUS.APPROVED && (
                    <PillButton icon={Check} tone="primary" onClick={() => review.mutate({ id: r.id, status: APPLICATION_STATUS.APPROVED })} disabled={review.isPending || readOnly} title={readOnlyTitle}>Approve</PillButton>
                  )}
                  {r.status !== APPLICATION_STATUS.REJECTED && (
                    <PillButton icon={X} onClick={() => setRejecting(r)} disabled={readOnly} title={readOnlyTitle}>Reject</PillButton>
                  )}
                </span>
              );
              const who = (
                <span className="flex min-w-0 items-center gap-2.5">
                  <TeamAvatar name={name} short={r.organizations?.short_name ?? r.organizations?.code} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-800 dark:text-slate-100" title={name}>{name}</span>
                    {meta && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{meta}</span>}
                  </span>
                </span>
              );
              const note = r.status === APPLICATION_STATUS.REJECTED && r.rejection_note
                ? <span className="block truncate text-xs text-rose-600 dark:text-rose-400" title={r.rejection_note}>“{r.rejection_note}”</span> : null;
              return (
                <li key={r.id} className={cn('border-t border-slate-100 transition-colors first:border-t-0 lg:first:border-t dark:border-slate-800',
                  on ? 'bg-brand-50/60 dark:bg-brand-500/10' : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30')}>
                  {/* Desktop: aligned columns. */}
                  <div className="hidden items-center gap-x-4 px-4 py-2.5 lg:grid" style={{ gridTemplateColumns: APP_GRID }}>
                    <Checkbox checked={on} onChange={() => toggle(r.id)} aria-label={`Select ${name}`} />
                    {who}
                    <span className="text-sm text-slate-500 dark:text-slate-400">{fmtDateTime(r.applied_at)}</span>
                    <span className="min-w-0"><StatusBadge status={r.status} />{note}</span>
                    {actions}
                  </div>
                  {/* Phone: checkbox and organisation, then status, date and actions. */}
                  <div className="flex items-start gap-3 px-4 py-3 lg:hidden">
                    <span className="pt-2"><Checkbox checked={on} onChange={() => toggle(r.id)} aria-label={`Select ${name}`} /></span>
                    <span className="min-w-0 flex-1 space-y-2">
                      {who}
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        <StatusBadge status={r.status} /><span>Applied {fmtDateTime(r.applied_at)}</span>
                      </span>
                      {note}
                      <span className="flex">{actions}</span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {t.total > 0 && <PillPagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} noun="organisation" className="mt-3" />}

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
