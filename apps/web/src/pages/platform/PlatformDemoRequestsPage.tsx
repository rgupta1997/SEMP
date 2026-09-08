import { Fragment } from 'react';
import { DEMO_REQUEST_STATUS, type DemoRequestStatus } from '@semp/shared';
import { api } from '../../lib/api';
import { fmtDateTime, useApi, useApiMutation, useTableControls } from '../../lib/hooks';
import { titleCase } from '../../lib/format';
import {
  Badge, Button, Card, confirmDialog, EmptyState, Pagination, SearchInput, Select, Spinner,
} from '../../components/ui';

interface DemoRequest {
  id: string;
  name: string;
  email: string;
  organization?: string | null;
  role?: string | null;
  sport?: string | null;
  phone?: string | null;
  message?: string | null;
  // The marketing form's remaining answers - 20260908000000_demo_request_details.sql.
  // `event_date` is a string because the form accepts "mid-January" as readily as a date.
  city?: string | null;
  event_date?: string | null;
  sport_count?: number | null;
  participant_count?: number | null;
  source?: string | null;
  status: DemoRequestStatus;
  created_at: string;
  users?: { id: string; name: string } | null;
}

const STATUS_TONE: Record<DemoRequestStatus, 'info' | 'amber' | 'brand' | 'slate'> = {
  new: 'info', contacted: 'amber', scheduled: 'brand', closed: 'slate',
};

export function PlatformDemoRequestsPage() {
  const { data: requests = [], isLoading } = useApi<DemoRequest[]>('/demo-requests');

  const setStatus = useApiMutation(
    ({ id, status }: { id: string; status: DemoRequestStatus }) => api('PATCH', `/demo-requests/${id}`, { status }),
    ['/demo-requests'],
  );
  const remove = useApiMutation((id: string) => api('DELETE', `/demo-requests/${id}`), ['/demo-requests']);

  const t = useTableControls(requests, {
    search: (r) => `${r.name} ${r.email} ${r.organization ?? ''} ${r.role ?? ''} ${r.sport ?? ''} ${r.city ?? ''} ${r.source ?? ''}`,
    sorts: {
      received: (a, b) => +new Date(a.created_at) - +new Date(b.created_at),
      // Event size, which is the point of capturing it: the biggest enquiries are
      // the ones to call first. Unanswered sorts as -1 so it sits below a genuine
      // zero rather than above every answered lead.
      size: (a, b) => (a.participant_count ?? -1) - (b.participant_count ?? -1),
    },
    initialSort: 'received',
    initialDir: 'desc',
    pageSize: 15,
  });

  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>;

  const open = requests.filter((r) => r.status === 'new').length;

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        “Book a demo” leads captured from the public landing page. Visible to platform admins only.
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold dark:text-slate-100">
          Demo requests
          {open > 0 && <Badge tone="info" className="ml-2">{open} new</Badge>}
        </h2>
        <SearchInput value={t.query} onChange={t.setQuery} placeholder="Search leads…" className="w-56" />
      </div>

      {requests.length === 0 ? (
        <EmptyState icon="✉" title="No demo requests yet" description="Leads submitted from the landing page’s “Book a demo” form will appear here." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2">Lead</th>
                <th className="px-4 py-2">Organization</th>
                <th className="px-4 py-2">Type / Sport</th>
                <th className="px-4 py-2">Event</th>
                <th className="px-4 py-2">Size</th>
                <th className="px-4 py-2">Received</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {t.view.map((r) => (
                // Two rows per lead. The second carries the free text - what they
                // typed in "anything else about the event", plus where they heard
                // about EOS - which needs the width of the table rather than a
                // column. It was previously fetched and never rendered anywhere:
                // every note a lead wrote was invisible to the person calling them.
                <Fragment key={r.id}>
                  <tr className={r.message || r.source ? 'border-b-0' : undefined}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800 dark:text-slate-200">{r.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{r.email}</div>
                      {r.phone && <div className="text-xs text-slate-400 dark:text-slate-500">{r.phone}</div>}
                    </td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{r.organization || '-'}</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                      <div>{r.role || '-'}</div>
                      {r.sport && <div className="text-xs text-slate-400 dark:text-slate-500">{r.sport}</div>}
                    </td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                      <div>{r.city || '-'}</div>
                      {/* Rendered verbatim, never reformatted: it is free text and may
                          well say "mid-January". Parsing it to pretty-print a date
                          would quietly show the wrong day. */}
                      {r.event_date && <div className="text-xs text-slate-400 dark:text-slate-500">{r.event_date}</div>}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {r.participant_count == null && r.sport_count == null ? '-' : (
                        <>
                          {r.participant_count != null && (
                            <div>{r.participant_count.toLocaleString()} participants</div>
                          )}
                          {r.sport_count != null && (
                            <div className="text-xs text-slate-400 dark:text-slate-500">{r.sport_count} sports</div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{fmtDateTime(r.created_at)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Badge tone={STATUS_TONE[r.status]}>{titleCase(r.status)}</Badge>
                        <Select
                          value={r.status}
                          onChange={(e) => setStatus.mutate({ id: r.id, status: e.target.value as DemoRequestStatus })}
                          className="!min-w-[7.5rem] !py-1 text-xs"
                        >
                          {DEMO_REQUEST_STATUS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                        </Select>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400"
                        onClick={async () => { if (await confirmDialog({ title: 'Delete demo request', confirmLabel: 'Delete', message: `Delete the demo request from ${r.name}?` })) remove.mutate(r.id); }}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                  {(r.message || r.source) && (
                    <tr>
                      <td colSpan={8} className="px-4 pb-3 pt-0">
                        {r.message && (
                          <p className="whitespace-pre-wrap text-[13px] text-slate-600 dark:text-slate-300">{r.message}</p>
                        )}
                        {r.source && (
                          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Heard about EOS via {r.source}</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div className="px-4 pb-3"><Pagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} /></div>
        </Card>
      )}
    </div>
  );
}
