import { useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate, useApi, useApiMutation, useTableControls } from '../../lib/hooks';
import {
  Avatar, Badge, Button, Card, confirmDialog, EmptyState, Field, ListToolbar, Pagination,
  SearchInput, Select, Spinner,
} from '../../components/ui';
import { BulkImportModal } from '../../components/BulkImportModal';
import { downloadCsvTemplate } from '../../lib/import';
import { UserFormModal, type UserFormBody } from '../../components/UserFormModal';

interface UserRow {
  id: string; name: string; email: string; phone?: string | null;
  is_active: boolean; is_super_admin: boolean; created_at?: string | null;
  organizations?: { id: string; name: string } | null;
}

interface ImportResult {
  created: number; matched: number; total: number;
  credentials: { name: string; email: string; phone: string | null; password: string }[];
}

const USER_IMPORT_FIELDS = [
  { key: 'name', label: 'Full Name', required: true, aliases: ['full name', 'fullname'] },
  { key: 'email', label: 'Email', required: true, aliases: ['e-mail', 'email address'] },
  { key: 'phone', label: 'Phone', required: true, aliases: ['mobile', 'contact', 'phone number', 'phone no', 'mobile number'] },
  { key: 'institution', label: 'Institution', aliases: ['institution', 'college', 'organisation', 'organization'] },
];

