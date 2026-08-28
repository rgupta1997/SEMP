import { useMemo, useState } from 'react';
import { Building2, ChevronRight, Pencil, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { UNIT_LABEL_PRESETS, type UnitLabels } from '@semp/shared';
import { api } from '../../lib/api';
import { useParams } from 'react-router-dom';
import { useApi } from '../../lib/hooks';
import { useOrgUnits, type UnitNode } from '../../lib/units';
import { useAuth } from '../../lib/auth';
import { useWorkspace } from '../../lib/useWorkspace';
import { usePermissions } from '../../lib/permissions';
import { CapabilityLock } from '../../components/CapabilityLock';
import {
  Badge, Button, Card, CardBody, EmptyState, Field, Input, Modal, PageHeader, Select,
  Spinner, confirmDialog, toast, cn,
} from '../../components/ui';

// Campuses & Units - a first-class section of the organisation workspace.
//
// It was a tab inside Administration, which was the wrong home for it. Administration
// is settings: things you configure once and rarely reopen. This is a working screen -
// it answers "which campuses do we have, and who is in each" - and it is the screen an
// organiser has to get right before any internal championship can run at all, because
// a player can only be picked for the unit they belong to.
//
// Two jobs on one screen, and they are the same structure seen twice:
//
//   * the ADMINISTRATIVE tree - who belongs where, who runs it, what it is called
//   * the COMPETITIVE one     - the entrants of an intra-organisation championship
//
// The second is why this screen stopped being read-only. A campus here IS a
// competitor in an inter-campus meet, so "add a campus" and "archive a campus" are
// competition-shaping acts, and the panel has to say what they cost before they
// happen: a unit that has competed cannot be deleted, because its standings rows
// point at it and a medal table that loses a row is worse than a refused delete.
//
// Everything is written with Tailwind + theme tokens rather than the inline hex the
// other admin panels use, so it follows the light/dark switch in the header. A card
// that stays white on a dark canvas is not a style preference, it is a bug.

const MONO = 'font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400';

// The shape GET /organizations/:id/members actually returns. The Prisma relation is
// named `users` (plural), not `user` - reading `m.user.name` silently yielded
// undefined and every option in the administrator picker rendered as "Unnamed".
interface Member {
  user_id: string;
  status: string;
  users?: { id: string; name: string; email: string | null } | null;
}

const initials = (s: string) =>
  s.split(/[^A-Za-z0-9]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '—';

const STATUS_TONE = { ACTIVE: 'green', SETUP: 'amber', ARCHIVED: 'slate' } as const;

// ---------------------------------------------------------------------------

function UnitModal({
  orgId, labels, unit, parentId, type, campuses, people, canAppoint, onClose, onSaved,
}: {
  orgId: string;
  labels: UnitLabels;
  /** Present when editing; absent when creating. */
  unit?: UnitNode & { parent?: UnitNode | null };
  parentId?: string | null;
  type: 'campus' | 'department';
  campuses: UnitNode[];
  people: Array<{ id: string; name: string }>;
  /**
   * May this person name who RUNS the unit?
   *
   * Separate from being able to edit the unit at all, because it is a different act:
   * authorisation reads `org_units.admin_user_id` (campus-admin.ts), so this field
   * delegates authority over the unit's squads. The person named as running a campus
   * may correct its name and may not hand it to somebody else - or take it off
   * themselves and leave it with nobody. The server enforces the same split
   * (`assertMayAppoint`).
   */
  canAppoint: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!unit;
  const noun = type === 'campus' ? labels.campus : labels.department;

  const [name, setName] = useState(unit?.name ?? '');
  const [code, setCode] = useState(unit?.code ?? '');
  const [status, setStatus] = useState(unit?.status ?? 'ACTIVE');
  const [adminId, setAdminId] = useState(unit?.admin?.id ?? '');
  const [parent, setParent] = useState(parentId ?? unit?.parent?.id ?? campuses[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  const canSave = name.trim().length > 0 && (type === 'campus' || !!parent);

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        code: code.trim() || null,
        status,
        // Omitted entirely, not sent as the unchanged value: the server checks for
        // the PRESENCE of the key, because `admin_user_id: null` is a removal and is
        // the same delegation decision seen from the other side.
        ...(canAppoint ? { admin_user_id: adminId || null } : {}),
        ...(type === 'department' ? { parent_id: parent } : {}),
      };
      if (editing) await api('PATCH', `/organizations/${orgId}/units/${unit!.id}`, body);
      else await api('POST', `/organizations/${orgId}/units`, { ...body, type });
      toast.success(editing ? `${name.trim()} updated` : `${noun} added`);
      onSaved();
      onClose();
    } catch (e: any) {
      // The server refuses for real reasons - archiving a campus mid-championship,
      // a second campus without the capability - and each carries a sentence worth
      // showing verbatim rather than replacing with "Could not save".
      toast.error(e?.message ?? `Could not save that ${noun.toLowerCase()}`);
    } finally { setBusy(false); }
  };

  return (
    <Modal
      title={editing ? `Edit ${unit!.name}` : `Add a ${noun.toLowerCase()}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!canSave || busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'campus' ? 'Bangalore' : 'Engineering'} autoFocus />
        </Field>

        <Field label="Short code" hint="Shown on tiles and standings tables where the full name will not fit.">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={type === 'campus' ? 'BLR' : 'ENG'} maxLength={24} />
        </Field>

        {type === 'department' && (
          <Field label={labels.campus} hint={`Which ${labels.campus.toLowerCase()} this ${labels.department.toLowerCase()} belongs to.`}>
            <Select value={parent} onChange={(e) => setParent(e.target.value)}>
              {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        )}

        <Field
          label="Status"
          hint="Active takes part in championships. Setup is still being built and is offered as a role scope but never as an entrant."
        >
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ACTIVE">Active</option>
            <option value="SETUP">Setup</option>
            <option value="ARCHIVED">Archived</option>
          </Select>
        </Field>

        {canAppoint ? (
          <Field label="Administrator" hint="Optional. The person who runs it — they must already be a member here.">
            <Select value={adminId} onChange={(e) => setAdminId(e.target.value)}>
              <option value="">Nobody assigned</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        ) : (
          <Field label="Administrator">
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              {unit?.admin ? `Run by ${unit.admin.name}.` : 'Nobody assigned.'}{' '}
              Changing who runs a {noun.toLowerCase()} is an owner or administrator decision.
            </p>
          </Field>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function LabelsModal({ orgId, labels, onClose, onSaved }: {
  orgId: string; labels: UnitLabels; onClose: () => void; onSaved: () => void;
}) {
  const [draft, setDraft] = useState<UnitLabels>(labels);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api('PATCH', `/organizations/${orgId}/unit-labels`, draft);
      toast.success('Renamed');
      onSaved();
      onClose();
    } catch (e: any) { toast.error(e?.message ?? 'Could not rename those'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title="What do you call these?"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || !draft.campus.trim() || !draft.department.trim()}>
            {busy ? 'Saving…' : 'Save names'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {/* The structure never changes - only the words do. Saying so here stops
            this being read as a way to add a third level. */}
        <p className="text-[13.5px] leading-relaxed text-slate-600 dark:text-slate-300">
          These are names only. The structure stays two levels deep, and renaming them
          changes nothing about who belongs where or who has competed.
        </p>

        <div className="flex flex-wrap gap-2">
          {UNIT_LABEL_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setDraft(p.labels)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition',
                draft.campus === p.labels.campus && draft.department === p.labels.department
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-slate-200 hover:border-brand-300 dark:border-slate-800 dark:hover:border-brand-700',
              )}
            >
              {p.labels.campus} / {p.labels.department}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Top level">
            <Input value={draft.campus} onChange={(e) => setDraft((d) => ({ ...d, campus: e.target.value }))} maxLength={24} />
          </Field>
          <Field label="Level beneath it">
            <Input value={draft.department} onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))} maxLength={24} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function Counts({ node, labels }: { node: UnitNode; labels: UnitLabels }) {
  const items: Array<[string, number]> = [
    ['People', node.member_count],
    ['Teams', node.team_count],
    ['Events', node.event_count],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map(([label, n]) => (
        <span key={label} className="flex items-baseline gap-1.5">
          <span className="text-[13.5px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">{n}</span>
          <span className={MONO}>{label}</span>
        </span>
      ))}
      {node.type === 'campus' && node.children.length > 0 && (
        <span className="flex items-baseline gap-1.5">
          <span className="text-[13.5px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">{node.children.length}</span>
          <span className={MONO}>{labels.department}s</span>
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** One row of GET /organizations/:id/people. */
interface Person {
  id: string;
  user_id: string;
  name: string | null;
  email: string | null;
  member_code: string | null;
  units: Array<{ id: string; name: string | null; type: string | null }>;
  verification: string;
}

/**
 * The people in one unit.
 *
 * EXACT membership, not roll-up. Placement is explicit per unit now: somebody who
 * belongs to Bangalore is in Bangalore's list because they were put there, and
 * somebody in Sales alone is not - being in a department no longer implies being in
 * the campus above it. That is what multi-membership buys, and quietly rolling
 * departments up would take it away again by making the two indistinguishable.
 */
function peopleIn(all: Person[], unit: UnitNode): Person[] {
  return all.filter((p) => p.units.some((u) => u.id === unit.id));
}

function PeoplePanel({ orgId, unit, people, labels, loading }: {
  orgId: string;
  unit: UnitNode | null;
  people: Person[];
  labels: UnitLabels;
  loading: boolean;
}) {
  const noun = unit?.type === 'campus' ? labels.campus : labels.department;

  if (!unit) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon={<Users size={22} />}
            title="Pick one to see its people"
            description={`Select a ${labels.campus.toLowerCase()} or ${labels.department.toLowerCase()} on the left and everybody in it appears here.`}
          />
        </CardBody>
      </Card>
    );
  }

  const rows = peopleIn(people, unit);
  const unplacedNote = unit.type === 'campus' && (unit.children ?? []).length > 0
    ? `People in its ${labels.department.toLowerCase()}s are listed separately unless they were added here too.`
    : null;

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-display text-[15px] font-extrabold text-slate-900 dark:text-slate-100">
              {unit.name}
            </h3>
            <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">
              {rows.length} {rows.length === 1 ? 'person' : 'people'} in this {noun.toLowerCase()}
              {unplacedNote ? ` · ${unplacedNote}` : ''}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { window.location.assign(`/organizations/${orgId}/students`); }}
          >Manage in Players</Button>
        </div>

        {loading ? <Spinner /> : rows.length === 0 ? (
          <EmptyState
            icon={<Users size={20} />}
            title={`Nobody in ${unit.name} yet`}
            description={`Assign people to it from the Players screen — a player can only be picked for the ${noun.toLowerCase()} they belong to, so an empty one cannot field a team.`}
          />
        ) : (
          <ul className="max-h-[26rem] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {rows.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <span
                  aria-hidden
                  className="grid h-8 w-8 flex-none place-items-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >{initials(p.name ?? '?')}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-slate-800 dark:text-slate-100">
                    {p.name ?? 'Unnamed'}
                  </span>
                  <span className="block truncate text-[11.5px] text-slate-500 dark:text-slate-400">
                    {p.member_code ? `${p.member_code} · ` : ''}{p.email ?? 'No email'}
                  </span>
                </span>
                {p.verification !== 'verified' && <Badge tone="amber">{p.verification}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function CampusesPage() {
  const { orgId = '' } = useParams();
  const ws = useWorkspace();
  // Shaping the institution is `org.structure.manage`; the server splits the routes
  // the same way (org-units.routes.ts). Before this the page offered Rename levels,
  // Add, Edit and Delete to everybody who could reach the screen - which includes a
  // Sports Admin, because the nav gives them Campuses & Units as a WORKING screen -
  // and every one of those buttons returned "Only an organization owner/admin can
  // change the structure".
  //
  // Hidden, not disabled. A disabled control says "you could do this if something
  // changed", which is true of a plan capability and false of a permission you were
  // never given; the honest form of the second is a line saying who can.
  const perms = usePermissions();
  const canShape = perms.hasOrgPermission('org.structure.manage', orgId);
  // The person NAMED as running a unit may correct that unit's own row - its name,
  // code and status - and nothing else: not its administrator, not its siblings, not
  // the levels. campus-admin.ts had complained about this in prose for a while ("the
  // person named as running a campus could not even edit its own row"), and the
  // server now allows it (`unitEditor`), so the button has to exist or the permission
  // is unreachable.
  const myId = useAuth().ctx?.user?.id ?? null;
  const runsUnit = (n: UnitNode) => !!myId && n.admin?.id === myId;
  const canEditUnit = (n: UnitNode) => canShape || runsUnit(n);
  const { units, labels, campuses, isLoading, refetch } = useOrgUnits(orgId);
  const members = useApi<Member[]>(`/organizations/${orgId}/members`);
  const peopleQ = useApi<Person[]>(orgId ? `/organizations/${orgId}/people` : null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const allUnits = useMemo(
    () => units.flatMap((c) => [c, ...(c.children ?? [])]),
    [units],
  );
  const selected = allUnits.find((u) => u.id === selectedId) ?? null;

  // Everybody the organisation has NOT placed anywhere. Surfaced rather than left to
  // be discovered at squad selection, because an unplaced person is refused from
  // every internal team and the refusal happens far away from here.
  const unplaced = (peopleQ.data ?? []).filter((p) => p.units.length === 0).length;

  const [editing, setEditing] = useState<null | {
    unit?: UnitNode & { parent?: UnitNode | null }; parentId?: string | null; type: 'campus' | 'department';
  }>(null);
  const [renaming, setRenaming] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Active members only. The server refuses to name a pending or removed member as
  // an administrator, so offering them here would mean a picker whose choices are
  // rejected on save - the worst kind of option.
  const people = useMemo(() => (members.data ?? [])
    .filter((m) => m.status === 'active' && !!m.users?.id)
    .map((m) => ({
      id: m.users!.id,
      // The email disambiguates two people with the same name, which is common
      // enough in an institution that a bare name list is genuinely ambiguous.
      name: m.users!.email ? `${m.users!.name} · ${m.users!.email}` : m.users!.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name)), [members.data]);

  // A second campus needs the capability. Shown as a locked button rather than a
  // hidden one: somebody who cannot find a feature concludes it does not exist.
  const canAddCampus = campuses.length === 0 || ws.granted.has('multi_campus');

  const toggle = (id: string) => setExpanded((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const remove = async (node: UnitNode, parent: UnitNode | null) => {
    // The impact is asked for BEFORE the question, so the dialog can say "this
    // affects 118 people" rather than "are you sure?".
    let impact: { members: number; entries: number; departments: Array<unknown> } | null = null;
    try {
      impact = await api('GET', `/organizations/${orgId}/units/${node.id}/impact`);
    } catch { /* fall through to the generic warning */ }

    const noun = node.type === 'campus' ? labels.campus.toLowerCase() : labels.department.toLowerCase();
    if (impact && impact.entries > 0) {
      // Refused by the server too - this just says so without a round trip.
      await confirmDialog({
        title: `${node.name} has competed`,
        message: `It has been entered into ${impact.entries} championship${impact.entries === 1 ? '' : 's'}, and its results point at it. Archive it instead — archiving keeps every result and simply stops it being offered as an entrant.`,
        confirmLabel: 'I understand',
      });
      return;
    }

    const lines = [
      impact?.members ? `${impact.members} ${impact.members === 1 ? 'person loses their placement' : 'people lose their placement'} (they stay members).` : null,
      impact?.departments?.length ? `${impact.departments.length} ${labels.department.toLowerCase()}${impact.departments.length === 1 ? '' : 's'} beneath it go with it.` : null,
    ].filter(Boolean).join(' ');

    const ok = await confirmDialog({
      title: `Delete ${node.name}?`,
      message: lines || `This ${noun} will be removed.`,
      confirmLabel: `Delete ${noun}`,
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await api('DELETE', `/organizations/${orgId}/units/${node.id}`);
      toast.success(`${node.name} removed`);
      refetch();
    } catch (e: any) { toast.error(e?.message ?? 'Could not remove that'); }
    void parent;
  };

  if (isLoading) return <Spinner />;

  return (
    <>
      <PageHeader
        title={`${labels.campus}es & ${labels.department}s`}
        subtitle="Who belongs where — and who competes for whom in a championship run inside this organisation."
      />

      {unplaced > 0 && (
        <div className="mb-4 rounded-card border border-eos-warn-soft bg-eos-warn-soft px-4 py-3 text-[13px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
          <strong className="font-semibold">{unplaced}</strong>{' '}
          {unplaced === 1 ? 'person is' : 'people are'} not assigned to a {labels.campus.toLowerCase()} or{' '}
          {labels.department.toLowerCase()} yet. They cannot be picked for any team in an internal
          championship until they are — assign them on the Players screen.
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <Card>
        <CardBody>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-[240px]">
              <h3 className="font-display text-[16px] font-extrabold text-slate-900 dark:text-slate-100">
                {labels.campus}es &amp; {labels.department}s
              </h3>
              <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
                The structure a scoped role is granted against — and the entrants of a
                championship contested inside this organisation.
              </p>
            </div>
            {canShape ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>Rename levels</Button>
                <Button
                  size="sm"
                  disabled={!canAddCampus}
                  title={canAddCampus ? undefined : 'Running more than one campus is a plan capability'}
                  onClick={() => setEditing({ type: 'campus' })}
                >
                  <Plus size={14} /> Add {labels.campus.toLowerCase()}
                </Button>
              </div>
            ) : (
              // Says who can, so this reads as a boundary rather than as a page that
              // is missing something.
              <p className="max-w-[22rem] text-[12.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                You can see the structure and who is in it{units.some(runsUnit) || units.some((c) => (c.children ?? []).some(runsUnit))
                  ? ', and edit the details of what you run'
                  : ''}. Adding, renaming or removing a{' '}
                {labels.campus.toLowerCase()} is an owner or administrator decision.
              </p>
            )}
          </div>

          {canShape && !canAddCampus && (
            <div className="mb-4">
              <CapabilityLock capability="multi_campus" title={`More than one ${labels.campus.toLowerCase()}`} />
            </div>
          )}

          {units.length === 0 ? (
            <EmptyState
              icon={<Building2 size={24} />}
              title={`No ${labels.campus.toLowerCase()} yet`}
              description={`Add one and it becomes available as a role scope, a placement for your people, and an entrant in championships run inside this organisation.`}
              action={canShape
                ? <Button onClick={() => setEditing({ type: 'campus' })}><Plus size={14} /> Add {labels.campus.toLowerCase()}</Button>
                : undefined}
            />
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {units.map((c) => {
                const open = expanded.has(c.id);
                return (
                  <div key={c.id} className="py-3.5 first:pt-0">
                    <div
                      className={cn(
                        'flex flex-wrap items-center gap-3 rounded-lg px-1 py-0.5 transition-colors',
                        selectedId === c.id && 'bg-brand-50 dark:bg-brand-900/25',
                      )}
                      onClick={() => setSelectedId(c.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(c.id); } }}
                    >
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggle(c.id); }}
                        aria-expanded={open}
                        aria-label={open ? `Collapse ${c.name}` : `Expand ${c.name}`}
                        className="grid h-8 w-8 flex-none place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      >
                        <ChevronRight size={15} className={cn('transition-transform', open && 'rotate-90')} />
                      </button>

                      <span
                        aria-hidden
                        className="grid h-9 w-9 flex-none place-items-center rounded-[9px] bg-brand-200 font-display text-[12px] font-extrabold text-brand-600 dark:bg-brand-900/40 dark:text-brand-300"
                      >{c.code ?? initials(c.name)}</span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-[14px] font-bold text-slate-900 dark:text-slate-100">{c.name}</span>
                          <Badge tone={STATUS_TONE[c.status as keyof typeof STATUS_TONE] ?? 'slate'}>{c.status}</Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                          <Counts node={c} labels={labels} />
                          {c.admin
                            ? <span className="text-[12.5px] text-slate-500 dark:text-slate-400">Run by {c.admin.name}</span>
                            : <span className="text-[12.5px] text-slate-400 dark:text-slate-500">No administrator</span>}
                        </div>
                      </div>

                      {canEditUnit(c) && (
                        <div className="flex flex-none items-center gap-1">
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing({ unit: c, type: 'campus' }); }} aria-label={`Edit ${c.name}`}>
                            <Pencil size={14} />
                          </Button>
                          {/* Deleting is never the unit administrator's - removing the
                              thing you run is not the same as correcting its name. */}
                          {canShape && (
                            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); remove(c, null); }} aria-label={`Delete ${c.name}`}>
                              <Trash2 size={14} />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>

                    {open && (
                      <div className="mt-2 pl-[76px]">
                        {(c.children ?? []).map((d) => (
                          <div
                            key={d.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedId(d.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(d.id); } }}
                            className={cn(
                              'flex flex-wrap items-center gap-3 border-t border-slate-100 py-2.5 transition-colors dark:border-slate-800',
                              selectedId === d.id && 'bg-brand-50 dark:bg-brand-900/25',
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200">{d.name}</span>
                                {d.code && <span className={MONO}>{d.code}</span>}
                                <Badge tone={STATUS_TONE[d.status as keyof typeof STATUS_TONE] ?? 'slate'}>{d.status}</Badge>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                                <Counts node={d} labels={labels} />
                                {d.admin && <span className="text-[12.5px] text-slate-500 dark:text-slate-400">Run by {d.admin.name}</span>}
                              </div>
                            </div>
                            {canEditUnit(d) && (
                              <div className="flex flex-none items-center gap-1">
                                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing({ unit: { ...d, parent: c }, type: 'department' }); }} aria-label={`Edit ${d.name}`}>
                                  <Pencil size={14} />
                                </Button>
                                {canShape && (
                                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); remove(d, c); }} aria-label={`Delete ${d.name}`}>
                                    <Trash2 size={14} />
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}

                        {canShape && (
                          <div className="border-t border-slate-100 pt-2.5 dark:border-slate-800">
                            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setEditing({ type: 'department', parentId: c.id }); }}>
                              <Plus size={13} /> Add {labels.department.toLowerCase()} to {c.name}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* The second column: who is actually in the thing selected on the left. This
          is the half the structure exists for - a campus with nobody in it cannot
          field a team, and that is invisible on a tree of names alone. */}
      <PeoplePanel
        orgId={orgId}
        unit={selected}
        people={peopleQ.data ?? []}
        labels={labels}
        loading={peopleQ.isLoading}
      />
      </div>

      {/* What this structure is FOR, stated once. Without it the screen reads as
          filing, and nobody fills in filing. */}
      <Card className="mt-4">
        <CardBody>
          <h4 className={cn(MONO, 'mb-2')}>What this is used for</h4>
          <ul className="grid gap-2 text-[13.5px] leading-relaxed text-slate-600 dark:text-slate-300">
            <li className="flex gap-2.5">
              <Users size={15} className="mt-0.5 flex-none text-brand-600 dark:text-brand-400" aria-hidden />
              Placing people. A player belongs to one {labels.department.toLowerCase()}, and that is what
              makes them eligible for its team.
            </li>
            <li className="flex gap-2.5">
              <Building2 size={15} className="mt-0.5 flex-none text-brand-600 dark:text-brand-400" aria-hidden />
              Running championships inside the organisation — {labels.campus.toLowerCase()} against
              {' '}{labels.campus.toLowerCase()}, or {labels.department.toLowerCase()} against {labels.department.toLowerCase()}.
            </li>
            <li className="flex gap-2.5">
              <ShieldCheck size={15} className="mt-0.5 flex-none text-brand-600 dark:text-brand-400" aria-hidden />
              Scoping a role. “Sports Admin” granted here reaches this {labels.campus.toLowerCase()} and nothing else.
            </li>
          </ul>
        </CardBody>
      </Card>

      {editing && (
        <UnitModal
          orgId={orgId}
          labels={labels}
          unit={editing.unit}
          parentId={editing.parentId}
          type={editing.type}
          campuses={campuses}
          people={people}
          canAppoint={canShape}
          onClose={() => setEditing(null)}
          onSaved={refetch}
        />
      )}
      {renaming && (
        <LabelsModal orgId={orgId} labels={labels} onClose={() => setRenaming(false)} onSaved={refetch} />
      )}
    </>
  );
}
