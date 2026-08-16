import { useState } from 'react';
import { Users } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { ORGANIZATION_MEMBER_ROLE } from '@semp/shared';
import { useAuth } from '../../lib/auth';
import { usePermissions } from '../../lib/permissions';
import { api } from '../../lib/api';
import { useApi, useApiMutation, useTableControls } from '../../lib/hooks';
import { titleCase } from '../../lib/format';
import { OrgTabs } from '../../components/OrgTabs';
import { PeoplePicker } from '../../components/PeoplePicker';
import { InviteMemberModal } from '../../components/InviteMemberModal';
import { Avatar, Badge, Button, Card, CardBody, confirmDialog, EmptyState, Field, ListToolbar, PageHeader, Pagination, SearchInput, Select, Spinner, toast } from '../../components/ui';

// The single directory shape, from GET /organizations/:id/people. Flat by
// design: there is one projection of a person in this product, and gender,
// date of birth and scholarship are deliberately not in it (J1-E5-S4).
interface Member {
  id: string; user_id: string; role: string; status: string;
  name: string | null; email: string | null; phone?: string | null;
  member_code?: string | null;
  verification?: 'pending' | 'verified' | 'rejected';
  org_unit_name?: string | null;
}

const ROLE_TONE: Record<string, 'brand' | 'green' | 'amber' | 'slate'> = {
  owner: 'brand', admin: 'brand', captain: 'amber', member: 'green', alumni: 'slate',
};

