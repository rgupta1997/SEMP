import { useState } from 'react';
import { api } from '../lib/api';
import { useApi, useApiMutation } from '../lib/hooks';
import { describeSlot } from '../lib/stageTree';
import { Button, Card, Field, Input, Segmented, Select, Spinner, toast } from './ui';

// Full wizard: configures an arbitrary-depth stage tree (a pool stage whose branches
// feed either a knockout or ANOTHER pool stage, recursively), with optional manual
// bracket seeding at any knockout node. Mirrors apps/api/.../stage-orchestrator.ts's
// model exactly - see packages/shared/src/stage-config.ts for the wire format this
// serializes to.
//
// Scope note: manual TEAM ALLOCATION (pinning a specific team to a specific stage-1
// slot before pools are even formed) is still not exposed here - only manual
// KNOCKOUT SEEDING (pairing entrants within a bracket) and multi-level chaining are.

interface TokenEntrant { token: string; label: string }

interface KnockoutDraft {
  type: 'knockout';
  eliminationType: 'single' | 'double'; // always 'single' in this UI - double isn't implemented server-side yet
  seeding: 'auto' | 'manual';
  thirdPlaceMatch: boolean;
  manualPairs: Array<{ home: string | null; away: string | null }>;
}
interface GroupDraft {
  type: 'group';
  numGroups: number;
  doubleRound: boolean;
  branches: BranchDraft[];
}
interface BranchDraft {
  id: string;
  label: string;
  rankFrom: number;
  rankTo: number;
  childStage: StageNodeDraft;
}
type StageNodeDraft = GroupDraft | KnockoutDraft;

let nextLocalId = 1;
const newId = () => `n-${nextLocalId++}`;

const newKnockout = (): KnockoutDraft => ({ type: 'knockout', eliminationType: 'single', seeding: 'auto', thirdPlaceMatch: false, manualPairs: [] });
const newGroup = (): GroupDraft => ({ type: 'group', numGroups: 2, doubleRound: false, branches: [] });
const newBranch = (label: string): BranchDraft => ({ id: newId(), label, rankFrom: 1, rankTo: 1, childStage: newKnockout() });

const isPow2 = (n: number) => n >= 2 && (n & (n - 1)) === 0;

// The qualifier tokens a branch feeds into its childStage: rank-major, pool-minor
// ("A1","B1","A2","B2",...) - the exact same order stage-orchestrator.ts's
// qualifierLabels produces, so labels shown here match what the generated draw
// actually resolves against.
function qualifierEntrants(branch: BranchDraft, numGroups: number): TokenEntrant[] {
  const out: TokenEntrant[] = [];
  for (let rank = branch.rankFrom; rank <= branch.rankTo; rank++) {
    for (let pool = 1; pool <= numGroups; pool++) {
      const token = `${String.fromCharCode(64 + pool)}${rank}`;
      out.push({ token, label: describeSlot(token) ?? token });
    }
  }
  return out;
}

// Recursive validation: walks the tree computing each node's own entrant list from
// its ancestry (mirrors stage-orchestrator.ts's validateStageTree), returning the
// first problem found so the wizard can fail fast with one clear message.
function validateNode(node: StageNodeDraft, entrants: TokenEntrant[], label: string): string | null {
  if (node.type === 'group') {
    if (entrants.length < node.numGroups * 2) return `${label}: needs at least ${node.numGroups * 2} entrants for ${node.numGroups} pool${node.numGroups === 1 ? '' : 's'} (has ${entrants.length})`;
    if (node.branches.length === 0) return `${label}: add at least one branch`;
    const poolSize = Math.floor(entrants.length / node.numGroups);
    // Sibling branches off this same pool stage must not claim overlapping ranks -
    // e.g. Cup=1-2 and Plate=1-2 would both resolve to the same real teams once the
    // pool finishes (see stage-config.ts's collectStageTreeIssues for the server-side
    // mirror of this check).
    for (let i = 0; i < node.branches.length; i++) {
      for (let j = i + 1; j < node.branches.length; j++) {
        const a = node.branches[i]; const b = node.branches[j];
        if (a.rankFrom <= b.rankTo && b.rankFrom <= a.rankTo) {
          return `${label}: "${a.label || 'a branch'}" (ranks ${a.rankFrom}-${a.rankTo}) overlaps "${b.label || 'another branch'}" (ranks ${b.rankFrom}-${b.rankTo}) - each rank can only feed one branch`;
        }
      }
    }
    for (const b of node.branches) {
      if (b.rankTo < b.rankFrom) return `${label} → ${b.label || 'a branch'}: "to" rank must be ≥ "from" rank`;
      if (b.rankTo > poolSize) return `${label} → ${b.label || 'a branch'}: rank ${b.rankTo} exceeds this pool's size (${poolSize})`;
      const err = validateNode(b.childStage, qualifierEntrants(b, node.numGroups), b.label || 'A branch');
      if (err) return err;
    }
    return null;
  }
  if (entrants.length < 2) return `${label}: needs at least 2 entrants (has ${entrants.length})`;
  if (node.seeding === 'manual') {
    if (!isPow2(entrants.length)) return `${label}: manual seeding needs a power-of-two entrant count (has ${entrants.length}) - switch to auto seeding or adjust the rank range`;
    if (node.manualPairs.length * 2 !== entrants.length) return `${label}: pairing doesn't match the entrant count`;
    const used = new Set<string>();
    for (const p of node.manualPairs) {
      for (const tok of [p.home, p.away]) {
        if (!tok) continue;
        if (used.has(tok)) return `${label}: "${entrants.find((e) => e.token === tok)?.label ?? tok}" is assigned to more than one pair`;
        used.add(tok);
      }
    }
    const missing = entrants.filter((e) => !used.has(e.token));
    if (missing.length > 0) return `${label}: ${missing.map((m) => m.label).join(', ')} ${missing.length === 1 ? 'is' : 'are'} not assigned to a pair yet`;
  }
  return null;
}

