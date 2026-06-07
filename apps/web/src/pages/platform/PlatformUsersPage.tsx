import { useMemo, useState } from 'react';
import { ACCOUNT_TYPE } from '@semp/shared';
import { api } from '../../lib/api';
import { useApi, useApiMutation, useTableControls } from '../../lib/hooks';
import {
  Avatar, Badge, Button, Card, EmptyState, Field, ListToolbar, Pagination,
  SearchInput, Select, Spinner,
} from '../../components/ui';
import { BulkImportModal } from '../../components/BulkImportModal';
import { UserFormModal, type UserFormBody } from '../../components/UserFormModal';

interface UserRow {
  id: string; name: string; email: string; phone?: string | null;
  account_type: string; is_active: boolean; is_super_admin: boolean;
  institutions?: { id: string; name: string } | null;
}

interface ImportResult { created: number; matched: number; total: number }

const USER_IMPORT_FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'email', label: 'Email', required: true, aliases: ['e-mail'] },
  { key: 'phone', label: 'Phone', aliases: ['mobile', 'contact'] },
  { key: 'account_type', label: 'Account type', aliases: ['role', 'type'] },
];

export function PlatformUsersPage() {
  const { data: users = [], isLoading } = useApi<UserRow[]>('/users');
  const { data: institutions = [] } = useApi<{ id: string; name: string }[]>('/institutions');
  const { data: events = [] } = useApi<{ id: string; name: string }[]>('/events');
  const { data: roles = [] } = useApi<{ id: string; name: string }[]>('/roles');

  const [accountFilter, setAccountFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);

  // Bulk-import mapping (applied to every imported row).
  const [mapInstitution, setMapInstitution] = useState('');
  const [mapEvent, setMapEvent] = useState('');
  const [mapRole, setMapRole] = useState('');

  const deactivate = useApiMutation((id: string) => api('DELETE', `/users/${id}`), ['/users']);

  const filtered = useMemo(
    () => (accountFilter === 'all' ? users : users.filter((u) => u.account_type === accountFilter)),
    [users, accountFilter],
  );
  const t = useTableControls(filtered, {
    search: (u) => `${u.name} ${u.email} ${u.phone ?? ''} ${u.institutions?.name ?? ''}`,
    sorts: {
      name: (a, b) => a.name.localeCompare(b.name),
      account: (a, b) => a.account_type.localeCompare(b.account_type),
    },
    initialSort: 'name',
    pageSize: 15,
  });

  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>;

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">All platform accounts — create, import, edit, map to events.</p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold dark:text-slate-100">Users</h2>
        <ListToolbar inline>
          <SearchInput value={t.query} onChange={t.setQuery} placeholder="Search users…" className="w-56" />
          <Select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
            <option value="all">All types</option>
            {ACCOUNT_TYPE.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
          <Button variant="outline" onClick={() => setImporting(true)}>↑ Import users</Button>
          <Button onClick={() => setCreating(true)}>+ Add user</Button>
        </ListToolbar>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="◍" title="No users" description="Add a user or import a list to get started." />
      ) : (
        <Card className="overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Contact</th>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2">Institution</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {t.view.map((u) => (
                <tr key={u.id} className={u.is_active ? '' : 'opacity-50'}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={u.name} size={28} />
                      <span className="font-medium text-slate-800 dark:text-slate-200">{u.name}</span>
                      {u.is_super_admin && <Badge tone="violet">admin</Badge>}
                      {!u.is_active && <Badge tone="rose">inactive</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                    <div>{u.email}</div>
                    {u.phone && <div className="text-xs text-slate-400 dark:text-slate-500">{u.phone}</div>}
                  </td>
                  <td className="px-4 py-2"><Badge tone="slate">{u.account_type}</Badge></td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{u.institutions?.name ?? '—'}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>Edit</Button>
                    {u.is_active && !u.is_super_admin && (
                      <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400"
                        onClick={() => { if (confirm(`Deactivate ${u.name}?`)) deactivate.mutate(u.id); }}>
                        Deactivate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 pb-3"><Pagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} /></div>
        </Card>
      )}

      {creating && (
        <UserFormModal
          institutions={institutions}
          onClose={() => setCreating(false)}
          onSubmit={async (body: UserFormBody) => { await api('POST', '/users', body); }}
        />
      )}

      {editing && (
        <UserFormModal
          mode="edit"
          initial={{ name: editing.name, email: editing.email, phone: editing.phone ?? '', account_type: editing.account_type as any, institution_id: editing.institutions?.id ?? null }}
          institutions={institutions}
          onClose={() => setEditing(null)}
          onSubmit={async (body: UserFormBody) => { await api('PATCH', `/users/${editing.id}`, body); }}
        />
      )}

      {importing && (
        <BulkImportModal<ImportResult>
          title="Import users"
          fields={USER_IMPORT_FIELDS}
          templateName="users-template.csv"
          sampleRow={['Aarav Mehta', 'aarav@example.com', '9800000001', 'participant']}
          submitLabel="Import"
          extraControls={(
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Institution (optional)">
                <Select value={mapInstitution} onChange={(e) => setMapInstitution(e.target.value)}>
                  <option value="">— none —</option>
                  {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </Select>
              </Field>
              <Field label="Map to event (optional)">
                <Select value={mapEvent} onChange={(e) => setMapEvent(e.target.value)}>
                  <option value="">— none —</option>
                  {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </Select>
              </Field>
              <Field label="Event role">
                <Select value={mapRole} onChange={(e) => setMapRole(e.target.value)} disabled={!mapEvent}>
                  <option value="">— select —</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </Field>
            </div>
          )}
          renderResult={(r) => (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <span className="font-bold text-emerald-600">{r.created}</span> created · {r.matched} already existed · {r.total} total.
            </p>
          )}
          onClose={() => setImporting(false)}
          onSubmit={async (rows) => api<ImportResult>('POST', '/users/bulk', {
            users: rows.map((row) => ({
              name: row.name,
              email: row.email,
              phone: row.phone || undefined,
              account_type: ACCOUNT_TYPE.includes(row.account_type as any) ? row.account_type : 'participant',
            })),
            institution_id: mapInstitution || undefined,
            event_id: mapEvent || undefined,
            role_id: mapEvent && mapRole ? mapRole : undefined,
          })}
        />
      )}
    </div>
  );
}
