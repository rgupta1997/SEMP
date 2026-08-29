import { useMemo, useState } from 'react';
import { Lock, ShieldCheck, Users } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApi, useTableControls } from '../../lib/hooks';
import { useOrgUnits, unitPath } from '../../lib/units';
import { usePermissions } from '../../lib/permissions';
import { DataList } from '../../components/primitives';
import {
  Avatar, Badge, Button, Card, CardBody, confirmDialog, EmptyState, Field,
  ListToolbar, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, toast,
} from '../../components/ui';

// Screen 6: Members.
//
// The screen exists because a membership and a role grant are two different things
// and the product had no way to see them together. `organization_members` says who
// belongs; `user_org_roles` says what they may do, at what scope, and whether that
// is currently live. A person can be a member with no grant (they fall back to what
// their membership implies), or hold two grants at two campuses.
//
// So the table is joined here rather than server-side: the member list and the
// grant list are separate resources with separate permissions, and a person with
// view_members but not manage_roles should still see the roster.

interface Member {
  id: string; user_id: string; role: string; status: string;
  users: { id: string; name: string; email: string; phone?: string | null } | null;
}

interface RoleDef {
  id: string; name: string; code: string | null;
  kind?: 'org' | 'event' | null;
  scope?: 'whole_org' | 'campus_unit' | 'single_event' | null;
  is_system?: boolean;
}

interface Grant {
  id: string;
  user: { id: string; name: string; email: string } | null;
  role: RoleDef | null;
  scope_ref: string | null;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  assigned_at: string;
}

const STATUS_TONE = { ACTIVE: 'green', INVITED: 'amber', SUSPENDED: 'slate' } as const;

/** Membership alone implies a role. Naming it stops the table looking empty. */
const IMPLIED: Record<string, string> = { owner: 'Owner', admin: 'Org Admin', member: 'Viewer' };

// Two departments in different campuses can share a name, so a scope is shown as
// "Sales · Bangalore" rather than "Sales". A grant whose scope reads ambiguously is
// one somebody will eventually assign to the wrong half of the organisation.
function scopeLabel(g: Grant, units: ScopeUnit[]) {
  if (!g.scope_ref) return 'Whole organisation';
  const u = units.find((x) => x.id === g.scope_ref);
  return u ? unitPath(u, u.parent) : g.scope_ref;
}

type ScopeUnit = { id: string; name: string; parent: { name: string } | null };