// Login-password rule for bulk-provisioned users: first word of the name
// (lowercased, a-z0-9 only) + "@" + last four phone digits, e.g. rohit@7626.
// Mirrors deriveProvisionedPassword on the server so the preview matches.
function derivePassword(name: string, phone: string): string {
  const first = (name.trim().split(/\s+/)[0] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const last4 = (phone || '').replace(/\D/g, '').slice(-4);
  return first && last4.length === 4 ? `${first}@${last4}` : 'demo123';
}

export function PlatformUsersPage() {
  const { data: users = [], isLoading } = useApi<UserRow[]>('/users');
  const { data: organizations = [] } = useApi<{ id: string; name: string }[]>('/organizations');
  const { data: championships = [] } = useApi<{ id: string; name: string }[]>('/championships');
  const { data: roles = [] } = useApi<{ id: string; name: string }[]>('/roles');

  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);

  // Bulk-import mapping (applied to every imported row).
  const [mapInstitution, setMapInstitution] = useState('');
  const [mapEvent, setMapEvent] = useState('');
  const [mapRole, setMapRole] = useState('');

  const deactivate = useApiMutation((id: string) => api('DELETE', `/users/${id}`), ['/users']);

  const filtered = users;
  const t = useTableControls(filtered, {
    search: (u) => `${u.name} ${u.email} ${u.phone ?? ''} ${u.organizations?.name ?? ''}`,
    sorts: {
      name: (a, b) => a.name.localeCompare(b.name),
    },
    initialSort: 'name',
    pageSize: 15,
  });

  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>;

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">All platform accounts - create, import, edit, map to championships.</p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold dark:text-slate-100">Users</h2>
        <ListToolbar inline>
          <SearchInput value={t.query} onChange={t.setQuery} placeholder="Search users…" className="w-56" />
          <Button variant="outline" onClick={() => setImporting(true)}>↑ Import users</Button>
          <Button onClick={() => setCreating(true)}>+ Add user</Button>
        </ListToolbar>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="◍" title="No users" description="Add a user or import a list to get started." />
      ) : (
        <Card className="overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Contact</th>
                <th className="px-4 py-2">Organization</th>
                <th className="px-4 py-2">Joined</th>
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
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{u.organizations?.name ?? '-'}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{fmtDate(u.created_at)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>Edit</Button>
                    {u.is_active && !u.is_super_admin && (
                      <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400"
                        onClick={async () => { if (await confirmDialog({ title: 'Deactivate user', confirmLabel: 'Deactivate', message: `Deactivate ${u.name}?` })) deactivate.mutate(u.id); }}>
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
          organizations={organizations}
          onClose={() => setCreating(false)}
          onSubmit={(body: UserFormBody) => api('POST', '/users', body)}
        />
      )}

      {editing && (
        <UserFormModal
          mode="edit"
          initial={{ name: editing.name, email: editing.email, phone: editing.phone ?? '', organization_id: editing.organizations?.id ?? null }}
          organizations={organizations}
          onClose={() => setEditing(null)}
          onSubmit={async (body: UserFormBody) => { await api('PATCH', `/users/${editing.id}`, body); }}
        />
      )}

      {importing && (
        <BulkImportModal<ImportResult>
          title="Import users"
          fields={USER_IMPORT_FIELDS}
          templateName="users-template.csv"
          sampleRow={['Rohit Gupta', 'rohit.gupta@example.com', '7977177626', 'IIM Bangalore']}
          derivedColumns={[{ label: 'Login password', compute: (r) => derivePassword(r.name, r.phone) }]}
          submitLabel="Import"
          extraControls={(
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Organization (optional)">
                <Select value={mapInstitution} onChange={(e) => setMapInstitution(e.target.value)}>
                  <option value="">- none -</option>
                  {organizations.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </Select>
              </Field>
              <Field label="Map to championship (optional)">
                <Select value={mapEvent} onChange={(e) => setMapEvent(e.target.value)}>
                  <option value="">- none -</option>
                  {championships.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </Select>
              </Field>
              <Field label="Championship role">
                <Select value={mapRole} onChange={(e) => setMapRole(e.target.value)} disabled={!mapEvent}>
                  <option value="">- select -</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </Field>
              <p className="sm:col-span-3 text-xs text-slate-500 dark:text-slate-400">
                Each new user's password is set to <span className="font-mono">firstname@last4digits</span> of their phone
                (e.g. <span className="font-mono">rohit@7626</span>) and they're asked to change it on first sign-in.
              </p>
            </div>
          )}
          renderResult={(r) => (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                <span className="font-bold text-emerald-600">{r.created}</span> created · {r.matched} already existed · {r.total} total.
              </p>
              {r.credentials.length > 0 && (
                <>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Generated logins (change required on first sign-in). Share these securely.
                  </p>
                  <div className="max-h-52 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                        <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Password</th></tr>
                      </thead>
                      <tbody>
                        {r.credentials.map((c) => (
                          <tr key={c.email} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="px-3 py-1.5 text-slate-700 dark:text-slate-300">{c.name}</td>
                            <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300">{c.email}</td>
                            <td className="px-3 py-1.5 font-mono text-xs text-slate-700 dark:text-slate-300">{c.password}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => downloadCsvTemplate(
                      'user-credentials.csv',
                      ['name', 'email', 'phone', 'password'],
                      r.credentials.map((c) => [c.name, c.email, c.phone ?? '', c.password]),
                    )}
                  >
                    ↓ Download credentials CSV
                  </Button>
                </>
              )}
            </div>
          )}
          onClose={() => setImporting(false)}
          onSubmit={async (rows) => {
            // Send in chunks so each request stays under the server's batch cap and
            // keeps per-request password hashing bounded; aggregate the results.
            const CHUNK = 100;
            const agg: ImportResult = { created: 0, matched: 0, total: 0, credentials: [] };
            for (let i = 0; i < rows.length; i += CHUNK) {
              const res = await api<ImportResult>('POST', '/users/bulk', {
                users: rows.slice(i, i + CHUNK).map((row) => ({
                  name: row.name,
                  email: row.email,
                  phone: row.phone || undefined,
                })),
                organization_id: mapInstitution || undefined,
                championship_id: mapEvent || undefined,
                role_id: mapEvent && mapRole ? mapRole : undefined,
              });
              agg.created += res.created;
              agg.matched += res.matched;
              agg.total += res.total;
              agg.credentials.push(...res.credentials);
            }
            return agg;
          }}
        />
      )}
    </div>
  );
}
