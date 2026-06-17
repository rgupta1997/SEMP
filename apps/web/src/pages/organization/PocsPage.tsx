import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ORGANIZATION_MEMBER_ROLE } from '@semp/shared';
import { useAuth } from '../../lib/auth';
import { usePermissions } from '../../lib/permissions';
import { api } from '../../lib/api';
import { useApi, useApiMutation } from '../../lib/hooks';
import { OrgTabs } from '../../components/OrgTabs';
import { Avatar, Badge, Button, Card, CardBody, EmptyState, Field, Input, ListToolbar, Modal, PageHeader, SearchInput, Select, Spinner, toast } from '../../components/ui';

interface Member {
  id: string; user_id: string; role: string; status: string;
  users: { id: string; name: string; email: string; phone?: string | null } | null;
}

const ROLE_TONE: Record<string, 'brand' | 'green' | 'amber' | 'slate'> = {
  owner: 'brand', admin: 'brand', captain: 'amber', member: 'green', alumni: 'slate',
};

function AddMemberModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [error, setError] = useState<string | null>(null);
  const add = useApiMutation(
    (body: any) => api('POST', `/organizations/${orgId}/members`, body),
    [`/organizations/${orgId}/members`],
    () => { toast.success('Member added'); onClose(); },
  );
  const submit = () => {
    setError(null);
    if (!email.trim()) { setError('Email is required'); return; }
    add.mutate({ name: name.trim() || undefined, email: email.trim(), role },
      { onError: (e: any) => setError(e.message) });
  };
  return (
    <Modal title="Add member" onClose={onClose}>
      <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rohan Kulkarni" /></Field>
      <Field label="Email" hint="An existing user is matched by email; a new one gets the default password (demo123).">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
      </Field>
      <Field label="Role">
        <Select value={role} onChange={(e) => setRole(e.target.value)}>
          {ORGANIZATION_MEMBER_ROLE.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
      </Field>
      {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={add.isPending} onClick={submit}>{add.isPending ? 'Adding…' : 'Add member'}</Button>
      </div>
    </Modal>
  );
}

export function PocsPage() {
  const { ctx } = useAuth();
  const { orgId: routeOrgId } = useParams();
  const orgId = routeOrgId ?? ctx?.organization?.id ?? ctx?.user.organization_id ?? '';
  const canManage = usePermissions().canManageOrg(orgId);
  const path = orgId ? `/organizations/${orgId}/members` : null;
  const { data: members = [], isLoading } = useApi<Member[]>(path);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);

  const setRole = useApiMutation(
    ({ id, role }: { id: string; role: string }) => api('PATCH', `/organizations/${orgId}/members/${id}`, { role }),
    [path!],
  );
  const remove = useApiMutation((id: string) => api('DELETE', `/organizations/${orgId}/members/${id}`), [path!]);

  const q = search.trim().toLowerCase();
  const visible = members.filter((m) => !q || `${m.users?.name ?? ''} ${m.users?.email ?? ''}`.toLowerCase().includes(q));

  return (
    <div>
      {orgId && <OrgTabs orgId={orgId} />}
      <PageHeader title="Members" subtitle="Everyone in this organization and the role they hold.">
        {canManage && <Button onClick={() => setAdding(true)}>+ Add member</Button>}
      </PageHeader>

      {members.length > 0 && (
        <ListToolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search members…" className="w-full sm:w-72" />
        </ListToolbar>
      )}

      {isLoading ? <Spinner /> : visible.length === 0 ? (
        <EmptyState icon="👥" title="No members yet" description={canManage ? 'Add members so they can captain and play in teams.' : 'This organization has no members yet.'}
          action={canManage ? <Button onClick={() => setAdding(true)}>+ Add member</Button> : undefined} />
      ) : (
        <Card>
          <CardBody className="divide-y divide-slate-100 dark:divide-slate-800 p-0">
            {visible.map((m) => (
              <div key={m.id} className={`flex items-center justify-between px-5 py-3 ${m.status === 'past' ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-3">
                  <Avatar name={m.users?.name ?? '—'} size={38} />
                  <div>
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{m.users?.name ?? '—'}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{m.users?.email}{m.users?.phone ? ` · ${m.users.phone}` : ''}</div>
                  </div>
                </div>
                {canManage ? (
                  <div className="flex items-center gap-2">
                    <Select value={m.role} onChange={(e) => setRole.mutate({ id: m.id, role: e.target.value }, { onError: (err: any) => toast.error(err.message) })} className="w-32">
                      {ORGANIZATION_MEMBER_ROLE.map((r) => <option key={r} value={r}>{r}</option>)}
                    </Select>
                    <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400"
                      onClick={() => { if (confirm(`Remove ${m.users?.name ?? 'this member'} from the organization?`)) remove.mutate(m.id, { onError: (err: any) => toast.error(err.message) }); }}>
                      Remove
                    </Button>
                  </div>
                ) : (
                  <Badge tone={ROLE_TONE[m.role] ?? 'slate'}>{m.role}</Badge>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {adding && orgId && <AddMemberModal orgId={orgId} onClose={() => setAdding(false)} />}
    </div>
  );
}
