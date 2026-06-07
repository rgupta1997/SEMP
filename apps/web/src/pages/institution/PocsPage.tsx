import { useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { usePermissions } from '../../lib/permissions';
import { api } from '../../lib/api';
import { useApi, useApiMutation } from '../../lib/hooks';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, EmptyState, ListToolbar, PageHeader, SearchInput, Spinner, toast } from '../../components/ui';
import { BulkImportModal } from '../../components/BulkImportModal';
import { UserFormModal, type UserFormBody } from '../../components/UserFormModal';

interface Person {
  id: string; name: string; email: string; phone?: string | null;
  account_type: string; is_active: boolean;
}

interface ImportResult { created: number; matched: number; total: number }

const PARTICIPANT_IMPORT_FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'email', label: 'Email', required: true, aliases: ['e-mail'] },
  { key: 'phone', label: 'Phone', aliases: ['mobile', 'contact'] },
];

function PersonRow({ person, canManage, onEdit, onDeactivate, onMakePoc }:
  { person: Person; canManage: boolean; onEdit: () => void; onDeactivate: () => void; onMakePoc?: () => void }) {
  return (
    <div className={`flex items-center justify-between px-5 py-3 ${person.is_active ? '' : 'opacity-50'}`}>
      <div className="flex items-center gap-3">
        <Avatar name={person.name} size={38} />
        <div>
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{person.name}{!person.is_active && <Badge tone="rose" className="ml-2">inactive</Badge>}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{person.email}{person.phone ? ` · ${person.phone}` : ''}</div>
        </div>
      </div>
      {canManage && (
        <div className="flex items-center gap-1">
          {onMakePoc && person.is_active && (
            <Button size="sm" variant="outline" onClick={onMakePoc}>Make POC</Button>
          )}
          <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
          {person.is_active && (
            <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" onClick={onDeactivate}>Deactivate</Button>
          )}
        </div>
      )}
    </div>
  );
}

export function PocsPage() {
  const { ctx } = useAuth();
  const canManage = usePermissions().can('team.manage'); // POC only; captains view-only
  const institutionId = ctx?.institution?.id ?? ctx?.user.institution_id ?? '';
  const usersPath = institutionId ? `/users?institution_id=${institutionId}` : null;
  const { data: users = [], isLoading } = useApi<Person[]>(usersPath);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);

  const deactivate = useApiMutation((id: string) => api('DELETE', `/users/${id}`), [usersPath]);
  // Promote a participant to a full POC (institution account) for this institution.
  const promote = useApiMutation((id: string) => api('PATCH', `/users/${id}`, { account_type: 'institution' }), [usersPath]);

  const q = search.trim().toLowerCase();
  const match = (u: Person) => !q || `${u.name} ${u.email} ${u.phone ?? ''}`.toLowerCase().includes(q);
  const pocs = useMemo(() => users.filter((u) => u.account_type === 'institution' && match(u)), [users, q]);
  const participants = useMemo(() => users.filter((u) => u.account_type === 'participant' && match(u)), [users, q]);

  return (
    <div>
      <PageHeader title="Points of contact" subtitle="Manage your institution's contacts and create participant logins.">
        {canManage && <Button variant="outline" onClick={() => setImporting(true)}>↑ Import participants</Button>}
        {canManage && <Button onClick={() => setCreating(true)}>+ Add participant</Button>}
      </PageHeader>

      {users.length > 0 && (
        <ListToolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search people…" className="w-full sm:w-72" />
        </ListToolbar>
      )}

      {isLoading ? <Spinner /> : (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Points of contact" subtitle="Institution staff who administer teams. They never appear on a roster." action={<Badge tone="brand">{pocs.length}</Badge>} />
            <CardBody className="divide-y divide-slate-100 dark:divide-slate-800 p-0">
              {pocs.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-slate-400 dark:text-slate-500">No contacts yet.</p>
              ) : pocs.map((u) => (
                <PersonRow key={u.id} person={u} canManage={canManage} onEdit={() => setEditing(u)}
                  onDeactivate={() => { if (confirm(`Deactivate ${u.name}?`)) deactivate.mutate(u.id); }} />
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Participants" subtitle="Player logins you've created. Assign captains from a team's roster." action={<Badge tone="slate">{participants.length}</Badge>} />
            <CardBody className="divide-y divide-slate-100 dark:divide-slate-800 p-0">
              {participants.length === 0 ? (
                <EmptyState icon="👥" title="No participants yet" description="Add or import participant logins so they can be added to teams."
                  action={canManage ? <Button onClick={() => setCreating(true)}>+ Add participant</Button> : undefined} />
              ) : participants.map((u) => (
                <PersonRow key={u.id} person={u} canManage={canManage} onEdit={() => setEditing(u)}
                  onMakePoc={() => { if (confirm(`Make ${u.name} a point of contact? They'll be able to administer your institution's teams and people, and will no longer appear as a participant.`)) promote.mutate(u.id, { onSuccess: () => toast.success(`${u.name} is now a point of contact`), onError: (e: any) => toast.error(e.message) }); }}
                  onDeactivate={() => { if (confirm(`Deactivate ${u.name}?`)) deactivate.mutate(u.id); }} />
              ))}
            </CardBody>
          </Card>
        </div>
      )}

      {creating && (
        <UserFormModal
          title="Add participant"
          accountTypes={['participant']}
          lockInstitutionId={institutionId}
          onClose={() => setCreating(false)}
          onSubmit={async (body: UserFormBody) => { await api('POST', '/users', body); }}
        />
      )}

      {editing && (
        <UserFormModal
          mode="edit"
          title="Edit person"
          initial={{ name: editing.name, email: editing.email, phone: editing.phone ?? '' }}
          onClose={() => setEditing(null)}
          onSubmit={async (body: UserFormBody) => { await api('PATCH', `/users/${editing.id}`, body); }}
        />
      )}

      {importing && (
        <BulkImportModal<ImportResult>
          title="Import participants"
          fields={PARTICIPANT_IMPORT_FIELDS}
          templateName="participants-template.csv"
          sampleRow={['Aarav Mehta', 'aarav@example.com', '9800000001']}
          submitLabel="Import"
          renderResult={(r) => (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <span className="font-bold text-emerald-600">{r.created}</span> created · {r.matched} already existed · {r.total} total.
            </p>
          )}
          onClose={() => setImporting(false)}
          onSubmit={async (rows) => api<ImportResult>('POST', '/users/bulk', {
            users: rows.map((row) => ({ name: row.name, email: row.email, phone: row.phone || undefined, account_type: 'participant' })),
            institution_id: institutionId,
          })}
        />
      )}
    </div>
  );
}
