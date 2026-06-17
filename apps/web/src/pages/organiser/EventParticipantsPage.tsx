import { useMemo, useState } from 'react';
import { useEvent } from './EventLayout';
import { usePageFilters } from '../../lib/filters';
import { useApi, useTableControls } from '../../lib/hooks';
import { Card, Spinner, Badge, SearchInput, Pagination, Avatar, ListToolbar, Select } from '../../components/ui';

interface ParticipantTeam { team_id: string; team_name: string; sport?: { name: string; icon?: string }; role: string; jersey_number?: number }
interface Participant {
  id: string;
  name: string;
  email: string;
  phone?: string;
  organization?: { id: string; name: string; short_name?: string };
  teams: ParticipantTeam[];
}

// A player as they appear under one specific team (their role/jersey are team-scoped).
interface TeamPlayer { participant: Participant; role: string; jersey_number?: number }
interface TeamGroup { team_id: string; team_name: string; sport?: { name: string; icon?: string }; players: TeamPlayer[] }
interface OrgGroup { orgId: string; org?: Participant['organization']; teams: TeamGroup[]; playerCount: number }

export function EventParticipantsPage() {
  const { eventId } = useEvent();
  const { data: participants, isLoading } = useApi<Participant[]>(`/championships/${eventId}/participants`);
  const [search, setSearch] = useState('');
  const [institutionId, setInstitutionId] = useState('');
  // Teams collapse by default; expanding one reveals its players.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (teamId: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(teamId) ? next.delete(teamId) : next.add(teamId);
    return next;
  });

  // Sports represented by any participant's team(s) — surfaced in the header filter.
  const sportOptions = useMemo(() => {
    const set = new Set<string>();
    (participants ?? []).forEach((p) => p.teams.forEach((tm) => { if (tm.sport?.name) set.add(tm.sport.name); }));
    return [...set].sort().map((name) => ({ id: name, name }));
  }, [participants]);
  const { sportId } = usePageFilters({ sports: sportOptions.length ? sportOptions : undefined });

  // Organizations present among participants — drives the dedicated filter.
  const institutionOptions = useMemo(() => {
    const m = new Map<string, string>();
    (participants ?? []).forEach((p) => { if (p.organization?.id) m.set(p.organization.id, p.organization.name); });
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [participants]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (participants ?? []).filter((p) => {
      if (sportId && !p.teams.some((tm) => tm.sport?.name === sportId)) return false;
      if (institutionId && p.organization?.id !== institutionId) return false;
      return p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        (p.organization?.name ?? '').toLowerCase().includes(q) ||
        p.teams.some((tm) => tm.team_name.toLowerCase().includes(q));
    });
  }, [participants, search, sportId, institutionId]);

  // Pivot the flat player list into Organization → Team → Players.
  const orgGroups = useMemo<OrgGroup[]>(() => {
    const orgs = new Map<string, { org?: Participant['organization']; teams: Map<string, TeamGroup>; players: Set<string> }>();
    for (const p of filtered) {
      const orgId = p.organization?.id || 'unaffiliated';
      if (!orgs.has(orgId)) orgs.set(orgId, { org: p.organization, teams: new Map(), players: new Set() });
      const entry = orgs.get(orgId)!;
      for (const tm of p.teams) {
        if (sportId && tm.sport?.name !== sportId) continue; // honour the sport filter per team
        if (!entry.teams.has(tm.team_id)) {
          entry.teams.set(tm.team_id, { team_id: tm.team_id, team_name: tm.team_name, sport: tm.sport, players: [] });
        }
        entry.teams.get(tm.team_id)!.players.push({ participant: p, role: tm.role, jersey_number: tm.jersey_number });
        entry.players.add(p.id);
      }
    }
    return [...orgs.entries()]
      .map(([orgId, { org, teams, players }]) => ({
        orgId,
        org,
        playerCount: players.size,
        teams: [...teams.values()].sort((a, b) => a.team_name.localeCompare(b.team_name)),
      }))
      .sort((a, b) => (a.org?.name ?? 'Unaffiliated').localeCompare(b.org?.name ?? 'Unaffiliated'));
  }, [filtered, sportId]);

  const t = useTableControls(orgGroups, { pageSize: 8 });

  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Participants</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {participants?.length || 0} participants from {orgGroups.length} organization{orgGroups.length === 1 ? '' : 's'}
          </p>
        </div>
        <ListToolbar inline className="w-full sm:w-auto">
          <SearchInput
            placeholder="Search by name, email, organization, team…"
            value={search}
            onChange={setSearch}
            className="w-full sm:w-72"
          />
          {institutionOptions.length > 1 && (
            <Select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)} aria-label="Filter by organization">
              <option value="">All organizations</option>
              {institutionOptions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </Select>
          )}
        </ListToolbar>
      </div>

      {orgGroups.length === 0 ? (
        <Card className="p-8 text-center text-slate-500 dark:text-slate-400">
          {search || sportId || institutionId ? 'No participants match your filters.' : 'No participants yet. Participants will appear here once organizations create teams and add players.'}
        </Card>
      ) : (
        <>
          {t.view.map((org) => (
            <Card key={org.orgId} className="overflow-hidden">
              <div className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                    {org.org?.name || 'Unaffiliated'}
                    {org.org?.short_name && <span className="ml-2 text-slate-500 dark:text-slate-400">({org.org.short_name})</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="slate">{org.teams.length} team{org.teams.length === 1 ? '' : 's'}</Badge>
                    <Badge tone="slate">{org.playerCount} player{org.playerCount === 1 ? '' : 's'}</Badge>
                  </div>
                </div>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {org.teams.map((team) => {
                  const isOpen = expanded.has(team.team_id);
                  return (
                    <div key={team.team_id}>
                      <button
                        type="button"
                        onClick={() => toggle(team.team_id)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="w-4 text-slate-400 dark:text-slate-500">{isOpen ? '▾' : '▸'}</span>
                          <span className="text-lg">{team.sport?.icon || '🏅'}</span>
                          <span className="font-medium text-slate-800 dark:text-slate-200">{team.team_name}</span>
                          {team.sport?.name && <span className="text-xs text-slate-400 dark:text-slate-500">{team.sport.name}</span>}
                        </div>
                        <Badge tone="slate">{team.players.length} player{team.players.length === 1 ? '' : 's'}</Badge>
                      </button>

                      {isOpen && (
                        <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                          <thead className="bg-slate-50/50 dark:bg-slate-800/60">
                            <tr>
                              <th className="px-4 py-2 pl-11 text-left font-semibold text-slate-600 dark:text-slate-300">Player</th>
                              <th className="px-4 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Contact</th>
                              <th className="px-4 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Role</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                            {team.players.map(({ participant: p, role, jersey_number }) => (
                              <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                                <td className="px-4 py-2 pl-11">
                                  <div className="flex items-center gap-2">
                                    <Avatar name={p.name} size={28} />
                                    <span className="font-medium text-slate-800 dark:text-slate-200">{p.name}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                                  <div>{p.email}</div>
                                  {p.phone && <div className="text-xs text-slate-400 dark:text-slate-500">{p.phone}</div>}
                                </td>
                                <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                                  <span className="capitalize">{role.replace(/_/g, ' ')}</span>
                                  {jersey_number != null && <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">#{jersey_number}</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
          <Pagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} />
        </>
      )}
    </div>
  );
}
