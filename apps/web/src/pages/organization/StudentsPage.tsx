import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useFilterBar, usePageFilters } from '../../lib/filters';
import { useApi } from '../../lib/hooks';
import { Avatar, Badge, Card, CardBody, CardHeader, EmptyState, ListToolbar, PageHeader, SearchInput, Select, Spinner, StatCard } from '../../components/ui';

// A roster can be entered into several championships; read its team_entries.
function teamEvents(t: any): { id: string; name: string }[] {
  const m = new Map<string, string>();
  for (const e of t.team_entries ?? []) if (e.championships?.id) m.set(e.championships.id, e.championships.name ?? 'Championship');
  return [...m].map(([id, name]) => ({ id, name }));
}
function teamTournaments(t: any): { id: string; name: string }[] {
  const m = new Map<string, string>();
  for (const e of t.team_entries ?? []) {
    const tt = e.tournament_disciplines?.tournament_sports?.tournaments;
    if (tt?.id) m.set(tt.id, tt.name ?? 'Season');
  }
  return [...m].map(([id, name]) => ({ id, name }));
}
function teamSport(t: any): { id: string; name: string } | null {
  return t.sport_id ? { id: t.sport_id, name: t.sports?.name ?? 'Sport' } : null;
}

export function StudentsPage() {
  const { ctx } = useAuth();
  const { orgId } = useParams();
  const institutionId = orgId ?? ctx?.organization?.id ?? ctx?.user.organization_id ?? '';
  const { data: teams = [], isLoading } = useApi<any[]>(institutionId ? `/teams?organization_id=${institutionId}` : null);
  const [search, setSearch] = useState('');
  const [tournamentFilter, setTournamentFilter] = useState('all');

  // Championship lives in the shared header filter; peek it to drive the cascade below.
  const { eventId } = useFilterBar();

  // Distinct championships across all of this organization's teams.
  const championships = useMemo(() => {
    const m = new Map<string, string>();
    teams.forEach((t) => teamEvents(t).forEach((e) => m.set(e.id, e.name)));
    return [...m].map(([id, name]) => ({ id, name }));
  }, [teams]);

  // Reset the tournament drill-down whenever the header championship changes.
  useEffect(() => { setTournamentFilter('all'); }, [eventId]);

  // Tournaments narrow to the selected championship (cascading).
  const tournaments = useMemo(() => {
    const m = new Map<string, string>();
    teams.forEach((t) => {
      if (eventId && !teamEvents(t).some((e) => e.id === eventId)) return;
      teamTournaments(t).forEach((tt) => m.set(tt.id, tt.name));
    });
    return [...m].map(([id, name]) => ({ id, name }));
  }, [teams, eventId]);

  // Sports narrow to the selected championship + tournament; published to the header.
  const sportOptions = useMemo(() => {
    const m = new Map<string, string>();
    teams.forEach((t) => {
      if (eventId && !teamEvents(t).some((e) => e.id === eventId)) return;
      if (tournamentFilter !== 'all' && !teamTournaments(t).some((tt) => tt.id === tournamentFilter)) return;
      const s = teamSport(t); if (s) m.set(s.id, s.name);
    });
    return [...m].map(([id, name]) => ({ id, name }));
  }, [teams, eventId, tournamentFilter]);
  const { sportId } = usePageFilters({
    championships: championships.length ? championships : undefined,
    sports: sportOptions.length ? sportOptions : undefined,
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teams.filter((t) => {
      if (eventId && !teamEvents(t).some((e) => e.id === eventId)) return false;
      if (tournamentFilter !== 'all' && !teamTournaments(t).some((tt) => tt.id === tournamentFilter)) return false;
      if (sportId && teamSport(t)?.id !== sportId) return false;
      if (!q) return true;
      const haystack = [t.name, t.sports?.name, ...teamEvents(t).map((e) => e.name), ...teamTournaments(t).map((tt) => tt.name), ...(t.team_members ?? []).map((m: any) => m.users?.name)]
        .filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [teams, search, eventId, tournamentFilter, sportId]);

  // Stats reflect the active filters so the headline numbers match what's listed.
  const uniquePlayers = new Set<string>();
  visible.forEach((t) => (t.team_members ?? []).forEach((m: any) => uniquePlayers.add(m.user_id)));
  const sportCount = new Set(visible.map((t) => t.sport_id)).size;

  return (
    <div>
      <PageHeader title="Teams and members" subtitle="Everyone representing your organization, grouped by team." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Teams" value={visible.length} />
        <StatCard label="Unique students" value={uniquePlayers.size} />
        <StatCard label="Sports" value={sportCount} />
      </div>
      {teams.length > 0 && (
        <ListToolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search teams or players…" className="w-full sm:w-72" />
          {tournaments.length > 1 && (
            <Select value={tournamentFilter} onChange={(e) => setTournamentFilter(e.target.value)} className="w-auto min-w-[11rem]">
              <option value="all">All tournaments</option>
              {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          )}
        </ListToolbar>
      )}
      {isLoading ? <Spinner /> : teams.length === 0 ? (
        <EmptyState icon="👥" title="No squads yet" description="Enter teams and add players to see your contingent here." />
      ) : visible.length === 0 ? (
        <EmptyState icon="👥" title="No matches" description="No teams or players match your filters." />
      ) : (
        <div className="space-y-4">
          {visible.map((t) => {
            const members = t.team_members ?? [];
            return (
              <Card key={t.id}>
                <CardHeader
                  title={<Link to={`/organizations/${institutionId}/teams/${t.id}`} className="hover:text-brand-600 dark:hover:text-brand-300">{t.name}</Link>}
                  subtitle={[t.sports?.name, teamEvents(t).map((e) => e.name).join(', ')].filter(Boolean).join(' · ')}
                  action={<Badge tone="slate">{members.length} player{members.length === 1 ? '' : 's'}</Badge>}
                />
                <CardBody>
                  {members.length === 0 ? (
                    <p className="text-sm text-slate-400 dark:text-slate-500">No players yet.</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {members.map((m: any) => (
                        <div key={m.id} className="flex items-center gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
                          <Avatar name={m.users?.name} size={32} />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{m.users?.name}{m.jersey_number != null && <span className="ml-1.5 text-slate-400 dark:text-slate-500">#{m.jersey_number}</span>}</div>
                            <div className="truncate text-xs text-slate-500 dark:text-slate-400">{m.role.replace(/_/g, ' ')}{m.users?.phone ? ` · ${m.users.phone}` : ''}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
