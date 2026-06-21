import { useMemo, useState } from 'react';
import { useApi } from '../../lib/hooks';
import { titleCase } from '../../lib/format';
import { Avatar, Badge, Card, EmptyState, ListToolbar, SearchInput, Select, Spinner } from '../../components/ui';

// Organizations → teams → players, as returned by GET /championships/:id/participants.
// Approved orgs appear even with no teams; teams appear even with no players.
interface PlayerRow { id: string; name: string; email: string; phone?: string | null; role: string; jersey_number?: number }
interface TeamGroup { team_id: string; team_name: string; sport?: { id?: string; name: string; icon?: string } | null; players: PlayerRow[] }
interface OrgGroup { orgId: string; org?: { id: string; name: string; short_name?: string } | null; playerCount: number; teams: TeamGroup[] }
interface ParticipantsResponse { organizations: OrgGroup[] }

// Read-only roster of everyone in the championship — the same org → team → player
// tree the organiser sees, surfaced to players / officials / members so they can
// see who else is competing. Contacts are phone-masked for non-insiders by the API.
export function ChampionshipParticipants({ championshipId }: { championshipId: string }) {
  const { data, isLoading } = useApi<ParticipantsResponse>(`/championships/${championshipId}/participants`);
  const orgs = useMemo(() => data?.organizations ?? [], [data]);
  const [search, setSearch] = useState('');
  const [sport, setSport] = useState('');
  // Teams collapse by default; expanding one reveals its players.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (teamId: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(teamId) ? next.delete(teamId) : next.add(teamId);
    return next;
  });

  const sportOptions = useMemo(() => {
    const set = new Set<string>();
    orgs.forEach((o) => o.teams.forEach((t) => { if (t.sport?.name) set.add(t.sport.name); }));
    return [...set].sort();
  }, [orgs]);

  const totalParticipants = useMemo(() => orgs.reduce((n, o) => n + o.playerCount, 0), [orgs]);

  const filteredOrgs = useMemo<OrgGroup[]>(() => {
    const q = search.trim().toLowerCase();
    return orgs
      .map((o) => {
        const orgMatches = !q || (o.org?.name ?? 'Unaffiliated').toLowerCase().includes(q);
        const teams = o.teams.filter((t) => {
          if (sport && t.sport?.name !== sport) return false;
          if (orgMatches) return true; // org-name match (or no search) keeps all its teams
          return t.team_name.toLowerCase().includes(q) ||
            t.players.some((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));
        });
        return { ...o, teams };
      })
      .filter((o) => {
        if (sport) return o.teams.length > 0;
        if (q) return o.teams.length > 0 || (o.org?.name ?? 'Unaffiliated').toLowerCase().includes(q);
        return true;
      });
  }, [orgs, sport, search]);

  if (isLoading) return <Spinner />;
  if (orgs.length === 0) {
    return <EmptyState icon="⚇" title="No participants yet" description="Organizations, teams and players appear here as they join." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {totalParticipants} player{totalParticipants === 1 ? '' : 's'} across {orgs.length} organization{orgs.length === 1 ? '' : 's'}
        </p>
        <ListToolbar inline className="w-full sm:w-auto">
          <SearchInput
            placeholder="Search by name, organization, team…"
            value={search}
            onChange={setSearch}
            className="w-full sm:w-64"
          />
          {sportOptions.length > 1 && (
            <Select value={sport} onChange={(e) => setSport(e.target.value)} className="w-auto" aria-label="Filter by sport">
              <option value="">All sports</option>
              {sportOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          )}
        </ListToolbar>
      </div>

      {filteredOrgs.length === 0 ? (
        <Card className="p-8 text-center text-slate-500 dark:text-slate-400">No participants match your filters.</Card>
      ) : filteredOrgs.map((org) => (
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

          {org.teams.length === 0 ? (
            <div className="px-4 py-4 text-sm text-slate-400 dark:text-slate-500">Approved — no teams entered yet.</div>
          ) : (
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

                    {isOpen && (team.players.length === 0 ? (
                      <div className="px-4 py-3 pl-11 text-sm text-slate-400 dark:text-slate-500">No players added to this team yet.</div>
                    ) : (
                      <ul className="divide-y divide-slate-50 dark:divide-slate-800">
                        {team.players.map((p) => (
                          <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2 pl-11 text-sm hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                            <div className="flex items-center gap-2">
                              <Avatar name={p.name} size={28} />
                              <span className="font-medium text-slate-800 dark:text-slate-200">{p.name}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              <span>{titleCase(p.role)}</span>
                              {p.jersey_number != null && <span className="text-slate-400 dark:text-slate-500">#{p.jersey_number}</span>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
