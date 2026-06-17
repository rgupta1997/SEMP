import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi, useApiMutation, useTableControls } from '../../lib/hooks';
import { Badge, Button, Card, EmptyState, ListToolbar, Pagination, SearchInput, Spinner, toast } from '../../components/ui';
import { InstitutionFormModal, type InstitutionFormBody } from '../../components/InstitutionFormModal';

interface Organization {
  id: string; name: string; short_name?: string | null; code?: string | null;
  city?: string | null; country?: string | null; status?: boolean | null;
}

export function PlatformInstitutionsPage() {
  const { data: organizations = [], isLoading } = useApi<Organization[]>('/organizations');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Organization | null>(null);

  const del = useApiMutation((id: string) => api('DELETE', `/organizations/${id}`), ['/organizations']);

  const t = useTableControls(organizations, {
    search: (i) => `${i.name} ${i.short_name ?? ''} ${i.code ?? ''} ${i.city ?? ''}`,
    sorts: { name: (a, b) => a.name.localeCompare(b.name) },
    initialSort: 'name',
    pageSize: 15,
  });

  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>;

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Colleges and schools that can participate in championships. Create one with a point of contact in a single step.</p>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold dark:text-slate-100">Organizations</h2>
        <ListToolbar inline>
          <SearchInput value={t.query} onChange={t.setQuery} placeholder="Search organizations…" className="w-56" />
          <Button onClick={() => setCreating(true)}>+ Add organization</Button>
        </ListToolbar>
      </div>

      {organizations.length === 0 ? (
        <EmptyState icon="🏛" title="No organizations" description="Add an organization to get started." />
      ) : (
        <Card className="overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">City</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {t.view.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-200">{i.name}{i.short_name ? <span className="ml-2 text-slate-400 dark:text-slate-500">({i.short_name})</span> : ''}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{i.code || '—'}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{i.city || '—'}</td>
                  <td className="px-4 py-2">{i.status === false ? <Badge tone="rose">inactive</Badge> : <Badge tone="green">active</Badge>}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400"
                      onClick={() => { if (confirm(`Delete ${i.name}?`)) del.mutate(i.id, { onError: (e: any) => toast.error(e.message) }); }}>
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

      {creating && (
        <InstitutionFormModal
          onClose={() => setCreating(false)}
          onSubmit={async (body: InstitutionFormBody) => { await api('POST', '/organizations', body); }}
        />
      )}
      {editing && (
        <InstitutionFormModal
          mode="edit"
          initial={{ name: editing.name, short_name: editing.short_name ?? '', code: editing.code ?? '', city: editing.city ?? '', country: editing.country ?? 'India' }}
          onClose={() => setEditing(null)}
          onSubmit={async (body: InstitutionFormBody) => {
            // Edits never touch the POC sub-form; send only organization fields.
            const { owner, ...inst } = body;
            void owner;
            await api('PATCH', `/organizations/${editing.id}`, inst);
          }}
        />
      )}
    </div>
  );
}
