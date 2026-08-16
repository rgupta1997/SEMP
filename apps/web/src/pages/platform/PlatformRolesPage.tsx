import { Fragment, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useApi, useApiMutation } from '../../lib/hooks';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Spinner, Table, toast } from '../../components/ui';

interface Role { id: string; name: string; code: string | null; description: string | null; permission_ids: string[] | null }
interface CatalogueArea { area: string; permissions: { code: string; label: string; scope: 'org' | 'championship' }[] }

// What each role can do, as a matrix (J6-E1-S2).
//
// This replaces editing `permission_ids` as a raw JSON array in a textarea - a screen
// that could only be used correctly by someone who already knew the permission codes
// by heart, and that silently accepted a typo as a revocation.
//
// The rows are generated from the code-owned catalogue, so a permission added to the
// product appears here automatically and one that never existed cannot be typed in.
export function PlatformRolesPage() {
  const { data: roles = [], isLoading: rolesLoading } = useApi<Role[]>('/roles');
  const { data: catalogue = [], isLoading: catLoading } = useApi<CatalogueArea[]>('/permission-catalogue');
  const [dirty, setDirty] = useState<Record<string, Set<string>>>({});

  const save = useApiMutation(
    ({ roleId, codes }: { roleId: string; codes: string[] }) =>
      api('PATCH', `/roles/${roleId}/permissions`, { permission_ids: codes }),
    ['/roles'],
  );

  // Every code the catalogue actually defines. The matrix works only in these.
  const knownCodes = useMemo(
    () => new Set(catalogue.flatMap((a) => a.permissions.map((p) => p.code))),
    [catalogue],
  );

  // What a role holds TODAY, reduced to catalogue codes.
  //
  // Roles predating the catalogue hold permission-table uuids written by the old
  // JSON-textarea screen. Nothing has ever read `permission_ids`, and can() ignores
  // anything that isn't a code, so those entries grant nothing - but carrying them
  // into a save would post a uuid at an endpoint that (correctly) only accepts codes.
  const saved = useMemo(() => {
    const map: Record<string, { codes: Set<string>; legacy: number }> = {};
    for (const r of roles) {
      const all = (r.permission_ids ?? []).map(String);
      const codes = new Set(all.filter((c) => knownCodes.has(c)));
      map[r.id] = { codes, legacy: all.length - codes.size };
    }
    return map;
  }, [roles, knownCodes]);

  // The working set: what a role holds, plus any unsaved toggles.
  const held = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const r of roles) map[r.id] = dirty[r.id] ?? new Set(saved[r.id]?.codes ?? []);
    return map;
  }, [roles, dirty, saved]);

  const legacyTotal = roles.reduce((n, r) => n + (saved[r.id]?.legacy ?? 0), 0);

  const toggle = (roleId: string, code: string) => {
    setDirty((prev) => {
      const next = new Set(held[roleId] ?? []);
      next.has(code) ? next.delete(code) : next.add(code);
      return { ...prev, [roleId]: next };
    });
  };

  // Compared against the reduced baseline, or a role holding only legacy entries
  // would read as permanently unsaved.
  const isDirty = (roleId: string) => {
    const original = saved[roleId]?.codes ?? new Set<string>();
    const current = held[roleId] ?? new Set<string>();
    return original.size !== current.size || [...current].some((c) => !original.has(c));
  };

  if (rolesLoading || catLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        What each role can do. Changes take effect for everyone holding that role on their next request, and are
        recorded in the audit trail. A role is shared across institutions — widening one widens it everywhere.
      </p>

      {legacyTotal > 0 && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          <b>{legacyTotal} leftover {legacyTotal === 1 ? 'entry' : 'entries'}</b> from the old permissions screen are
          still stored against these roles. They point at placeholder rows, grant nothing, and are not shown below —
          saving a role clears its own leftovers.
        </p>
      )}

      <Card>
        <CardHeader
          title="Roles & permissions"
          subtitle="Generated from the product's permission catalogue — a permission that isn't listed here is one nothing enforces."
        />
        <CardBody className="overflow-x-auto">
          <Table>
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Permission</th>
                {roles.map((r) => (
                  <th key={r.id} className="px-3 py-2 text-center">
                    <div>{r.name}</div>
                    {/* The code is what authorisation resolves by; the name is only a
                        label, and saying so here stops anyone renaming in fear. */}
                    {r.code && <div className="font-mono text-[10px] font-normal normal-case text-slate-400">{r.code}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalogue.map((area) => (
                // Keyed on the fragment - each area contributes two sibling rows, and
                // keying the inner <tr> leaves the fragment itself unkeyed.
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
                          <Checkbox
                            checked={held[r.id]?.has(p.code) ?? false}
                            onChange={() => toggle(r.id, p.code)}
                          />
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
        {roles.filter((r) => isDirty(r.id)).map((r) => (
          <Button key={r.id} disabled={save.isPending}
            onClick={() => save.mutate(
              { roleId: r.id, codes: [...(held[r.id] ?? [])] },
              {
                onSuccess: () => {
                  setDirty((prev) => { const next = { ...prev }; delete next[r.id]; return next; });
                  toast.success(`${r.name} updated`);
                },
                onError: (e: any) => toast.error(e.message),
              },
            )}>
            Save {r.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