function GrantModal({
  orgId, member, roles, units, onClose,
}: {
  orgId: string;
  member: Member;
  roles: RoleDef[];
  units: ScopeUnit[];
  onClose: () => void;
}) {
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '');
  const [scopeRef, setScopeRef] = useState('');
  const [busy, setBusy] = useState(false);

  const role = roles.find((r) => r.id === roleId);
  // Only a campus-scoped role has a campus to pick. Offering the selector for a
  // whole_org role would invite a setting that the engine then ignores.
  const needsScope = role?.scope === 'campus_unit';

  const save = async () => {
    setBusy(true);
    try {
      await api('POST', `/organizations/${orgId}/roles`, {
        user_id: member.user_id,
        role_id: roleId,
        scope_ref: needsScope && scopeRef ? scopeRef : null,
      });
      toast.success(`${member.users?.name ?? 'They'} now hold ${role?.name}`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not assign that role');
    } finally { setBusy(false); }
  };

  return (
    <Modal title={`Give ${member.users?.name ?? 'this member'} a role`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="Role">
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </Field>

        {needsScope && (
          <Field label="Campus or unit" hint="This role only reaches the campus you choose.">
            <Select value={scopeRef} onChange={(e) => setScopeRef(e.target.value)}>
              <option value="">Whole organisation</option>
              {units.map((u) => <option key={u.id} value={u.id}>{unitPath(u, u.parent)}</option>)}
            </Select>
          </Field>
        )}

        {role && (
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            {role.scope === 'campus_unit'
              ? 'Scoped by default: the same role can be given again for another campus.'
              : 'Reaches the whole organisation.'}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || !roleId}>{busy ? 'Saving…' : 'Give role'}</Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Rendered standalone at its own route, and embedded inside the Administration
 * rail. `embedded` suppresses the page header and org tabs - the rail already
 * says where you are, and two sets of navigation is one too many.
 */
export function MembersPage({ embedded, orgId: orgIdProp }: { embedded?: boolean; orgId?: string } = {}) {
  const params = useParams();
  const orgId = orgIdProp ?? params.orgId ?? '';
  const [granting, setGranting] = useState<Member | null>(null);

  // Two permissions, two different jobs, and this screen shows both.
  //
  // It had NO gating at all: every control - approve a join request, give a role,
  // suspend one, revoke one - was rendered for anybody who could reach the page, and
  // Administration hands the Members tab to more roles than can act on it. The result
  // was a screen of buttons that each returned a 403.
  //
  //   org.member.manage  who belongs to the institution: approving, declining.
  //   role.manage        what they may do once they are in: granting, suspending,
  //                      revoking. Also gates GET /organizations/:id/roles, so asking
  //                      for the grants at all is conditional on it - otherwise the
  //                      page opens with a failed request in the console.
  const perms = usePermissions();
  const canManageMembers = perms.hasOrgPermission('org.member.manage', orgId);
  const canManageRoles = perms.hasOrgPermission('role.manage', orgId);

  const members = useApi<Member[]>(`/organizations/${orgId}/members`);
  const grants = useApi<Grant[]>(canManageRoles ? `/organizations/${orgId}/roles` : null);
  const roleDefs = useApi<RoleDef[] | { roles: RoleDef[] }>(canManageRoles ? `/organizations/${orgId}/role-definitions` : null);
  const unitsView = useOrgUnits(orgId);

  const roles = useMemo(() => {
    const raw = Array.isArray(roleDefs.data) ? roleDefs.data : roleDefs.data?.roles ?? [];
    // Only organisation roles are assignable here. Event roles belong to an event,
    // and offering Organiser in this list would create a grant nothing reads.
    return raw.filter((r) => r.kind !== 'event');
  }, [roleDefs.data]);

  // Flattened: a role can be scoped to a campus OR to a department beneath it, and
  // a picker that offered only campuses would make the finer scope unreachable.
  const units = unitsView.flat;

  const byUser = useMemo(() => {
    const m = new Map<string, Grant[]>();
    for (const g of grants.data ?? []) {
      if (!g.user) continue;
      m.set(g.user.id, [...(m.get(g.user.id) ?? []), g]);
    }
    return m;
  }, [grants.data]);

  // Join requests are held OUT of the roster and shown above it.
  //
  // They were previously visible only on an orphaned page with no route, so a
  // person who had asked to join could not be approved anywhere in the product -
  // and the dashboard counted them while pointing at Players, a screen that acts on
  // a different field entirely. Somebody following that link and pressing "Reject"
  // changed the person's VERIFICATION and left the request exactly where it was.
  const all = members.data ?? [];
  const pending = all.filter((m) => m.status === 'pending');
  const rows = all.filter((m) => m.status !== 'pending');
  // Paged, like every other roster in the product.
  //
  // It was not, and `useTableControls` pages by default, so this table rendered
  // the first ten members of two hundred and offered no way to reach the rest -
  // looking exactly like an organisation with ten people in it. Search still
  // found the other 190, which is why it read as data missing rather than as a
  // list truncated.
  const tc = useTableControls(rows, {
    search: (m) => `${m.users?.name ?? ''} ${m.users?.email ?? ''} ${m.users?.phone ?? ''}`,
    sorts: { name: (a, b) => (a.users?.name ?? '').localeCompare(b.users?.name ?? '') },
    initialSort: 'name',
    pageSize: 20,
  });
  const { view, query, setQuery } = tc;

  const [deciding, setDeciding] = useState<string | null>(null);
  const decide = async (m: Member, action: 'approve' | 'decline') => {
    setDeciding(m.id);
    try {
      await api('POST', `/organizations/${orgId}/members/${m.id}/${action}`);
      toast.success(action === 'approve'
        ? `${m.users?.name ?? 'They'} can now use this organisation`
        : `${m.users?.name ?? 'That request'} was declined`);
      await members.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not do that');
    } finally { setDeciding(null); }
  };

  const setStatus = async (g: Grant, status: Grant['status']) => {
    try {
      await api('PATCH', `/organizations/${orgId}/roles/${g.id}`, { status });
      toast.success(status === 'SUSPENDED' ? 'Role suspended' : 'Role restored');
      grants.refetch();
    } catch (e: any) { toast.error(e?.message ?? 'Could not change that'); }
  };

  const revoke = async (g: Grant) => {
    const ok = await confirmDialog({
      title: `Remove ${g.role?.name}?`,
      // Suspending exists precisely so revoking can be the deliberate one.
      message: `${g.user?.name} loses this role immediately. To pause it instead, suspend it.`,
      confirmLabel: 'Remove role',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api('DELETE', `/organizations/${orgId}/roles/${g.id}`);
      toast.success('Role removed');
      grants.refetch();
    } catch (e: any) { toast.error(e?.message ?? 'Could not remove that'); }
  };

  if (members.isLoading) return <Spinner />;

  return (
    <>
      {!embedded && (
        <>
          <PageHeader title="Members" subtitle="Who belongs to this organisation, and what each of them may do." />
        </>
      )}

      {/* Above the roster, because it is the only thing on this screen that is
          WAITING on somebody. A request buried in a list of two hundred members is
          a request nobody answers. */}
      {canManageMembers && pending.length > 0 && (
        <Card className="mb-4 border-amber-300 dark:border-amber-500/40">
          <CardBody>
            <h3 className="font-display text-[15px] font-extrabold text-slate-900 dark:text-slate-100">
              {pending.length} {pending.length === 1 ? 'person has' : 'people have'} asked to join
            </h3>
            <p className="mb-3 mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">
              They found this organisation in Discover and asked to join - the only route that
              needs your say-so. Approving makes them a member; declining leaves them out, and you
              can still add them yourself later.
            </p>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {pending.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <Avatar name={m.users?.name} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800 dark:text-slate-100">{m.users?.name ?? 'Unnamed'}</span>
                    <span className="block truncate text-[12px] text-slate-500 dark:text-slate-400">{m.users?.email ?? m.users?.phone ?? 'No contact'}</span>
                  </span>
                  <Button size="sm" disabled={deciding !== null} onClick={() => decide(m, 'approve')}>
                    {deciding === m.id ? 'Saving…' : 'Approve'}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400"
                    disabled={deciding !== null} onClick={() => decide(m, 'decline')}>Decline</Button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          <ListToolbar>
            <SearchInput value={query} onChange={setQuery} placeholder="Search by name or email…" />
          </ListToolbar>

          {view.length === 0 ? (
            query ? (
              <EmptyState icon={<Users />} title="Nobody matches that"
                description="No member has that name, email or phone number. Clear the search to see everyone." />
            ) : (
              <EmptyState icon={<Users />} title="No members yet"
                description="People appear here once they join or are added to the organisation." />
            )
          ) : (
            <DataList
              rows={view}
              rowKey={(m) => m.id}
              caption="Members of this organisation"
              columns={[
                {
                  key: 'member',
                  header: 'Member',
                  primary: true,
                  render: (m) => (
                    <div className="flex items-center gap-3">
                      <Avatar name={m.users?.name ?? '?'} size={34} />
                      <div className="min-w-0">
                        <div className="font-display font-semibold text-slate-900 dark:text-slate-100">{m.users?.name}</div>
                        <div className="t-meta truncate">{m.users?.email}</div>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'membership',
                  header: 'Membership',
                  render: (m) => <Badge tone={m.status === 'active' ? 'green' : 'amber'}>{m.status}</Badge>,
                },
                {
                  key: 'roles',
                  header: 'Roles & scope',
                  render: (m) => {
                    const held = byUser.get(m.user_id) ?? [];
                    if (held.length === 0) {
                      // Not "none": membership already implies a role, and saying
                      // none would misrepresent what this person can actually do.
                      return (
                        <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 dark:text-slate-400">
                          <Lock size={13} />
                          {IMPLIED[m.role] ?? m.role} <span className="text-slate-400">(from membership)</span>
                        </span>
                      );
                    }
                    return (
                      <div className="flex flex-col gap-1.5">
                        {held.map((g) => (
                          <div key={g.id} className="flex flex-wrap items-center gap-2">
                            <Badge tone="brand">{g.role?.name}</Badge>
                            <span className="t-eyebrow">{scopeLabel(g, units)}</span>
                            <Badge tone={STATUS_TONE[g.status]}>{g.status}</Badge>
                            {canManageRoles && (
                              <>
                                <button
                                  className="tap text-[12px] font-semibold text-brand-600 hover:underline dark:text-brand-400"
                                  onClick={() => setStatus(g, g.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED')}>
                                  {g.status === 'SUSPENDED' ? 'Restore' : 'Suspend'}
                                </button>
                                <button
                                  className="tap text-[12px] font-semibold text-rose-600 hover:underline dark:text-rose-400"
                                  onClick={() => revoke(g)}>
                                  Remove
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  },
                },
                ...(canManageRoles ? [{
                  key: 'actions',
                  header: '',
                  align: 'right' as const,
                  actions: true,
                  render: (m: Member) => (
                    <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => setGranting(m)}>
                      <ShieldCheck size={14} /> Give role
                    </Button>
                  ),
                }] : []),
              ]}
            />
          )}

          {view.length > 0 && (
            <Pagination page={tc.page} pageCount={tc.pageCount} total={tc.total}
              pageSize={tc.pageSize} onPage={tc.setPage} />
          )}
        </CardBody>
      </Card>

      {granting && (
        <GrantModal
          orgId={orgId}
          member={granting}
          roles={roles}
          units={units}
          onClose={() => { setGranting(null); grants.refetch(); }}
        />
      )}
    </>
  );
}
