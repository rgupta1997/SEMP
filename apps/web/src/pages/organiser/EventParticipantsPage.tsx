import { useMemo, useState } from 'react';
import { Medal } from 'lucide-react';
import { useEvent } from './EventLayout';
import { usePageFilters } from '../../lib/filters';
import { useApi, useTableControls } from '../../lib/hooks';
import { titleCase } from '../../lib/format';
import { Card, Spinner, Badge, SearchInput, Pagination, Avatar, ListToolbar, Select } from '../../components/ui';

// Organizations → teams → players, as returned by GET /championships/:id/participants.
// Approved orgs appear even with no teams; teams appear even with no players.
interface PlayerRow { id: string; name: string; email: string; phone?: string | null; role: string; jersey_number?: number }
interface TeamGroup { team_id: string; team_name: string; sport?: { id?: string; name: string; icon?: string } | null; players: PlayerRow[] }
interface OrgGroup { orgId: string; org?: { id: string; name: string; short_name?: string } | null; playerCount: number; teams: TeamGroup[] }
interface ParticipantsResponse { organizations: OrgGroup[] }

export function EventParticipantsPage() {
  const { eventId } = useEvent();
  const { data, isLoading } = useApi<ParticipantsResponse>(`/championships/${eventId}/participants`);
  const orgs = useMemo(() => data?.organizations ?? [], [data]);
  const [search, setSearch] = useState('');
  const [institutionId, setInstitutionId] = useState('');
  // Teams collapse by default; expanding one reveals its players.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (teamId: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(teamId) ? next.delete(teamId) : next.add(teamId);
    return next;
  });
  // Organizations collapse by default too; expanding one reveals its teams.
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  const toggleOrg = (orgId: string) => setExpandedOrgs((prev) => {
    const next = new Set(prev);
    next.has(orgId) ? next.delete(orgId) : next.add(orgId);
    return next;
  });

  // Sports represented by any team - surfaced in the shared header filter.
  const sportOptions = useMemo(() => {
    const set = new Set<string>();
    orgs.forEach((o) => o.teams.forEach((t) => { if (t.sport?.name) set.add(t.sport.name); }));
    return [...set].sort().map((name) => ({ id: name, name }));
  }, [orgs]);
  const { sportId } = usePageFilters({ sports: sportOptions.length ? sportOptions : undefined });

  // Organizations present - drives the dedicated filter.
  const institutionOptions = useMemo(
    () => orgs.filter((o) => o.org).map((o) => ({ id: o.orgId, name: o.org!.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [orgs],
  );

  const totalParticipants = useMemo(() => orgs.reduce((n, o) => n + o.playerCount, 0), [orgs]);

  const filteredOrgs = useMemo<OrgGroup[]>(() => {
    const q = search.trim().toLowerCase();
    return orgs
      .filter((o) => !institutionId || o.orgId === institutionId)
      .map((o) => {
        const orgMatches = !q || (o.org?.name ?? 'Unaffiliated').toLowerCase().includes(q);
        const teams = o.teams.filter((t) => {
          if (sportId && t.sport?.name !== sportId) return false;
          if (orgMatches) return true; // org-name match (or no search) keeps all its teams
          return t.team_name.toLowerCase().includes(q) ||
            t.players.some((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));
        });
        return { ...o, teams };
      })
      .filter((o) => {
        // In the default view (no sport/search narrowing) keep every org - including
        // approved orgs with no teams yet. Otherwise drop orgs that filtered to empty.
        if (sportId) return o.teams.length > 0;
        if (q) return o.teams.length > 0 || (o.org?.name ?? 'Unaffiliated').toLowerCase().includes(q);
        return true;
      });
  }, [orgs, institutionId, sportId, search]);

  const t = useTableControls(filteredOrgs, { pageSize: 8 });

  // While a filter/search is active, keep matching orgs open so results stay visible;
  // otherwise orgs are collapsed until clicked.
  const isFiltering = !!(search.trim() || sportId || institutionId);
  const orgOpen = (orgId: string) => isFiltering || expandedOrgs.has(orgId);

  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Participants</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {totalParticipants} player{totalParticipants === 1 ? '' : 's'} across {orgs.length} approved organization{orgs.length === 1 ? '' : 's'}
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

      {filteredOrgs.length === 0 ? (
        <Card className="p-8 text-center text-slate-500 dark:text-slate-400">
          {search || sportId || institutionId ? 'No participants match your filters.' : 'No organizations have joined yet. Approved organizations appear here, with their teams and players.'}
        </Card>
      ) : (
        <>
          {t.view.map((org) => {
            const open = orgOpen(org.orgId);
            return (
            <Card key={org.orgId} className="overflow-hidden">
              <button
                type="button"
                onClick={() => toggleOrg(org.orgId)}
                aria-expanded={open}
                className={`flex w-full items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/60 px-4 py-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800 ${open ? 'border-b border-slate-100 dark:border-slate-800' : ''}`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-4 text-slate-400 dark:text-slate-500">{open ? '▾' : '▸'}</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {org.org?.name || 'Unaffiliated'}
                    {org.org?.short_name && <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">({org.org.short_name})</span>}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="slate">{org.teams.length} team{org.teams.length === 1 ? '' : 's'}</Badge>
                  <Badge tone="slate">{org.playerCount} player{org.playerCount === 1 ? '' : 's'}</Badge>
                </div>
              </button>

              {open && (org.teams.length === 0 ? (
                <div className="px-4 py-4 text-sm text-slate-400 dark:text-slate-500">Approved - no teams entered yet.</div>
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
                            {team.sport?.icon
                              ? <span className="text-lg leading-none">{team.sport.icon}</span>
                              : <Medal size={18} className="text-slate-400 dark:text-slate-500" />}
                            <span className="font-medium text-slate-800 dark:text-slate-200">{team.team_name}</span>
                            {team.sport?.name && <span className="text-xs text-slate-400 dark:text-slate-500">{team.sport.name}</span>}
                          </div>
                          <Badge tone="slate">{team.players.length} player{team.players.length === 1 ? '' : 's'}</Badge>
                        </button>

                        {isOpen && (team.players.length === 0 ? (
                          <div className="px-4 py-3 pl-11 text-sm text-slate-400 dark:text-slate-500">No players added to this team yet.</div>
                        ) : (
                          <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                            <thead className="bg-slate-50/50 dark:bg-slate-800/60">
                              <tr>
                                <th className="px-4 py-2 pl-11 text-left font-semibold text-slate-600 dark:text-slate-300">Player</th>
                                <th className="px-4 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Contact</th>
                                <th className="px-4 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Role</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                              {team.players.map((p) => (
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
                                    <span>{titleCase(p.role)}</span>
                                    {p.jersey_number != null && <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">#{p.jersey_number}</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </Card>
          );
          })}
          <Pagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} />
        </>
      )}
    </div>
  );
}
