import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { TEAM_MEMBER_ROLE } from '@semp/shared';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { useApi, useApiMutation } from '../../lib/hooks';
import { titleCase } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { Avatar, BackButton, Badge, Button, Card, CardBody, CardHeader, Checkbox, confirmDialog, Field, Input, Modal, Pills, Progress, SearchInput, Select, Spinner, StatusBadge, Tabs, Textarea, toast } from '../../components/ui';
import { EnterChampionshipsPanel } from '../../components/EnterChampionshipsModal';

interface BulkResult { added: number; skipped: { label: string; reason: string }[]; total: number }

// Rename a team. Discipline + championship are managed per entry now, not here.
function EditTeamModal({ team, onClose }: { team: any; onClose: () => void }) {
  const path = `/teams/${team.id}`;
  const [name, setName] = useState(team.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const update = useApiMutation(
    (body: { name: string }) => api('PATCH', path, body),
    [path, `/teams?organization_id=${team.organization_id}`],
  );

  const submit = () => {
    setError(null);
    if (!name.trim()) { setError('Team name is required'); return; }
    update.mutate({ name: name.trim() }, { onSuccess: () => onClose(), onError: (e: any) => setError(e.message) });
  };

  return (
    <Modal title="Edit team" onClose={onClose}>
      <Field label="Team name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!name.trim() || update.isPending} onClick={submit}>{update.isPending ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </Modal>
  );
}

// Parse pasted roster lines: "Name, email@x.com, 7" (jersey optional, order-tolerant
// for email vs name). One member per non-empty line.
function parsePasted(text: string): { name?: string; email?: string; jersey_number?: number }[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/[,\t;]/).map((p) => p.trim()).filter(Boolean);
    const email = parts.find((p) => /\S+@\S+\.\S+/.test(p));
    const jerseyTok = parts.find((p) => /^#?\d{1,3}$/.test(p));
    const name = parts.find((p) => p !== email && p !== jerseyTok);
    return {
      name,
      email,
      jersey_number: jerseyTok ? Number(jerseyTok.replace('#', '')) : undefined,
    };
  }).filter((m) => m.email || m.name);
}

