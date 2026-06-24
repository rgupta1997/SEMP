import { FEEDBACK_STATUS, type FeedbackStatus } from '@semp/shared';
import { api } from '../../lib/api';
import { fmtDateTime, useApi, useApiMutation, useTableControls } from '../../lib/hooks';
import {
  Badge, Button, Card, confirmDialog, EmptyState, Pagination, SearchInput, Select, Spinner,
} from '../../components/ui';

interface Feedback {
  id: string;
  message: string;
  name?: string | null;
  email?: string | null;
  context?: string | null;
  championship_id?: string | null;
  user_id?: string | null;
  status: FeedbackStatus;
  created_at: string;
  users?: { id: string; name: string } | null;
}

const STATUS_TONE: Record<FeedbackStatus, 'info' | 'amber' | 'green' | 'slate'> = {
  new: 'info', reviewing: 'amber', resolved: 'green', closed: 'slate',
};

export function PlatformFeedbackPage() {
  const { data: items = [], isLoading } = useApi<Feedback[]>('/feedback');

  const setStatus = useApiMutation(
    ({ id, status }: { id: string; status: FeedbackStatus }) => api('PATCH', `/feedback/${id}`, { status }),
    ['/feedback'],
  );
  const remove = useApiMutation((id: string) => api('DELETE', `/feedback/${id}`), ['/feedback']);

  const t = useTableControls(items, {
    search: (r) => `${r.message} ${r.name ?? ''} ${r.email ?? ''} ${r.context ?? ''}`,
    sorts: { received: (a, b) => +new Date(a.created_at) - +new Date(b.created_at) },
    initialSort: 'received',
    initialDir: 'desc',
    pageSize: 15,
  });

  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>;

  const open = items.filter((r) => r.status === 'new').length;

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Feedback submitted from the public championship pages and the in-app shell. Visible to platform admins only.
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold dark:text-slate-100">
          Feedback
          {open > 0 && <Badge tone="info" className="ml-2">{open} new</Badge>}
        </h2>
        <SearchInput value={t.query} onChange={t.setQuery} placeholder="Search feedback…" className="w-56" />
      </div>

      {items.length === 0 ? (
        <EmptyState icon="💬" title="No feedback yet" description="Messages sent from the “Feedback” button will appear here." />
      ) : (
        <Card className="overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2">Feedback</th>
                <th className="px-4 py-2">From</th>
                <th className="px-4 py-2">Where</th>
                <th className="px-4 py-2">Received</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {t.view.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 max-w-md">
                    <div className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{r.message}</div>
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                    <div>{r.name || (r.user_id ? 'Signed-in user' : 'Anonymous')}</div>
                    {r.email && <div className="text-xs text-slate-400 dark:text-slate-500">{r.email}</div>}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">{r.context || '-'}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{fmtDateTime(r.created_at)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                      <Select
                        value={r.status}
                        onChange={(e) => setStatus.mutate({ id: r.id, status: e.target.value as FeedbackStatus })}
                        className="!min-w-[7.5rem] !py-1 text-xs"
                      >
                        {FEEDBACK_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </Select>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400"
                      onClick={async () => { if (await confirmDialog({ title: 'Delete feedback', confirmLabel: 'Delete', message: 'Delete this feedback message?' })) remove.mutate(r.id); }}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 pb-3"><Pagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} /></div>
        </Card>
      )}
    </div>
  );
}
