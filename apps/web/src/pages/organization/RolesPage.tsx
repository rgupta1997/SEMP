import { useEffect, useMemo, useState } from 'react';
import { Lock, RotateCcw, ShieldCheck } from 'lucide-react';
import { useParams } from 'react-router-dom';
import type { PermissionCode } from '@semp/shared';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { usePermissions } from '../../lib/permissions';
import {
  Badge, Button, Card, CardBody, confirmDialog, PageHeader, Spinner, toast,
} from '../../components/ui';

// Screen 7: Roles & Permissions.
//
// An organisation does not get to invent permissions - a permission is a thing the
// product knows how to enforce, so one created through a UI could only ever be a row
// nothing reads. What it does get to decide is which of them each role holds.
//
// Platform roles are therefore read-only here, and editing one means taking a COPY
// that belongs to this organisation. The copy starts identical, so "customise" never
// silently means "lose your permissions", and reverting is deleting the copy rather
// than trying to reconstruct the original.

type RoleScope = 'whole_org' | 'campus_unit' | 'single_event';

interface RoleDef {
  id: string; name: string; code: string | null; description: string | null;
  permission_ids: string[];
  kind: 'org' | 'event' | null;
  /** How far the role reaches. The owner sets this. */
  scope: RoleScope | null;
  /** Who defines it - the platform, or this organisation's own copy. */
  owner: 'platform' | 'organisation';
  editable: boolean;
}

const SCOPE_LABEL: Record<RoleScope, string> = {
  whole_org: 'Whole organisation',
  campus_unit: 'One campus or unit',
  single_event: 'One event',
};

const SCOPE_HELP: Record<RoleScope, string> = {
  whole_org: 'Everyone holding this role reaches the entire organisation.',
  campus_unit: 'Each grant names a campus. The same person can hold it for two.',
  single_event: 'Each grant names one event and reaches nothing outside it.',
};

interface Area { area: string; permissions: Array<{ code: string; label: string; scope: string }> }

/**
 * Rendered standalone at its own route, and embedded inside the Administration
 * rail. `embedded` suppresses the page header and org tabs - the rail already
 * says where you are, and two sets of navigation is one too many.
 */
