import { useMemo, useState } from 'react';
import { Lock, ShieldCheck, Users } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApi, useTableControls } from '../../lib/hooks';
import {
  Avatar, Badge, Button, Card, CardBody, confirmDialog, EmptyState, Field,
  ListToolbar, Modal, PageHeader, SearchInput, Select, Spinner, toast,
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

function scopeLabel(g: Grant, units: Array<{ id: string; name: string }>) {
  if (!g.scope_ref) return 'Whole organisation';
  return units.find((u) => u.id === g.scope_ref)?.name ?? g.scope_ref;
}

function GrantModal({
  orgId, member, roles, units, onClose,
}: {
  orgId: string;
  member: Member;
  roles: RoleDef[];
  units: Array<{ id: string; name: string }>;
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
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
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

  const members = useApi<Member[]>(`/organizations/${orgId}/members`);
  const grants = useApi<Grant[]>(`/organizations/${orgId}/roles`);
  const roleDefs = useApi<RoleDef[] | { roles: RoleDef[] }>(`/organizations/${orgId}/role-definitions`);
  const unitsQ = useApi<Array<{ id: string; name: string }>>(`/organizations/${orgId}/units`, true);

  const roles = useMemo(() => {
    const raw = Array.isArray(roleDefs.data) ? roleDefs.data : roleDefs.data?.roles ?? [];
    // Only organisation roles are assignable here. Event roles belong to an event,
    // and offering Organiser in this list would create a grant nothing reads.
    return raw.filter((r) => r.kind !== 'event');
  }, [roleDefs.data]);

  const units = unitsQ.data ?? [];

  const byUser = useMemo(() => {
    const m = new Map<string, Grant[]>();
    for (const g of grants.data ?? []) {
      if (!g.user) continue;
      m.set(g.user.id, [...(m.get(g.user.id) ?? []), g]);
    }
    return m;
  }, [grants.data]);

  const rows = members.data ?? [];
  const { view, query, setQuery } = useTableControls(rows, {
    search: (m) => `${m.users?.name ?? ''} ${m.users?.email ?? ''}`,
  });

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

      <Card>
        <CardBody>
          <ListToolbar>
            <SearchInput value={query} onChange={setQuery} placeholder="Search by name or email…" />
          </ListToolbar>

          {view.length === 0 ? (
            <EmptyState icon={<Users />} title="No members yet"
              description="People appear here once they join or are added to the organisation." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left font-mono text-[9px] uppercase tracking-[0.13em] text-slate-500 dark:border-slate-700">
                    <th className="px-3 py-2.5">Member</th>
                    <th className="px-3 py-2.5">Membership</th>
                    <th className="px-3 py-2.5">Roles &amp; scope</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {view.map((m) => {
                    const held = byUser.get(m.user_id) ?? [];
                    return (
                      <tr key={m.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={m.users?.name ?? '?'} size={34} />
                            <div className="min-w-0">
                              <div className="font-display font-semibold text-slate-900 dark:text-slate-100">{m.users?.name}</div>
                              <div className="truncate text-[13px] text-slate-500">{m.users?.email}</div>
                            </div>
                          </div>
                        </td>

                        <td className="px-3 py-3">
                          <Badge tone={m.status === 'active' ? 'green' : 'amber'}>{m.status}</Badge>
                        </td>

                        <td className="px-3 py-3">
                          {held.length === 0 ? (
                            // Not "none": membership already implies a role, and saying
                            // none would misrepresent what this person can actually do.
                            <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-500">
                              <Lock size={13} />
                              {IMPLIED[m.role] ?? m.role} <span className="text-slate-400">(from membership)</span>
                            </span>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              {held.map((g) => (
                                <div key={g.id} className="flex flex-wrap items-center gap-2">
                                  <Badge tone="brand">{g.role?.name}</Badge>
                                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">
                                    {scopeLabel(g, units)}
                                  </span>
                                  <Badge tone={STATUS_TONE[g.status]}>{g.status}</Badge>
                                  <button
                                    className="text-[12px] font-semibold text-brand-600 hover:underline"
                                    onClick={() => setStatus(g, g.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED')}>
                                    {g.status === 'SUSPENDED' ? 'Restore' : 'Suspend'}
                                  </button>
                                  <button className="text-[12px] font-semibold text-rose-600 hover:underline" onClick={() => revoke(g)}>
                                    Remove
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-3 text-right">
                          <Button size="sm" variant="ghost" onClick={() => setGranting(m)}>
                            <ShieldCheck size={14} /> Give role
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
