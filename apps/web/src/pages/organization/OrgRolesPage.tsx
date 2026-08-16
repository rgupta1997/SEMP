import { Fragment, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Building2, Globe } from 'lucide-react';
import { api } from '../../lib/api';
import { useApi, useApiMutation } from '../../lib/hooks';
import { OrgTabs } from '../../components/OrgTabs';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Spinner, Table, confirmDialog, toast } from '../../components/ui';

interface RoleDefinition {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  permission_ids: string[] | null;
  scope: 'platform' | 'organisation';
  editable: boolean;
}
interface CatalogueArea { area: string; permissions: { code: string; label: string; scope: 'org' | 'championship' }[] }

// What each role means HERE.
//
// Role definitions used to be global: one `roles` row shared by every institution, so
// editing "Coordinator" changed it for everybody. Assignments were scoped, definitions
// were not - which is the kind of split nobody notices until an institution widens a
// role and another one inherits it.
//
// A platform role is the definition every institution starts from. Overriding one
// makes a copy this organisation owns; the copy starts identical, so taking control
// never costs anybody their access. Resetting deletes the copy and the platform
// definition applies again.
export function OrgRolesPage() {
  const { orgId = '' } = useParams();
  const base = `/organizations/${orgId}/role-definitions`;
  const { data: roles = [], isLoading, refetch } = useApi<RoleDefinition[]>(base);
  const { data: catalogue = [], isLoading: catLoading } = useApi<CatalogueArea[]>('/permission-catalogue');
  const [dirty, setDirty] = useState<Record<string, Set<string>>>({});

  const save = useApiMutation(
    ({ roleId, codes }: { roleId: string; codes: string[] }) =>
      api('PATCH', `${base}/${roleId}`, { permission_ids: codes }),
    [base],
  );

  const knownCodes = useMemo(
    () => new Set(catalogue.flatMap((a) => a.permissions.map((p) => p.code))),
    [catalogue],
  );

  // What a role holds today, reduced to catalogue codes (older rows can hold uuids
  // that grant nothing).
  const saved = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const r of roles) map[r.id] = new Set((r.permission_ids ?? []).map(String).filter((c) => knownCodes.has(c)));
    return map;
  }, [roles, knownCodes]);

  const held = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const r of roles) map[r.id] = dirty[r.id] ?? new Set(saved[r.id] ?? []);
    return map;
  }, [roles, dirty, saved]);

  const isDirty = (roleId: string) => {
    const original = saved[roleId] ?? new Set<string>();
    const current = held[roleId] ?? new Set<string>();
    return original.size !== current.size || [...current].some((c) => !original.has(c));
  };

  const toggle = (role: RoleDefinition, code: string) => {
    if (!role.editable) return; // platform rows are read-only here, by design
    setDirty((prev) => {
      const next = new Set(held[role.id] ?? []);
      next.has(code) ? next.delete(code) : next.add(code);
      return { ...prev, [role.id]: next };
    });
  };

  const override = async (role: RoleDefinition) => {
    try {
      await api('POST', `${base}/${role.id}/override`);
      await refetch();
      toast.success(`${role.name} is now yours to edit`, 'It starts identical to the platform definition.');
    } catch (e: any) { toast.error(e.message ?? 'Could not take ownership of that role'); }
  };

  const reset = async (role: RoleDefinition) => {
    const ok = await confirmDialog({
      title: `Reset ${role.name} to the platform definition?`,
      message: 'Your edits are discarded and anyone currently holding your version of this role loses it. You can assign the platform role again afterwards.',
      confirmLabel: 'Reset role', tone: 'danger',
    });
    if (!ok) return;
    try {
      const res: any = await api('DELETE', `${base}/${role.id}`);
      await refetch();
      toast.success(`${role.name} reset`, res?.assignments_cleared
        ? `${res.assignments_cleared} assignment${res.assignments_cleared === 1 ? '' : 's'} cleared.` : undefined);
    } catch (e: any) { toast.error(e.message ?? 'Could not reset that role'); }
  };

  if (isLoading || catLoading) return <div><OrgTabs orgId={orgId} /><Spinner /></div>;

  return (
    <div>
      <OrgTabs orgId={orgId} />
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          What each role can do inside this organisation. A <b>platform</b> role is the definition everyone starts
          from — override it to get your own copy, which only affects your members.
        </p>

        <Card>
          <CardHeader
            title="Roles & permissions"
            subtitle="Generated from the product's permission catalogue — a permission that isn't listed is one nothing enforces."
          />
          <CardBody className="overflow-x-auto">
            <Table>
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2">Permission</th>
                  {roles.map((r) => (
                    <th key={r.id} className="px-3 py-2 text-center">
                      <div>{r.name}</div>
                      <div className="mt-0.5 flex items-center justify-center gap-1 font-normal normal-case">
                        {r.scope === 'organisation'
                          ? <Badge tone="brand"><Building2 size={10} className="mr-0.5 inline" />Yours</Badge>
                          : <Badge tone="slate"><Globe size={10} className="mr-0.5 inline" />Platform</Badge>}
                      </div>
                      {r.code && <div className="font-mono text-[10px] font-normal normal-case text-slate-400">{r.code}</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {catalogue.map((area) => (
                  // Keyed on the fragment: a <tbody> takes two siblings per area, and
                  // keying the inner <tr> instead is what produced React's duplicate-key
                  // warning on this screen.
                  <Fragment key={area.area}>
                    <tr className="bg-slate-50/60 dark:bg-slate-800/40">
                      <td colSpan={roles.length + 1} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {area.area}
                      </td>
                    </tr>
                    {area.permissions.map((p) => (
                      <tr key={p.code} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-3 py-2">
                          <div className="text-sm text-slate-800 dark:text-slate-200">{p.label}</div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{p.code}</span>
                            <Badge tone="slate">{p.scope}</Badge>
                          </div>
                        </td>
                        {roles.map((r) => (
                          <td key={r.id} className="px-3 py-2 text-center">
                            <span className={r.editable ? '' : 'opacity-40'} title={r.editable ? undefined : 'Override this role to edit it'}>
                              <Checkbox checked={held[r.id]?.has(p.code) ?? false} onChange={() => toggle(r, p.code)} />
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>

        <div className="flex flex-wrap gap-2">
          {roles.map((r) => (r.editable ? (
            <span key={r.id} className="flex gap-2">
              {isDirty(r.id) && (
                <Button disabled={save.isPending}
                  onClick={() => save.mutate({ roleId: r.id, codes: [...(held[r.id] ?? [])] }, {
                    onSuccess: () => {
                      setDirty((prev) => { const next = { ...prev }; delete next[r.id]; return next; });
                      toast.success(`${r.name} updated`);
                    },
                    onError: (e: any) => toast.error(e.message),
                  })}>
                  Save {r.name}
                </Button>
              )}
              <Button variant="ghost" onClick={() => reset(r)}>Reset {r.name}</Button>
            </span>
          ) : (
            <Button key={r.id} variant="ghost" onClick={() => override(r)}>Customise {r.name}</Button>
          )))}
        </div>
      </div>
    </div>
  );
}
