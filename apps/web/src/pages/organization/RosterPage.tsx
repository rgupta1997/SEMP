import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TEAM_MEMBER_ROLE } from '@semp/shared';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { useApi, useApiMutation } from '../../lib/hooks';
import { usePermissions } from '../../lib/permissions';
import { Avatar, BackButton, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Modal, Progress, Select, Spinner, StatusBadge, Tabs, Textarea, toast } from '../../components/ui';
import { EnterChampionshipsModal } from '../../components/EnterChampionshipsModal';

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

function BulkAddMembersModal({ teamId, institutionId, existingUserIds, remaining, onClose }:
  { teamId: string; institutionId?: string; existingUserIds: Set<string>; remaining: number; onClose: () => void }) {
  const [tab, setTab] = useState('roster');
  const { data: users = [], isLoading } = useApi<any[]>(institutionId ? `/users?organization_id=${institutionId}` : '/users');
  const candidates = useMemo(() => users.filter((u) => !existingUserIds.has(u.id)), [users, existingUserIds]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paste, setPaste] = useState('');
  const [role, setRole] = useState('player');
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parsePasted(paste), [paste]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allChecked = candidates.length > 0 && selected.size === candidates.length;

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
      onSuccess: (r) => setResult(r),
      onError: (e: any) => setError(e.message),
    });
  };

  if (result) {
    return (
      <Modal title="Import complete" onClose={onClose}>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300"><span className="font-bold text-emerald-600">{result.added}</span> player{result.added === 1 ? '' : 's'} added · squad now {result.total}.</p>
        {result.skipped.length > 0 && (
          <div className="mb-3 max-h-48 overflow-auto rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 text-sm">
            <div className="mb-1 font-semibold text-slate-600 dark:text-slate-300">Skipped {result.skipped.length}:</div>
            {result.skipped.map((s, i) => <div key={i} className="text-slate-500 dark:text-slate-400">{s.label} — {s.reason}</div>)}
          </div>
        )}
        <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
      </Modal>
    );
  }

  return (
    <Modal title="Add players" onClose={onClose} wide>
      <div className="mb-4">
        <Tabs active={tab} onChange={setTab} tabs={[
          { id: 'roster', label: 'From organization', badge: candidates.length || undefined },
          { id: 'paste', label: 'Paste list' },
        ]} />
      </div>

      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-slate-500 dark:text-slate-400">{remaining} squad slot{remaining === 1 ? '' : 's'} left</span>
        <label className="flex items-center gap-2">
          <span className="text-slate-500 dark:text-slate-400">Add as</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1 text-sm">
            <option value="player">player</option>
            <option value="captain">captain</option>
            <option value="manager">manager</option>
            <option value="coach">coach</option>
          </select>
        </label>
      </div>

      {tab === 'roster' ? (
        isLoading ? <Spinner /> : candidates.length === 0 ? (
          <p className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">Everyone from this organization is already on the roster. Use “Paste list” to add new people.</p>
        ) : (
          <div className="max-h-72 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <label className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
              <Checkbox checked={allChecked} indeterminate={selected.size > 0 && !allChecked}
                onChange={(v) => setSelected(v ? new Set(candidates.map((u) => u.id)) : new Set())} />
              Select all ({candidates.length})
            </label>
            {candidates.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 dark:border-slate-800 px-4 py-2.5 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <Checkbox checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
                <Avatar name={u.name} size={32} />
                <div className="min-w-0"><div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{u.name}</div><div className="truncate text-xs text-slate-500 dark:text-slate-400">{u.email}</div></div>
              </label>
            ))}
          </div>
        )
      ) : (
        <div>
          <Textarea rows={7} value={paste} onChange={(e) => setPaste(e.target.value)}
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
    </Modal>
  );
}

