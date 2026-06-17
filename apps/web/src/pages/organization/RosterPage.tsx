import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TEAM_MEMBER_ROLE } from '@semp/shared';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { useApi, useApiMutation } from '../../lib/hooks';
import { usePermissions } from '../../lib/permissions';
import { Avatar, BackButton, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Modal, Progress, Select, Spinner, StatusBadge, Tabs, Textarea, toast } from '../../components/ui';

interface BulkResult { added: number; skipped: { label: string; reason: string }[]; total: number }

function tournamentName(team: any): string | null {
  return team.tournament_disciplines?.tournament_sports?.tournaments?.name ?? null;
}

function EditTeamModal({ team, institutionTeams, onClose }: { team: any; institutionTeams: any[]; onClose: () => void }) {
  const path = `/teams/${team.id}`;
  const eventId = team.championship_id;
  const { data: tournaments = [] } = useApi<any[]>(`/tournaments?championship_id=${eventId}`);
  const { data: eventDraws = [] } = useApi<any[]>(`/championships/${eventId}/draws`);
  const { data: sports = [] } = useApi<any[]>('/sports');

  const takenDrawIds = useMemo(
    () => new Set(
      institutionTeams
        .filter((t) => t.championship_id === eventId && t.id !== team.id)
        .map((t) => t.tournament_discipline_id)
        .filter(Boolean),
    ),
    [institutionTeams, eventId, team.id],
  );
  const availableDraws = useMemo(
    () => eventDraws.filter((d) => !takenDrawIds.has(d.id) || d.id === team.tournament_discipline_id),
    [eventDraws, takenDrawIds, team.tournament_discipline_id],
  );

  const currentTournamentId = team.tournament_disciplines?.tournament_sports?.tournaments?.id ?? '';
  const [tournamentId, setTournamentId] = useState(currentTournamentId || '');
  const activeTournament = tournamentId || currentTournamentId || tournaments[0]?.id || '';

  const tsportsForTournament = useMemo(
    () => [...new Map(
      availableDraws
        .filter((d) => (d.tournament_sports?.tournaments?.id ?? d.tournament_sports?.tournament_id) === activeTournament)
        .map((d) => [d.tournament_sport_id, d.tournament_sports]),
    ).values()].filter(Boolean),
    [availableDraws, activeTournament],
  );

  const currentTsId = team.tournament_disciplines?.tournament_sport_id ?? '';
  const [tsId, setTsId] = useState(currentTsId || '');
  const ts = tsportsForTournament.find((t) => t.id === tsId)
    ?? tsportsForTournament.find((t) => t.sport_id === team.sport_id)
    ?? tsportsForTournament[0];

  const sportDraws = useMemo(
    () => (ts ? availableDraws.filter((d) => d.tournament_sport_id === ts.id) : []),
    [availableDraws, ts],
  );

  const [drawId, setDrawId] = useState(team.tournament_discipline_id ?? '');
  const activeDrawId = drawId || team.tournament_discipline_id || sportDraws[0]?.id || '';
  const [name, setName] = useState(team.name ?? '');
  const [error, setError] = useState<string | null>(null);

  const update = useApiMutation(
    (body: { name?: string; tournament_discipline_id?: string }) => api('PATCH', path, body),
    [path, institutionTeams.length ? `/teams?organization_id=${team.organization_id}` : null].filter(Boolean) as string[],
  );

  const sportName = (id: string) => sports.find((s) => s.id === id)?.name ?? 'Sport';

  const submit = () => {
    setError(null);
    if (!name.trim()) { setError('Team name is required'); return; }
    if (!activeDrawId) { setError('Select a discipline — ask the organiser to add draws in championship setup'); return; }
    const body: { name: string; tournament_discipline_id?: string } = { name: name.trim() };
    if (activeDrawId !== team.tournament_discipline_id) body.tournament_discipline_id = activeDrawId;
    update.mutate(body, {
      onSuccess: () => onClose(),
      onError: (e: any) => setError(e.message),
    });
  };

  return (
    <Modal title="Edit team" onClose={onClose}>
      <Field label="Championship">
        <Input value={team.championships?.name ?? 'Championship'} disabled />
      </Field>
      {eventDraws.length === 0 ? (
        <p className="mb-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          No disciplines are configured for this championship yet. The organiser must add discipline draws in Setup before you can link this team.
        </p>
      ) : (
        <>
          {tournaments.length > 0 && (
            <Field label="Tournament">
              <Select value={activeTournament} onChange={(e) => { setTournamentId(e.target.value); setTsId(''); setDrawId(''); }} disabled={tournaments.length === 1}>
                {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Sport">
            <Select value={ts?.id ?? ''} onChange={(e) => { setTsId(e.target.value); setDrawId(''); }}>
              {tsportsForTournament.length === 0 && <option value="">No sports with disciplines</option>}
              {tsportsForTournament.map((t) => <option key={t.id} value={t.id}>{sportName(t.sport_id)}</option>)}
            </Select>
          </Field>
          <Field label="Discipline / draw" hint="Required — links this team to an organiser-configured draw.">
            {sportDraws.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No available disciplines for this sport.</p>
            ) : (
              <Select value={activeDrawId} onChange={(e) => setDrawId(e.target.value)}>
                {sportDraws.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.disciplines?.name ?? sportName(ts!.sport_id)} ({d.entry_type})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </>
      )}
      <Field label="Team name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!name.trim() || !activeDrawId || eventDraws.length === 0 || update.isPending} onClick={submit}>
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
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

export function RosterPage() {
  const { teamId, orgId } = useParams();
  const navigate = useNavigate();
  const { ctx } = useAuth();
  const { can } = usePermissions();
  const path = `/teams/${teamId}`;
  const { data: team, isLoading } = useApi<any>(path);
  const institutionId = team?.organization_id ?? team?.organizations?.id;
  const { data: institutionTeams = [] } = useApi<any[]>(institutionId ? `/teams?organization_id=${institutionId}` : null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);

  const lock = useApiMutation(() => api('POST', `/teams/${teamId}/lock`, {}), [path]);
  const removeMember = useApiMutation((memberId: string) => api('DELETE', `/teams/${teamId}/members/${memberId}`), [path]);
  const updateMember = useApiMutation(
    ({ memberId, role }: { memberId: string; role: string }) => api('PATCH', `/teams/${teamId}/members/${memberId}`, { role }),
    [path],
  );

  if (isLoading || !team) return <Spinner />;
  const members = team.team_members ?? [];
  // A team's own captain / vice-captain may edit it; so may the organization POC.
  const isMyCaptain = members.some((m: any) => m.user_id === ctx?.user.id && (m.role === 'captain' || m.role === 'vice_captain'));
  const canManage = can('roster.manage') || isMyCaptain;
  const locked = team.status === 'roster_locked';
  const hasDiscipline = !!team.tournament_discipline_id;
  const rules = team.entry_rules ?? { entry_type: 'team', squad_min: 1, squad_max: 15 };
  const activeCount = members.filter((m: any) => m.is_active !== false).length;
  const belowMin = activeCount < rules.squad_min;
  const atMax = activeCount >= rules.squad_max;
  const existingUserIds = new Set<string>(members.map((m: any) => m.user_id).filter(Boolean));
  const remaining = Math.max(0, rules.squad_max - activeCount);

  return (
    <div>
      <BackButton onClick={() => navigate(`/organizations/${orgId ?? ''}/teams`)}>
        {team.championships?.name ? `${team.championships.name} teams` : 'All teams'}
      </BackButton>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 dark:bg-brand-500/10 text-2xl">{team.sports?.icon ?? '◇'}</span>
          <div>
            <div className="flex items-center gap-2"><h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{team.name}</h1><StatusBadge status={team.status} /></div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {[tournamentName(team), team.sports?.name, team.tournament_disciplines?.disciplines?.name].filter(Boolean).join(' · ')}
              {' · '}{team.organizations?.name}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {team.championships?.name}{team.championships?.name ? ' · ' : ''}{rules.entry_type} entry · squad {rules.squad_min}–{rules.squad_max} players
            </p>
            {(team.organizations?.users ?? []).length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Point of contact: {(team.organizations.users as any[]).map((u) => `${u.name}${u.phone ? ` (${u.phone})` : ''}`).join(', ')}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!locked && canManage && (
            <Button variant="outline" onClick={() => setEditing(true)}>Edit team</Button>
          )}
          {!locked && canManage && hasDiscipline && (
            <Button onClick={() => lock.mutate(undefined, { onSuccess: () => toast.success('Roster locked'), onError: (e: any) => toast.error(e.message) })} disabled={lock.isPending || belowMin} title={belowMin ? `Need at least ${rules.squad_min} players` : undefined}>Lock roster</Button>
          )}
        </div>
      </div>

      {!hasDiscipline && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          <p>
            This team is not linked to a discipline draw. Select one in Edit team — or ask the organiser to configure draws in championship Setup. Players cannot be assigned until then.
          </p>
          {!locked && canManage && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit team</Button>
          )}
        </div>
      )}

      <Card>
        <CardHeader title={`Squad · ${activeCount}/${rules.squad_max}`}
          subtitle={locked ? 'Roster is locked' : !hasDiscipline ? 'Link a discipline draw via Edit team to add players' : belowMin ? `Add at least ${rules.squad_min - activeCount} more to lock` : 'Add players to complete your squad'}
          action={!locked && canManage && hasDiscipline && <Button size="sm" variant="subtle" disabled={atMax} title={atMax ? 'Squad is full' : undefined} onClick={() => setAdding(true)}>+ Add players</Button>} />
        <CardBody>
          {hasDiscipline && (
            <Progress
              value={activeCount}
              max={rules.squad_max}
              tone={atMax ? 'rose' : belowMin ? 'amber' : 'brand'}
              label={`Squad fill (min ${rules.squad_min})`}
              className="mb-4"
            />
          )}
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
                    {!locked && canManage ? (
                      <Select value={m.role} disabled={updateMember.isPending}
                        onChange={(e) => updateMember.mutate({ memberId: m.id, role: e.target.value }, { onError: (err: any) => toast.error(err.message) })}
                        aria-label="Member role">
                        {TEAM_MEMBER_ROLE.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                      </Select>
                    ) : (
                      <Badge tone={m.role === 'captain' ? 'brand' : 'slate'}>{m.role.replace(/_/g, ' ')}</Badge>
                    )}
                    {!locked && canManage && <button onClick={() => { if (confirm('Remove member?')) removeMember.mutate(m.id); }} className="text-sm text-rose-500 hover:underline">Remove</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {adding && <BulkAddMembersModal teamId={teamId!} institutionId={team.organizations?.id ?? team.organization_id} existingUserIds={existingUserIds} remaining={remaining} onClose={() => setAdding(false)} />}
      {editing && <EditTeamModal team={team} institutionTeams={institutionTeams} onClose={() => setEditing(false)} />}
    </div>
  );
}