// Serializes a draft node to the wire shape stage-config.ts expects. Tiebreakers
// aren't exposed in this UI - every pool stage uses the standard points/wins/lost
// order.
function toStageNode(draft: StageNodeDraft): any {
  if (draft.type === 'group') {
    return {
      type: 'group',
      numGroups: draft.numGroups,
      doubleRound: draft.doubleRound,
      tiebreakers: ['points', 'wins', 'lost'],
      branches: draft.branches.map((b) => ({
        id: b.id, label: b.label || undefined, rankFrom: b.rankFrom, rankTo: b.rankTo,
        childStage: toStageNode(b.childStage),
      })),
    };
  }
  return {
    type: 'knockout',
    eliminationType: draft.eliminationType,
    seeding: draft.seeding,
    thirdPlaceMatch: draft.thirdPlaceMatch,
    ...(draft.seeding === 'manual' ? { manualPairs: draft.manualPairs } : {}),
  };
}

function KnockoutEditor({ node, onChange, entrants }: { node: KnockoutDraft; onChange: (n: KnockoutDraft) => void; entrants: TokenEntrant[] }) {
  const n = entrants.length;
  const pow2 = isPow2(n);

  const setSeeding = (seeding: 'auto' | 'manual') => {
    if (seeding === 'manual') {
      const pairCount = Math.max(1, Math.floor(n / 2));
      onChange({ ...node, seeding, manualPairs: node.manualPairs.length === pairCount ? node.manualPairs : Array.from({ length: pairCount }, () => ({ home: null, away: null })) });
    } else {
      onChange({ ...node, seeding });
    }
  };
  const setPair = (i: number, side: 'home' | 'away', token: string) =>
    onChange({ ...node, manualPairs: node.manualPairs.map((p, idx) => (idx === i ? { ...p, [side]: token || null } : p)) });

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <p className="text-xs text-slate-400 dark:text-slate-500">
        {n} entrant{n === 1 ? '' : 's'} · single elimination{node.thirdPlaceMatch ? ' + 3rd place' : ''} (double elimination isn't supported yet).
      </p>

      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={node.thirdPlaceMatch} onChange={(e) => onChange({ ...node, thirdPlaceMatch: e.target.checked })} />
        Play a 3rd place match
      </label>

      <Field label="Seeding" hint={pow2 ? 'Auto seeds by draw order; manual lets you pick every first-round pairing.' : `Manual seeding needs a power-of-two entrant count (2, 4, 8, …) - this bracket has ${n}, so it will auto-seed.`}>
        <Segmented size="sm" value={node.seeding} onChange={setSeeding}
          options={[{ value: 'auto', label: 'Auto' }, { value: 'manual', label: 'Manual', }]} />
      </Field>

      {node.seeding === 'manual' && pow2 && (
        <div className="space-y-2">
          {node.manualPairs.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <Select value={p.home ?? ''} onChange={(e) => setPair(i, 'home', e.target.value)}>
                <option value="">— bye —</option>
                {entrants.map((t) => <option key={t.token} value={t.token}>{t.label}</option>)}
              </Select>
              <span className="text-center text-xs text-slate-400 dark:text-slate-500">vs</span>
              <Select value={p.away ?? ''} onChange={(e) => setPair(i, 'away', e.target.value)}>
                <option value="">— bye —</option>
                {entrants.map((t) => <option key={t.token} value={t.token}>{t.label}</option>)}
              </Select>
            </div>
          ))}
        </div>
      )}
      {node.seeding === 'manual' && !pow2 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">Adjust the branch's rank range above (or the pool count) so this bracket has a power-of-two entrant count before pairing manually.</p>
      )}
    </div>
  );
}