function entryDrawLabel(entry: any): string {
  const disc = entry.tournament_disciplines;
  return [disc?.tournament_sports?.tournaments?.name, disc?.disciplines?.name].filter(Boolean).join(' · ');
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

  const lockEntry = useApiMutation((entryId: string) => api('POST', `/teams/${teamId}/entries/${entryId}/lock`, {}), [path]);
  const withdraw = useApiMutation((entryId: string) => api('DELETE', `/teams/${teamId}/entries/${entryId}`), [path]);
  const removeMember = useApiMutation((memberId: string) => api('DELETE', `/teams/${teamId}/members/${memberId}`), [path]);
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
  // The roster is frozen only once every championship entry it has is locked.
  const allLocked = entries.length > 0 && entries.every((e) => e.status === 'roster_locked');
  const rules = team.entry_rules ?? { entry_type: 'team', squad_min: 1, squad_max: 15 };
  const activeCount = members.filter((m: any) => m.is_active !== false).length;
  const belowMin = activeCount < rules.squad_min;
  const atMax = activeCount >= rules.squad_max;
  const existingUserIds = new Set<string>(members.map((m: any) => m.user_id).filter(Boolean));
  const remaining = Math.max(0, rules.squad_max - activeCount);
  const pocs = (team.organizations?.organization_members ?? []).map((m: any) => m.users).filter(Boolean);

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
          {canManage && <Button onClick={() => setEntering(true)}>Enter championship(s)</Button>}
          {!allLocked && canManage && <Button variant="outline" onClick={() => setEditing(true)}>Edit team</Button>}
        </div>
      </div>

      {entries.length === 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          <p>This team isn’t in a championship yet. Build the squad now, then enter it into one or more championships when you’re ready to compete.</p>
          {canManage && <Button size="sm" onClick={() => setEntering(true)}>Enter championship(s)</Button>}
        </div>
      )}

      {/* Championship entries */}
      <Card className="mb-6">
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
                return (
                  <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">{e.championships?.name ?? 'Championship'}</div>
                      <div className="truncate text-xs text-slate-500 dark:text-slate-400">{entryDrawLabel(e) || 'No discipline'} · squad {er.squad_min}–{er.squad_max}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={e.status} />
                      {!eLocked && canManage && (
                        <>
                          <Button size="sm" variant="ghost" disabled={lockEntry.isPending || belowMinE}
                            title={belowMinE ? `Need at least ${er.squad_min} players` : undefined}
                            onClick={() => lockEntry.mutate(e.id, { onSuccess: () => toast.success('Entry locked'), onError: (err: any) => toast.error(err.message) })}>
                            Lock
                          </Button>
                          <button className="text-sm text-rose-500 hover:underline"
                            onClick={() => { if (confirm('Withdraw this team from the championship?')) withdraw.mutate(e.id, { onSuccess: () => toast.success('Withdrawn'), onError: (err: any) => toast.error(err.message) }); }}>
                            Withdraw
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Squad · ${activeCount}/${rules.squad_max}`}
          subtitle={allLocked ? 'Roster is locked — every entry is locked' : entries.length === 0 ? 'Add players now — squad limits apply per championship once entered' : belowMin ? `Add at least ${rules.squad_min - activeCount} more to lock` : 'Add players to complete your squad'}
          action={!allLocked && canManage && <Button size="sm" variant="subtle" disabled={atMax} title={atMax ? 'Squad is full' : undefined} onClick={() => setAdding(true)}>+ Add players</Button>} />
        <CardBody>
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
                        {TEAM_MEMBER_ROLE.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                      </Select>
                    ) : (
                      <Badge tone={m.role === 'captain' ? 'brand' : 'slate'}>{m.role.replace(/_/g, ' ')}</Badge>
                    )}
                    {!allLocked && canManage && <button onClick={() => { if (confirm('Remove member?')) removeMember.mutate(m.id); }} className="text-sm text-rose-500 hover:underline">Remove</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {adding && <BulkAddMembersModal teamId={teamId!} institutionId={team.organizations?.id ?? team.organization_id} existingUserIds={existingUserIds} remaining={remaining} onClose={() => setAdding(false)} />}
      {editing && <EditTeamModal team={team} onClose={() => setEditing(false)} />}
      {entering && <EnterChampionshipsModal team={team} onClose={() => setEntering(false)} />}
    </div>
  );
}