// Add members by mobile/name (multi-select). A typed number with no existing user
// gets an invitation to join, auto-applied when they sign up with that number.
function AddMemberModal({ orgId, memberUserIds, onClose }: { orgId: string; memberUserIds: Set<string>; onClose: () => void }) {
  const [role, setRole] = useState('member');
  const assignUsers = async (userIds: string[]) => { await api('POST', `/organizations/${orgId}/members/bulk`, { user_ids: userIds, role }); };
  return (
    <PeoplePicker
      title="Add members"
      subtitle="Search by phone and pick people to add. Unknown numbers get an invite to join."
      assignedUserIds={memberUserIds}
      assignedLabel="Member"
      invite={{ target_type: 'org_member', target_id: orgId, role }}
      invalidateKeys={[`/organizations/${orgId}/people`]}
      roleControl={(
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-44">
            {ORGANIZATION_MEMBER_ROLE.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
          </Select>
        </Field>
      )}
      onAssignUsers={assignUsers}
      onClose={onClose}
    />
  );
}

export function PocsPage() {
  const { ctx } = useAuth();
  const { orgId: routeOrgId } = useParams();
  const orgId = routeOrgId ?? ctx?.organization?.id ?? ctx?.user.organization_id ?? '';
  const canManage = usePermissions().canManageOrg(orgId);
  const path = orgId ? `/organizations/${orgId}/people` : null;
  const { data: members = [], isLoading } = useApi<Member[]>(path);
  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState(false);

  const setRole = useApiMutation(
    ({ id, role }: { id: string; role: string }) => api('PATCH', `/organizations/${orgId}/members/${id}`, { role }),
    [path!],
  );
  const remove = useApiMutation((id: string) => api('DELETE', `/organizations/${orgId}/members/${id}`), [path!]);
  const approve = useApiMutation((id: string) => api('POST', `/organizations/${orgId}/members/${id}/approve`), [path!]);
  const decline = useApiMutation((id: string) => api('POST', `/organizations/${orgId}/members/${id}/decline`), [path!]);

  // Pending join requests are surfaced separately so the owner can approve/decline;
  // only active/past members belong in the roster list below.
  const pendingMembers = members.filter((m) => m.status === 'pending');
  const rosterMembers = members.filter((m) => m.status !== 'pending');
  // Flag anyone already linked to the org (any status) in the add-member picker.
  const memberUserIds = new Set(members.map((m) => m.user_id));

  // Search (name / email / phone) + pagination over the roster list.
  const tc = useTableControls(rosterMembers, {
    search: (m) => `${m.name ?? ''} ${m.email ?? ''} ${m.phone ?? ''}`,
    pageSize: 15,
  });

  return (
    <div>
      {orgId && <OrgTabs orgId={orgId} />}
      <PageHeader title="People" subtitle="Everyone in this institution, the role they hold and where they are placed.">
        {canManage && <Link to={`/organizations/${orgId}/students/import`} className="self-center text-sm font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200">Import the roll →</Link>}
        {canManage && <Button variant="outline" onClick={() => setInviting(true)}>Invite by email</Button>}
        {canManage && <Button onClick={() => setAdding(true)}>+ Add member</Button>}
      </PageHeader>

      {canManage && pendingMembers.length > 0 && (
        <Card className="mb-5 border-amber-200 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/5">
          <CardBody className="p-0">
            <div className="flex items-center gap-2 border-b border-amber-200/70 dark:border-amber-500/20 px-5 py-3">
              <span className="text-lg">🙋</span>
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">Pending requests · {pendingMembers.length}</h2>
            </div>
            <div className="divide-y divide-amber-200/60 dark:divide-amber-500/15">
              {pendingMembers.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={m.name ?? '-'} size={38} />
                    <div>
                      <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{m.name ?? '-'}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{m.email}{m.phone ? ` · ${m.phone}` : ''}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" disabled={approve.isPending || decline.isPending}
                      onClick={() => approve.mutate(m.id, { onSuccess: () => toast.success(`${m.name ?? 'Member'} approved`), onError: (e: any) => toast.error(e.message) })}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={approve.isPending || decline.isPending}
                      onClick={() => decline.mutate(m.id, { onSuccess: () => toast.success('Request declined'), onError: (e: any) => toast.error(e.message) })}>
                      Decline
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {rosterMembers.length > 0 && (
        <ListToolbar>
          <SearchInput value={tc.query} onChange={tc.setQuery} placeholder="Search members…" className="w-full sm:w-72" />
          <span className="text-sm text-slate-500 dark:text-slate-400">{tc.total} member{tc.total === 1 ? '' : 's'}</span>
        </ListToolbar>
      )}

      {isLoading ? <Spinner /> : rosterMembers.length === 0 ? (
        <EmptyState icon={<Users size={24} />} title="No members yet" description={canManage ? 'Add members so they can captain and play in teams.' : 'This organization has no members yet.'}
          action={canManage ? <Button onClick={() => setAdding(true)}>+ Add member</Button> : undefined} />
      ) : tc.total === 0 ? (
        <EmptyState icon="👥" title="No matching members" description="Try a different name, email or phone number." />
      ) : (
        <>
          <Card>
            <CardBody className="divide-y divide-slate-100 dark:divide-slate-800 p-0">
              {tc.view.map((m) => (
                <div key={m.id} className={`flex items-center justify-between px-5 py-3 ${m.status === 'past' ? 'opacity-50' : ''}`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={m.name ?? '-'} size={38} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {/* The directory is the way in to a person's record
                            (J4-E2-S4); the endpoint behind it still checks that
                            the viewer shares this institution. */}
                        <Link to={`/people/${m.user_id}/record`} className="truncate text-sm font-semibold text-slate-800 hover:text-brand-600 dark:text-slate-200 dark:hover:text-brand-300">
                          {m.name ?? '-'}
                        </Link>
                        {/* Only 'verified' is asserted. Pending is the default for
                            everyone imported, and shouting it against 2,000 rows
                            would make the badge mean nothing. */}
                        {m.verification === 'verified' && <Badge tone="green">Verified</Badge>}
                        {m.verification === 'rejected' && <Badge tone="rose">Rejected</Badge>}
                      </div>
                      <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {[m.email, m.phone, m.org_unit_name, m.member_code].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </div>
                  {canManage ? (
                    <div className="flex items-center gap-2">
                      <Select value={m.role} onChange={(e) => setRole.mutate({ id: m.id, role: e.target.value }, { onError: (err: any) => toast.error(err.message) })} className="w-32">
                        {ORGANIZATION_MEMBER_ROLE.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                      </Select>
                      <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400"
                        onClick={async () => { if (await confirmDialog({ title: 'Remove member', confirmLabel: 'Remove', message: `Remove ${m.name ?? 'this member'} from the organization?` })) remove.mutate(m.id, { onError: (err: any) => toast.error(err.message) }); }}>
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
          <Pagination page={tc.page} pageCount={tc.pageCount} total={tc.total} pageSize={tc.pageSize} onPage={tc.setPage} />
        </>
      )}

      {adding && orgId && <AddMemberModal orgId={orgId} memberUserIds={memberUserIds} onClose={() => setAdding(false)} />}
      {inviting && orgId && <InviteMemberModal orgId={orgId} onClose={() => setInviting(false)} />}
    </div>
  );
}