export function RolesPage({ embedded, orgId: orgIdProp }: { embedded?: boolean; orgId?: string } = {}) {
  const params = useParams();
  const orgId = orgIdProp ?? params.orgId ?? '';
  const defs = useApi<RoleDef[]>(`/organizations/${orgId}/role-definitions`);
  const catalogue = useApi<Area[]>('/permission-catalogue');

  // THE DELEGATION RULE, mirrored. You cannot write a permission into a role that
  // you do not hold yourself - the API refuses it (org-roles.routes.ts), and without
  // this the only way to find that out would be a 403 on Save after ticking twelve
  // boxes. Shown as a padlock on the box rather than hidden, because "you cannot
  // grant this" is information and an absent row is not.
  const perms = usePermissions();
  const mine = perms.orgPermissions(orgId);
  const canGrant = (code: string) => perms.isSuper || mine.has(code as PermissionCode);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<RoleScope>('whole_org');
  const [busy, setBusy] = useState(false);

  const roles = defs.data ?? [];
  const selected = roles.find((r) => r.id === selectedId) ?? roles[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    setDraft(new Set(selected.permission_ids));
    setScope(selected.scope ?? 'whole_org');
  }, [selected?.id, selected?.permission_ids.join(','), selected?.scope]);

  const dirty = useMemo(() => {
    if (!selected) return false;
    if ((selected.scope ?? 'whole_org') !== scope) return true;
    const a = new Set(selected.permission_ids);
    if (a.size !== draft.size) return true;
    for (const c of draft) if (!a.has(c)) return true;
    return false;
  }, [selected, draft, scope]);

  const toggle = (code: string) => {
    if (!selected?.editable) return;
    // Already-granted permissions stay removable: taking access away is not
    // escalation, so only ADDING one you lack is refused.
    if (!draft.has(code) && !canGrant(code)) return;
    setDraft((d) => { const n = new Set(d); n.has(code) ? n.delete(code) : n.add(code); return n; });
  };

  const takeOwnership = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const row = await api<RoleDef>('POST', `/organizations/${orgId}/role-definitions/${selected.id}/override`);
      toast.success(`${selected.name} is now yours to edit`);
      await defs.refetch();
      setSelectedId(row.id);
    } catch (e: any) { toast.error(e?.message ?? 'Could not customise that role'); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api('PATCH', `/organizations/${orgId}/role-definitions/${selected.id}`, {
        permission_ids: [...draft],
        scope,
      });
      toast.success(`${selected.name} updated`);
      await defs.refetch();
    } catch (e: any) { toast.error(e?.message ?? 'Could not save that'); }
    finally { setBusy(false); }
  };

  const revert = async () => {
    if (!selected) return;
    const ok = await confirmDialog({
      title: `Revert ${selected.name}?`,
      message: 'This organisation\'s copy is deleted and the platform definition applies again. Anyone holding the role keeps it - only what it grants changes.',
      confirmLabel: 'Revert to platform',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api('DELETE', `/organizations/${orgId}/role-definitions/${selected.id}`);
      toast.success('Reverted to the platform definition');
      setSelectedId(null);
      await defs.refetch();
    } catch (e: any) { toast.error(e?.message ?? 'Could not revert that'); }
    finally { setBusy(false); }
  };

  if (defs.isLoading || catalogue.isLoading) return <Spinner />;

  return (
    <>
      {!embedded && (
        <>
          <PageHeader
            title="Roles & permissions"
            subtitle="What each role may do here. Permissions come from the product; which ones a role holds is yours to set."
          />
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* ---- the roles ---- */}
        <Card>
          <CardBody className="p-2">
            {roles.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition
                  ${selected?.id === r.id ? 'bg-brand-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              >
                <span className="flex items-center gap-2 font-display text-[14px] font-semibold">
                  {r.name}
                  {!r.editable && <Lock size={12} className="opacity-70" />}
                </span>
                <span className={`font-mono text-[9px] uppercase tracking-[0.12em]
                  ${selected?.id === r.id ? 'text-white/70' : 'text-slate-500'}`}>
                  {r.owner} · {r.permission_ids.length} permissions
                </span>
              </button>
            ))}
          </CardBody>
        </Card>

        {/* ---- the matrix ---- */}
        <Card>
          <CardBody>
            {!selected ? (
              <p className="text-sm text-slate-500">Pick a role to see what it grants.</p>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-lg font-bold">{selected.name}</h3>
                    {selected.description && (
                      <p className="mt-0.5 max-w-prose text-[13.5px] text-slate-500">{selected.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {selected.kind === 'event' && <Badge tone="amber">Event role</Badge>}
                    <Badge tone={selected.editable ? 'brand' : 'slate'}>
                      {selected.editable ? 'Yours to edit' : 'Platform definition'}
                    </Badge>
                  </div>
                </div>

                {!selected.editable && (
                  // The important sentence on this screen: the copy starts identical.
                  <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
                    <p className="flex-1 text-[13.5px] text-slate-600 dark:text-slate-300">
                      This is the platform's definition, shared by every organisation. Take a copy to change it
                      here — the copy starts identical, so nothing is lost by customising.
                    </p>
                    <Button onClick={takeOwnership} disabled={busy}>
                      <ShieldCheck size={14} /> Customise for this organisation
                    </Button>
                  </div>
                )}

                {selected.editable && !perms.isSuper && (
                  <p className="mb-4 flex items-start gap-2 text-[13px] text-slate-500 dark:text-slate-400">
                    <Lock size={13} className="mt-0.5 shrink-0" />
                    A padlocked permission is one you do not hold yourself. You can take it
                    off a role but not add it — otherwise anyone who can edit roles could
                    edit their way past the person who appointed them.
                  </p>
                )}

                <div className="mb-5 rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-800">
                  <h4 className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate-500">Scope</h4>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(SCOPE_LABEL) as RoleScope[]).map((sc) => (
                      <button
                        key={sc}
                        type="button"
                        disabled={!selected.editable}
                        onClick={() => setScope(sc)}
                        className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition
                          ${scope === sc ? 'border-brand-600 bg-brand-600 text-white'
                                         : 'border-slate-200 hover:border-brand-300 dark:border-slate-800'}
                          ${selected.editable ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
                      >
                        {SCOPE_LABEL[sc]}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[13px] text-slate-500">{SCOPE_HELP[scope]}</p>
                </div>

                <div className="flex flex-col gap-5">
                  {(catalogue.data ?? []).map((area) => (
                    <div key={area.area}>
                      <h4 className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate-500">{area.area}</h4>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {area.permissions.map((perm) => {
                          const on = draft.has(perm.code);
                          // Locked = you do not hold it, so you cannot hand it out.
                          const locked = !on && !canGrant(perm.code);
                          const usable = selected.editable && !locked;
                          return (
                            <label
                              key={perm.code}
                              title={locked ? 'You do not hold this permission, so you cannot grant it.' : undefined}
                              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13.5px] transition
                                ${on ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/25'
                                     : 'border-slate-200 dark:border-slate-800'}
                                ${usable ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 accent-brand-600"
                                checked={on}
                                disabled={!usable}
                                onChange={() => toggle(perm.code)}
                              />
                              <span className="min-w-0">
                                <span className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-100">
                                  {perm.label}
                                  {locked && <Lock size={11} className="shrink-0 text-slate-400" />}
                                </span>
                                <span className="block font-mono text-[10px] text-slate-400">{perm.code}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {selected.editable && (
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                    <Button variant="ghost" onClick={revert} disabled={busy}>
                      <RotateCcw size={14} /> Revert to platform
                    </Button>
                    <div className="flex items-center gap-3">
                      {dirty && <span className="text-[13px] text-slate-500">Unsaved changes</span>}
                      <Button onClick={save} disabled={busy || !dirty}>
                        {busy ? 'Saving…' : 'Save permissions'}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