// Inline "Add players" block (not a popup). Lists the organization's members in a
// table you tick to add, or paste a list. Shows the import result inline when done.
function AddPlayersPanel({ teamId, institutionId, existingUserIds, remaining, onClose }:
  { teamId: string; institutionId?: string; existingUserIds: Set<string>; remaining: number; onClose: () => void }) {
  const [tab, setTab] = useState('roster');
  // Source from the org's members (organization_members), not the legacy
  // users.organization_id column — a user can belong to several orgs, and members
  // added via the Members page only get an organization_members row.
  const { data: orgMembers = [], isLoading } = useApi<any[]>(institutionId ? `/organizations/${institutionId}/members` : null);
  const users = useMemo(
    () => orgMembers.filter((m) => m.users && m.status !== 'pending' && m.status !== 'past').map((m) => m.users),
    [orgMembers],
  );
  const candidates = useMemo(() => users.filter((u) => !existingUserIds.has(u.id)), [users, existingUserIds]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [paste, setPaste] = useState('');
  const [role, setRole] = useState('player');
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filter the member list by name or mobile (digits-tolerant) / email.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qd = search.replace(/\D/g, '');
    if (!q) return candidates;
    return candidates.filter((u) =>
      (u.name ?? '').toLowerCase().includes(q)
      || (u.email ?? '').toLowerCase().includes(q)
      || (qd.length >= 2 && !!u.phone && u.phone.replace(/\D/g, '').includes(qd)));
  }, [candidates, search]);

  const parsed = useMemo(() => parsePasted(paste), [paste]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allChecked = shown.length > 0 && shown.every((u) => selected.has(u.id));

  const bulk = useApiMutation<{ members: any[] }, BulkResult>(
    (body) => api('POST', `/teams/${teamId}/members/bulk`, body),
    [`/teams/${teamId}`],
  );

  const members = tab === 'roster'
    ? candidates.filter((u) => selected.has(u.id)).map((u) => ({ user_id: u.id, role }))
    : parsed.map((m) => ({ ...m, role }));

  const submit = () => {
    setError(null);
    if (members.length === 0) { setError('Nothing to add'); return; }
    bulk.mutate({ members }, {
      onSuccess: (r) => { setResult(r); setSelected(new Set()); setPaste(''); },
      onError: (e: any) => setError(e.message),
    });
  };

  return (
    <Card className="mb-4 p-5 ring-1 ring-brand-200 dark:ring-brand-500/30">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">Add players</h3>
        <button onClick={onClose} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Close</button>
      </div>

      {result ? (
        <div>
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-300"><span className="font-bold text-emerald-600">{result.added}</span> player{result.added === 1 ? '' : 's'} added · squad now {result.total}.</p>
          {result.skipped.length > 0 && (
            <div className="mb-3 max-h-40 overflow-auto rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 text-sm">
              <div className="mb-1 font-semibold text-slate-600 dark:text-slate-300">Skipped {result.skipped.length}:</div>
              {result.skipped.map((s, i) => <div key={i} className="text-slate-500 dark:text-slate-400">{s.label} — {s.reason}</div>)}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setResult(null)}>Add more</Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <Tabs active={tab} onChange={setTab} tabs={[
              { id: 'roster', label: 'From organization', badge: candidates.length ? <Badge tone="slate">{candidates.length}</Badge> : undefined },
              { id: 'paste', label: 'Paste list' },
            ]} />
          </div>

          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-slate-500 dark:text-slate-400">{remaining} squad slot{remaining === 1 ? '' : 's'} left</span>
            <label className="flex items-center gap-2">
              <span className="text-slate-500 dark:text-slate-400">Add as</span>
              <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-auto">
                <option value="player">player</option>
                <option value="captain">captain</option>
                <option value="manager">manager</option>
                <option value="coach">coach</option>
              </Select>
            </label>
          </div>

          {tab === 'roster' ? (
            isLoading ? <Spinner /> : candidates.length === 0 ? (
              <p className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">Everyone from this organization is already on the roster. Use “Paste list” to add new people.</p>
            ) : (
              <>
                <SearchInput value={search} onChange={setSearch} placeholder="Search members by name or mobile…" className="mb-3 w-full" />
                {shown.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">No members match your search.</p>
                ) : (
                <div className="max-h-72 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/60">
                    <tr>
                      <th className="w-10 px-3 py-2">
                        <Checkbox checked={allChecked} indeterminate={selected.size > 0 && !allChecked}
                          onChange={(v) => setSelected(v ? new Set(shown.map((u) => u.id)) : new Set())} />
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Player</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Email &amp; mobile</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {shown.map((u) => (
                      <tr key={u.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60" onClick={() => toggle(u.id)}>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Avatar name={u.name} size={28} />
                            <span className="font-medium text-slate-800 dark:text-slate-200">{u.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{u.email}{u.phone ? ` · ${u.phone}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                )}
              </>
            )
          ) : (
            <div>
              <Textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)}
                placeholder={"One per line:\nAarav Mehta, aarav@vjti.local, 7\nRohan Kulkarni, rohan@vjti.local\nkiran@vjti.local"} />
              <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">Format: <span className="font-medium">Name, email, jersey#</span> — email is required, name & jersey optional. New people are created under your organization. {parsed.length > 0 && <span className="text-brand-600 dark:text-brand-300">{parsed.length} row{parsed.length === 1 ? '' : 's'} detected.</span>}</p>
            </div>
          )}

          {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="mt-5 flex items-center justify-between">
            <span className="text-sm text-slate-500 dark:text-slate-400">{members.length} selected</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button disabled={members.length === 0 || bulk.isPending} onClick={submit}>{bulk.isPending ? 'Adding…' : `Add ${members.length || ''} player${members.length === 1 ? '' : 's'}`}</Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function entryDrawLabel(entry: any): string {
  const disc = entry.tournament_disciplines;
  return [disc?.tournament_sports?.tournaments?.name, disc?.disciplines?.name].filter(Boolean).join(' · ');
}

// "Now that you're in, pick your discipline" — set or change the discipline draw of a
// championship entry, inline under its row. Draws are scoped to the team's sport and
// exclude those another of the org's teams already occupies.
function ChooseDisciplinePanel({ team, entry, onClose }: { team: any; entry: any; onClose: () => void }) {
  const path = `/teams/${team.id}`;
  const eventId = entry.championship_id;
  const { data: draws = [], isLoading } = useApi<any[]>(`/championships/${eventId}/draws`);
  const { data: orgTeams = [] } = useApi<any[]>(`/teams?organization_id=${team.organization_id}`);
  const [drawId, setDrawId] = useState(entry.tournament_discipline_id ?? '');
  const [error, setError] = useState<string | null>(null);

  const taken = useMemo(
    () => new Set(
      orgTeams
        .flatMap((t: any) => (t.team_entries ?? []) as any[])
        .filter((e) => e.championship_id === eventId && e.team_id !== team.id)
        .map((e) => e.tournament_discipline_id)
        .filter(Boolean),
    ),
    [orgTeams, eventId, team.id],
  );
  const sportDraws = useMemo(
    () => draws.filter((d) => d.tournament_sports?.sport_id === team.sport_id && !taken.has(d.id)),
    [draws, team.sport_id, taken],
  );

  const update = useApiMutation((body: any) => api('PATCH', `/teams/${team.id}/entries/${entry.id}`, body), [path], onClose);
  const submit = () => {
    setError(null);
    if (!drawId) { setError('Pick a discipline'); return; }
    update.mutate({ tournament_discipline_id: drawId }, { onError: (e: any) => setError(e.message) });
  };

  return (
    <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40">
      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Pick a {team.sports?.name ?? ''} discipline for <span className="font-semibold text-slate-700 dark:text-slate-200">{entry.championships?.name ?? 'this championship'}</span>.</p>
      {isLoading ? <Spinner /> : sportDraws.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">No {team.sports?.name ?? ''} disciplines have been set up for this championship yet. Ask the organiser to add a draw.</p>
      ) : (
        <div className="space-y-3">
          <Pills
            ariaLabel="Discipline"
            value={drawId}
            onChange={setDrawId}
            options={sportDraws.map((d) => ({
              value: d.id,
              label: (
                <>
                  {[d.tournament_sports?.tournaments?.name, d.disciplines?.name ?? team.sports?.name].filter(Boolean).join(' · ')}
                  <span className="ml-1 font-normal opacity-70">({d.entry_type})</span>
                </>
              ),
            }))}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!drawId || update.isPending} onClick={submit}>{update.isPending ? 'Saving…' : 'Set discipline'}</Button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}

export function RosterPage() {
  const { teamId, orgId } = useParams();
  const navigate = useNavigate();
  const { ctx } = useAuth();
  const { can } = usePermissions();
  const path = `/teams/${teamId}`;
  const { data: team, isLoading } = useApi<any>(path);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [entering, setEntering] = useState(false);
  const [choosingDiscipline, setChoosingDiscipline] = useState<any | null>(null);
  const [searchParams] = useSearchParams();
  // Deep links (e.g. the getting-started checklist) can open a specific tab.
  const [tab, setTab] = useState<'squad' | 'championships'>(searchParams.get('tab') === 'championships' ? 'championships' : 'squad');

  const lockEntry = useApiMutation((entryId: string) => api('POST', `/teams/${teamId}/entries/${entryId}/lock`, {}), [path]);
  const unlockEntry = useApiMutation((entryId: string) => api('POST', `/teams/${teamId}/entries/${entryId}/unlock`, {}), [path]);
  const withdraw = useApiMutation((entryId: string) => api('DELETE', `/teams/${teamId}/entries/${entryId}`), [path]);
  const removeMember = useApiMutation((memberId: string) => api('DELETE', `/teams/${teamId}/members/${memberId}`), [path]);
  // Cascade delete (the user explicitly confirmed); the server still blocks teams that
  // have completed/scored matches. Refresh the org/my team lists, then leave the page.
  const deleteTeam = useApiMutation(
    () => api('DELETE', `/teams/${teamId}?cascade=true`),
    ['/me/teams', `/teams?organization_id=${orgId}`],
  );
  const updateMember = useApiMutation(
    ({ memberId, role }: { memberId: string; role: string }) => api('PATCH', `/teams/${teamId}/members/${memberId}`, { role }),
    [path],
  );

  if (isLoading || !team) return <Spinner />;
  const members = team.team_members ?? [];
  const entries: any[] = team.team_entries ?? [];
  // A team's own captain / vice-captain may edit it; so may the organization POC.
  const isMyCaptain = members.some((m: any) => m.user_id === ctx?.user.id && (m.role === 'captain' || m.role === 'vice_captain'));
  const canManage = can('roster.manage') || isMyCaptain;
  // Deleting the whole team is an org-management action — POC only, not captains.
  const canDeleteTeam = can('team.manage');
  // The roster is frozen only once every championship entry it has is locked.
  const allLocked = entries.length > 0 && entries.every((e) => e.status === 'roster_locked');
  const rules = team.entry_rules ?? { entry_type: 'team', squad_min: 1, squad_max: 15 };
  const activeCount = members.filter((m: any) => m.is_active !== false).length;
  const belowMin = activeCount < rules.squad_min;
  const atMax = activeCount >= rules.squad_max;
  const existingUserIds = new Set<string>(members.map((m: any) => m.user_id).filter(Boolean));
  const remaining = Math.max(0, rules.squad_max - activeCount);
  const pocs = (team.organizations?.organization_members ?? []).map((m: any) => m.users).filter(Boolean);

  const onDeleteTeam = async () => {
    const hasHistory = entries.length > 0;
    const ok = await confirmDialog({
      title: 'Delete team',
      tone: 'danger',
      confirmLabel: 'Delete team',
      message: hasHistory ? (
        <div className="space-y-2">
          <p>Delete <b>{team.name}</b>? It’s entered in {entries.length} championship{entries.length === 1 ? '' : 's'}:</p>
          <ul className="list-disc pl-5 text-slate-500 dark:text-slate-400">
            {entries.map((e) => <li key={e.id}>{e.championships?.name ?? 'Championship'}</li>)}
          </ul>
          <p>This permanently removes the team, its squad, those entries and any unplayed fixtures. A team with completed or scored matches can’t be deleted.</p>
        </div>
      ) : (
        <p>Delete <b>{team.name}</b>? This removes the team and its squad. This cannot be undone.</p>
      ),
    });
    if (!ok) return;
    deleteTeam.mutate(undefined, {
      onSuccess: () => { toast.success('Team deleted'); navigate(`/organizations/${orgId ?? ''}/teams`); },
      onError: (e: any) => toast.error(e.message),
    });
  };

  return (
    <div>
      <BackButton onClick={() => navigate(`/organizations/${orgId ?? ''}/teams`)}>All teams</BackButton>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 dark:bg-brand-500/10 text-2xl">{team.sports?.icon ?? '◇'}</span>
          <div>
            <div className="flex items-center gap-2"><h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{team.name}</h1>{allLocked && <Badge tone="slate">locked</Badge>}</div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {[team.sports?.name, team.organizations?.name].filter(Boolean).join(' · ')}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {entries.length === 0 ? 'Not entered into any championship yet' : `Entered in ${entries.length} championship${entries.length === 1 ? '' : 's'}`} · {activeCount} player{activeCount === 1 ? '' : 's'}
            </p>
            {pocs.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Point of contact: {pocs.map((u: any) => `${u.name}${u.phone ? ` (${u.phone})` : ''}`).join(', ')}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!allLocked && canManage && <Button variant="outline" onClick={() => setEditing(true)}>Edit team</Button>}
          {canDeleteTeam && <Button variant="danger" disabled={deleteTeam.isPending} onClick={onDeleteTeam}>{deleteTeam.isPending ? 'Deleting…' : 'Delete team'}</Button>}
        </div>
      </div>

      <div className="mb-4">
        <Tabs active={tab} onChange={(t) => setTab(t as 'squad' | 'championships')} tabs={[
          { id: 'squad', label: 'Squad', badge: <Badge tone="slate">{activeCount}</Badge> },
          { id: 'championships', label: 'Championships', badge: entries.length ? <Badge tone={entries.some((e) => !e.tournament_discipline_id) ? 'amber' : 'slate'}>{entries.length}</Badge> : undefined },
        ]} />
      </div>

      {tab === 'championships' && (
        <>
      {entries.length === 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          <p>This team isn’t in a championship yet. Build the squad now, then enter it into one or more championships when you’re ready to compete.</p>
          {canManage && <Button size="sm" onClick={() => setEntering(true)}>Enter championship(s)</Button>}
        </div>
      )}

      {entering && <EnterChampionshipsPanel team={team} onClose={() => setEntering(false)} />}

      {/* Championship entries */}
      <Card>
        <CardHeader
          title="Championships"
          subtitle={entries.length === 0 ? 'Enter this team into a championship & discipline to compete.' : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}
          action={!allLocked && canManage && <Button size="sm" variant="subtle" onClick={() => setEntering(true)}>+ Enter championship</Button>}
        />
        <CardBody>
          {entries.length === 0 ? (
            <p className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">No championship entries yet.</p>
          ) : (
            <div className="space-y-2">
              {entries.map((e) => {
                const er = e.entry_rules ?? rules;
                const eLocked = e.status === 'roster_locked';
                const belowMinE = activeCount < (er.squad_min ?? 1);
                const hasDiscipline = !!e.tournament_discipline_id;
                const choosing = choosingDiscipline?.id === e.id;
                return (
                  <div key={e.id} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">{e.championships?.name ?? 'Championship'}</div>
                        <div className={`truncate text-xs ${hasDiscipline ? 'text-slate-500 dark:text-slate-400' : 'text-amber-600 dark:text-amber-400'}`}>
                          {hasDiscipline ? `${entryDrawLabel(e)} · squad ${er.squad_min}–${er.squad_max}` : 'Discipline not chosen yet — pick one to lock & get fixtures'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={e.status} />
                        {!eLocked && canManage && (
                          <>
                            {!hasDiscipline && (
                              <Button size="sm" variant={choosing ? 'outline' : 'subtle'} onClick={() => setChoosingDiscipline(choosing ? null : e)}>Choose discipline</Button>
                            )}
                            <Button size="sm" variant="ghost" disabled={lockEntry.isPending || belowMinE || !hasDiscipline}
                              title={!hasDiscipline ? 'Choose a discipline first' : belowMinE ? `Need at least ${er.squad_min} players` : undefined}
                              onClick={async () => {
                                if (await confirmDialog({
                                  title: 'Lock roster',
                                  confirmLabel: 'Lock roster',
                                  message: `Lock this squad for ${e.championships?.name ?? 'this championship'}? You won’t be able to add or change players for this entry until you unlock it. Any other championships this team is in stay editable.`,
                                })) lockEntry.mutate(e.id, { onSuccess: () => toast.success('Entry locked'), onError: (err: any) => toast.error(err.message) });
                              }}>
                              Lock
                            </Button>
                            {hasDiscipline && (
                              <button className="text-xs text-slate-500 hover:underline dark:text-slate-400" onClick={() => setChoosingDiscipline(choosing ? null : e)}>Change</button>
                            )}
                            <button className="text-sm text-rose-500 hover:underline"
                              onClick={async () => { if (await confirmDialog({ title: 'Withdraw team', message: `Withdraw this team from ${e.championships?.name ?? 'the championship'}?`, confirmLabel: 'Withdraw' })) withdraw.mutate(e.id, { onSuccess: () => toast.success('Withdrawn'), onError: (err: any) => toast.error(err.message) }); }}>
                              Withdraw
                            </button>
                          </>
                        )}
                        {eLocked && canManage && (
                          <Button size="sm" variant="outline" disabled={unlockEntry.isPending}
                            onClick={async () => {
                              if (await confirmDialog({
                                title: 'Unlock roster',
                                confirmLabel: 'Unlock',
                                message: `Unlock this team’s roster for ${e.championships?.name ?? 'this championship'} so you can add or change players? You can lock it again afterwards.`,
                              })) unlockEntry.mutate(e.id, { onSuccess: () => toast.success('Roster unlocked'), onError: (err: any) => toast.error(err.message) });
                            }}>
                            Unlock
                          </Button>
                        )}
                      </div>
                    </div>
                    {choosing && <ChooseDisciplinePanel team={team} entry={e} onClose={() => setChoosingDiscipline(null)} />}
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
        </>
      )}

      {tab === 'squad' && (
      <Card>
        <CardHeader title={`Squad · ${activeCount}/${rules.squad_max}`}
          subtitle={allLocked ? 'Roster is locked. To edit, unlock an entry under the Championships tab.' : entries.length === 0 ? 'Add players now — squad limits apply per championship once entered' : belowMin ? `Add at least ${rules.squad_min - activeCount} more to lock` : 'Add players to complete your squad'}
          action={!allLocked && canManage && <Button size="sm" variant="subtle" disabled={atMax} title={atMax ? 'Squad is full' : undefined} onClick={() => setAdding(true)}>+ Add players</Button>} />
        <CardBody>
          {adding && canManage && <AddPlayersPanel teamId={teamId!} institutionId={team.organizations?.id ?? team.organization_id} existingUserIds={existingUserIds} remaining={remaining} onClose={() => setAdding(false)} />}
          <Progress
            value={activeCount}
            max={rules.squad_max}
            tone={atMax ? 'rose' : belowMin ? 'amber' : 'brand'}
            label={`Squad fill (min ${rules.squad_min})`}
            className="mb-4"
          />
          {members.length === 0 ? (
            <p className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">No players yet. Add members to get started.</p>
          ) : (
            <div className="space-y-2">
              {members.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <Avatar name={m.users?.name} size={36} />
                    <div>
                      <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{m.users?.name}{m.jersey_number != null && <span className="ml-2 text-slate-400 dark:text-slate-500">#{m.jersey_number}</span>}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{m.users?.email}{m.users?.phone ? ` · ${m.users.phone}` : ''}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!allLocked && canManage ? (
                      <Select value={m.role} disabled={updateMember.isPending}
                        onChange={(e) => updateMember.mutate({ memberId: m.id, role: e.target.value }, { onError: (err: any) => toast.error(err.message) })}
                        aria-label="Member role">
                        {TEAM_MEMBER_ROLE.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                      </Select>
                    ) : (
                      <Badge tone={m.role === 'captain' ? 'brand' : 'slate'}>{titleCase(m.role)}</Badge>
                    )}
                    {!allLocked && canManage && <button onClick={async () => { if (await confirmDialog({ title: 'Remove member', message: `Remove ${m.users?.name ?? 'this member'} from the squad?`, confirmLabel: 'Remove' })) removeMember.mutate(m.id, { onError: (err: any) => toast.error(err.message) }); }} className="text-sm text-rose-500 hover:underline">Remove</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
      )}

      {editing && <EditTeamModal team={team} onClose={() => setEditing(false)} />}
    </div>
  );
}