// Recursive: a branch's target is either a knockout (leaf) or another pool stage
// (which itself has branches, each recursing again) - this is what makes
// group → group → knockout chains possible.
function StageNodeEditor({ node, onChange, entrants, depth }: { node: StageNodeDraft; onChange: (n: StageNodeDraft) => void; entrants: TokenEntrant[]; depth: number }) {
  const setType = (type: 'group' | 'knockout') => { if (type !== node.type) onChange(type === 'group' ? newGroup() : newKnockout()); };

  return (
    <div className="space-y-2">
      <Segmented size="sm" value={node.type} onChange={setType} options={[{ value: 'group', label: 'Pools' }, { value: 'knockout', label: 'Knockout' }]} />
      {node.type === 'group'
        ? <GroupEditor node={node} onChange={onChange as (n: GroupDraft) => void} entrants={entrants} depth={depth} />
        : <KnockoutEditor node={node} onChange={onChange as (n: KnockoutDraft) => void} entrants={entrants} />}
    </div>
  );
}

function GroupEditor({ node, onChange, entrants, depth }: { node: GroupDraft; onChange: (n: GroupDraft) => void; entrants: TokenEntrant[]; depth: number }) {
  const addBranch = () => onChange({ ...node, branches: [...node.branches, newBranch(`Branch ${node.branches.length + 1}`)] });
  const removeBranch = (id: string) => onChange({ ...node, branches: node.branches.filter((b) => b.id !== id) });
  const updateBranch = (id: string, patch: Partial<BranchDraft>) => onChange({ ...node, branches: node.branches.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const poolSize = entrants.length ? Math.floor(entrants.length / node.numGroups) : null;

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Number of pools">
          <Input type="number" min={1} value={node.numGroups} onChange={(e) => onChange({ ...node, numGroups: Math.max(1, Number(e.target.value) || 1) })} />
        </Field>
        <label className="flex items-center gap-2 pt-6 text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={node.doubleRound} onChange={(e) => onChange({ ...node, doubleRound: e.target.checked })} />
          Double round-robin
        </label>
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        {entrants.length} entrant{entrants.length === 1 ? '' : 's'} into {node.numGroups} pool{node.numGroups === 1 ? '' : 's'}{poolSize != null ? ` (~${poolSize} each)` : ''}.
      </p>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Branches</span>
          <Button size="sm" variant="outline" onClick={addBranch}>+ Add branch</Button>
        </div>
        <div className="space-y-3">
          {node.branches.map((b) => {
            const childEntrants = qualifierEntrants(b, node.numGroups);
            return (
              <Card key={b.id} className="p-3">
                <div className="grid grid-cols-[1fr_84px_84px_auto] items-end gap-2">
                  <Field label="Name"><Input value={b.label} onChange={(e) => updateBranch(b.id, { label: e.target.value })} placeholder="e.g. Cup" /></Field>
                  <Field label="From rank"><Input type="number" min={1} value={b.rankFrom} onChange={(e) => updateBranch(b.id, { rankFrom: Number(e.target.value) || 1 })} /></Field>
                  <Field label="To rank"><Input type="number" min={1} value={b.rankTo} onChange={(e) => updateBranch(b.id, { rankTo: Number(e.target.value) || 1 })} /></Field>
                  <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" onClick={() => removeBranch(b.id)} disabled={node.branches.length <= 1}>Remove</Button>
                </div>
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <div className="mb-2 text-xs text-slate-400 dark:text-slate-500">
                    Feeds into ({childEntrants.length} qualifier{childEntrants.length === 1 ? '' : 's'}: {childEntrants.map((e) => e.label).join(', ') || '—'}):
                  </div>
                  <StageNodeEditor node={b.childStage} onChange={(n) => updateBranch(b.id, { childStage: n })} entrants={childEntrants} depth={depth + 1} />
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Mirrors generators/groups.ts's snake-seeding formula exactly, so "slot N" in the
// manual-placement UI shows the same pool a team dropped into that slot would
// actually land in once generateAllStages runs.
function poolForSlot(slotIndex: number, numGroups: number): number {
  const i = slotIndex - 1;
  const cycle = i % (2 * numGroups);
  return (cycle < numGroups ? cycle : 2 * numGroups - 1 - cycle) + 1;
}

export function StageConfigWizard({ tournamentDisciplineId, onGenerated }: { tournamentDisciplineId: string; onGenerated: () => void }) {
  const teamsPath = `/teams?tournament_discipline_id=${tournamentDisciplineId}`;
  const { data: teams = [], isLoading: teamsLoading } = useApi<any[]>(teamsPath);
  const [root, setRoot] = useState<GroupDraft>(() => ({ ...newGroup(), branches: [newBranch('Cup')] }));
  const [manualAllocation, setManualAllocation] = useState<Record<number, string>>({});
  const [showManualAllocation, setShowManualAllocation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rootEntrants: TokenEntrant[] = teams.map((t) => ({
    token: t.id,
    label: t.organizations?.short_name || t.organizations?.name ? `${t.name} — ${t.organizations.short_name || t.organizations.name}` : t.name,
  }));

  const usedTeamIds = new Set(Object.values(manualAllocation).filter(Boolean));
  const setSlotTeam = (slotIndex: number, teamId: string) => setManualAllocation((m) => {
    const next = { ...m };
    if (teamId) next[slotIndex] = teamId; else delete next[slotIndex];
    return next;
  });

  const generateAll = useApiMutation(
    (body: any) => api('POST', `/tournament-disciplines/${tournamentDisciplineId}/fixtures/generate-all`, body),
    [`/tournament-disciplines/${tournamentDisciplineId}/fixtures`, teamsPath],
    () => { toast.success('Draw generated'); onGenerated(); },
  );

  const submit = () => {
    setError(null);
    const err = validateNode(root, rootEntrants, 'Pools');
    if (err) { setError(err); return; }
    const manualAllocationEntries = Object.entries(manualAllocation).map(([slotIndex, teamId]) => ({ slotIndex: Number(slotIndex), teamId }));
    generateAll.mutate({ config: { root: toStageNode(root), manualAllocation: manualAllocationEntries } }, { onError: (e: any) => setError(e.message) });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Configure a pool stage that feeds one or more knockout brackets - each branch
        can itself be another pool stage before its own knockout, and any knockout can
        be seeded automatically or paired by hand. Every stage generates up front;
        placeholder slots fill in automatically as each pool finishes.
      </p>

      {teamsLoading ? <Spinner label="Loading teams…" /> : (
        <p className="text-xs text-slate-400 dark:text-slate-500">{teams.length} team{teams.length === 1 ? '' : 's'} registered to this draw.</p>
      )}

      <GroupEditor node={root} onChange={setRoot} entrants={rootEntrants} depth={0} />

      {teams.length > 0 && (
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setShowManualAllocation((v) => !v)}>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Manual team placement (optional)</span>
            <span className="text-xs font-medium text-brand-600 dark:text-brand-400">{showManualAllocation ? 'Hide' : 'Show'}</span>
          </button>
          {showManualAllocation && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Pin specific teams to specific slots before pools are drawn - e.g. keep two
                strong teams apart. Every unpinned team fills the remaining slots
                automatically, in registration order.
              </p>
              {teams.map((_: any, i: number) => {
                const slotIndex = i + 1;
                const pool = poolForSlot(slotIndex, root.numGroups);
                const current = manualAllocation[slotIndex] ?? '';
                return (
                  <div key={slotIndex} className="grid grid-cols-[110px_1fr] items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Slot {slotIndex} → Pool {String.fromCharCode(64 + pool)}</span>
                    <Select value={current} onChange={(e) => setSlotTeam(slotIndex, e.target.value)}>
                      <option value="">— auto —</option>
                      {teams.filter((t: any) => t.id === current || !usedTeamIds.has(t.id)).map((t: any) => (
                        <option key={t.id} value={t.id}>{rootEntrants.find((e) => e.token === t.id)?.label ?? t.name}</option>
                      ))}
                    </Select>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex justify-end">
        <Button onClick={submit} disabled={generateAll.isPending}>{generateAll.isPending ? 'Generating…' : 'Generate all stages'}</Button>
      </div>
    </div>
  );
}
