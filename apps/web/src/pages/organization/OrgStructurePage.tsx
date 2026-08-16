import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { usePermissions } from '../../lib/permissions';
import { api } from '../../lib/api';
import { useApi, useApiMutation } from '../../lib/hooks';
import { OrgTabs } from '../../components/OrgTabs';
import {
  Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, confirmDialog, toast,
} from '../../components/ui';

interface UnitNode {
  id: string;
  type: 'programme' | 'batch';
  name: string;
  code: string | null;
  display_order: number;
  member_count: number;
  children: UnitNode[];
}

// The institution's own shape (J1-E4): Institution → Programme → Batch.
//
// This is what makes "participation by programme" answerable later, and it has to
// exist before the student roll is imported - a person can only be placed in a
// structure that is already there.
export function OrgStructurePage() {
  const { ctx } = useAuth();
  const { orgId: routeOrgId } = useParams();
  const orgId = routeOrgId ?? ctx?.organization?.id ?? ctx?.user.organization_id ?? '';
  const canManage = usePermissions().canManageOrg(orgId);

  const path = `/organizations/${orgId}/units`;
  const { data: tree = [], isLoading } = useApi<UnitNode[]>(orgId ? path : null);
  const [adding, setAdding] = useState<{ type: 'programme' | 'batch'; parent?: UnitNode } | null>(null);
  const [editing, setEditing] = useState<UnitNode | null>(null);

  const remove = useApiMutation((id: string) => api('DELETE', `${path}/${id}`), [path]);

  const totalPeople = tree.reduce((sum, p) => sum + p.member_count, 0);

  const confirmRemove = async (unit: UnitNode) => {
    // Ask the server what this actually costs before asking the person to confirm -
    // "this affects 118 people" is a decision, "are you sure?" is a shrug.
    let impact = { members: 0, batches: [] as { id: string }[] };
    try {
      impact = await api('GET', `${path}/${unit.id}/impact`);
    } catch { /* fall through to the plain confirmation */ }

    const parts = [
      impact.batches.length ? `${impact.batches.length} batch${impact.batches.length === 1 ? '' : 'es'} beneath it will go too` : null,
      impact.members ? `${impact.members} ${impact.members === 1 ? 'person keeps their membership but loses' : 'people keep their membership but lose'} their placement` : null,
    ].filter(Boolean);

    const ok = await confirmDialog({
      title: `Remove ${unit.name}?`,
      message: parts.length ? `${parts.join('. ')}.` : 'Nobody is placed in it yet.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    remove.mutate(unit.id, {
      onSuccess: (res: any) => toast.success(`${unit.name} removed`,
        res?.members_unplaced ? `${res.members_unplaced} people are now unplaced.` : undefined),
      onError: (e: any) => toast.error(e.message),
    });
  };

  return (
    <div>
      {orgId && <OrgTabs orgId={orgId} />}
      <PageHeader
        title="Structure"
        subtitle="Your programmes and their batches. People are placed here, and reports group by it."
      >
        {canManage && (
          <Button onClick={() => setAdding({ type: 'programme' })}><Plus size={15} /> Add programme</Button>
        )}
      </PageHeader>

      {isLoading ? <Spinner /> : tree.length === 0 ? (
        <EmptyState
          icon="🏛"
          title="No programmes yet"
          description={canManage
            ? 'Add your programmes (PGP, EPGP, PhD…) and the batches within each. This has to exist before you import the student roll.'
            : 'An owner or admin of this organisation sets up its programmes and batches.'}
          action={canManage ? <Button onClick={() => setAdding({ type: 'programme' })}>Add a programme</Button> : undefined}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {tree.length} programme{tree.length === 1 ? '' : 's'} · {totalPeople} placed {totalPeople === 1 ? 'person' : 'people'}
          </p>

          {tree.map((programme) => (
            <Card key={programme.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{programme.name}</span>
                  {programme.code && <Badge tone="slate">{programme.code}</Badge>}
                  {/* Derived on every read, never stored - see the routes. */}
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {programme.member_count} {programme.member_count === 1 ? 'person' : 'people'}
                  </span>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setAdding({ type: 'batch', parent: programme })}>+ Batch</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(programme)}>Rename</Button>
                    <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400"
                      onClick={() => confirmRemove(programme)}>Remove</Button>
                  </div>
                )}
              </div>

              {programme.children.length > 0 && (
                <div className="mt-3 space-y-1 border-l border-slate-200 pl-4 dark:border-slate-800">
                  {programme.children.map((batch) => (
                    <div key={batch.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
                      <div className="flex items-center gap-2 text-sm">
                        <ChevronRight size={13} className="text-slate-400 dark:text-slate-600" />
                        <span className="text-slate-700 dark:text-slate-300">{batch.name}</span>
                        {batch.code && <Badge tone="slate">{batch.code}</Badge>}
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {batch.member_count} {batch.member_count === 1 ? 'person' : 'people'}
                        </span>
                      </div>
                      {canManage && (
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(batch)}>Rename</Button>
                          <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400"
                            onClick={() => confirmRemove(batch)}>Remove</Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {adding && orgId && (
        <UnitModal
          path={path}
          type={adding.type}
          parent={adding.parent}
          onClose={() => setAdding(null)}
        />
      )}
      {editing && orgId && (
        <UnitModal path={path} unit={editing} type={editing.type} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function UnitModal({ path, unit, type, parent, onClose }: {
  path: string;
  unit?: UnitNode;
  type: 'programme' | 'batch';
  parent?: UnitNode;
  onClose: () => void;
}) {
  const [name, setName] = useState(unit?.name ?? '');
  const [code, setCode] = useState(unit?.code ?? '');
  const [order, setOrder] = useState(String(unit?.display_order ?? 0));
  const [error, setError] = useState<string | null>(null);

  const save = useApiMutation(
    (body: any) => (unit ? api('PATCH', `${path}/${unit.id}`, body) : api('POST', path, body)),
    [path],
    onClose,
  );

  const title = unit ? `Rename ${unit.name}` : type === 'programme' ? 'Add a programme' : `Add a batch to ${parent?.name}`;

  return (
    <Modal title={title} onClose={onClose}>
      <Field label="Name" hint={type === 'programme' ? 'e.g. PGP, EPGP, PhD' : 'e.g. PGP 2024'}>
        <Input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Code (optional)" hint="A short form used in exports and imports.">
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={type === 'programme' ? 'PGP' : 'PGP24'} />
      </Field>
      <Field label="Display order" hint="Lower numbers sort first.">
        <Input type="number" value={order} onChange={(e) => setOrder(e.target.value)} />
      </Field>
      {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={save.isPending || !name.trim()}
          onClick={() => {
            setError(null);
            save.mutate(
              unit
                ? { name: name.trim(), code: code.trim() || null, display_order: Number(order) || 0 }
                : { type, name: name.trim(), code: code.trim() || undefined, parent_id: parent?.id, display_order: Number(order) || 0 },
              { onError: (e: any) => setError(e.message) },
            );
          }}>
          {save.isPending ? 'Saving…' : unit ? 'Save' : 'Add'}
        </Button>
      </div>
    </Modal>
  );
}
