import { useMemo, useState } from 'react';
import { ChevronDown, Users } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { titleCase } from '../../lib/format';
import { EmptyState, SearchInput, cn } from '../../components/ui';
import { TeamAvatar } from '../../features/schedule/ScheduleParts';
import { SportFilterButton, SportFilterPanel } from '../../features/personal/SportFilter';

// Organizations → teams → players, as returned by GET /championships/:id/participants.
// Approved orgs appear even with no teams; teams appear even with no players.
interface PlayerRow { id: string; name: string; email: string; phone?: string | null; role: string; jersey_number?: number }
interface TeamGroup { team_id: string; team_name: string; sport?: { id?: string; name: string; icon?: string } | null; players: PlayerRow[] }
interface OrgGroup { orgId: string; org?: { id: string; name: string; short_name?: string } | null; playerCount: number; teams: TeamGroup[] }
interface ParticipantsResponse { organizations: OrgGroup[] }

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const COUNT_CHIP = 'rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300';

function Skeleton() {
  const bar = 'block animate-pulse rounded-full bg-slate-200 dark:bg-slate-800';
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <span className={cn(bar, 'h-9 w-full sm:w-96')} />
      {[0, 1].map((i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800"><span className="h-10 w-10 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" /><span className={cn(bar, 'h-4 w-48')} /></div>
          {[0, 1, 2].map((r) => <div key={r} className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 first-of-type:border-t-0 dark:border-slate-800"><span className="h-8 w-8 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /><span className={cn(bar, 'h-3 w-40')} /></div>)}
        </div>
      ))}
    </div>
  );
}

// Read-only roster of everyone in the championship - the same org → team → player
// tree the organiser sees. Contacts are phone-masked for non-insiders by the API.
export function ChampionshipParticipants({ championshipId }: { championshipId: string }) {
  const { data, isLoading } = useApi<ParticipantsResponse>(`/championships/${championshipId}/participants`);
  const orgs = useMemo(() => data?.organizations ?? [], [data]);
  const [search, setSearch] = useState('');
  const [sports, setSports] = useState<string[]>([]);
  const [sportsOpen, setSportsOpen] = useState(false);
  // Teams collapse by default; expanding one reveals its players.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (teamId: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(teamId) ? next.delete(teamId) : next.add(teamId);
    return next;
  });

  // One chip per sport, counting the squads that play it.
  const sportOptions = useMemo(() => {
    const m = new Map<string, { icon?: string; total: number }>();
    orgs.forEach((o) => o.teams.forEach((t) => { if (t.sport?.name) { const e = m.get(t.sport.name) ?? { icon: t.sport.icon, total: 0 }; e.total++; m.set(t.sport.name, e); } }));
    return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([name, e]) => ({ id: name, name, icon: e.icon ?? null, live: 0, total: e.total }));
  }, [orgs]);
  const totalTeams = useMemo(() => orgs.reduce((n, o) => n + o.teams.length, 0), [orgs]);
  const totalParticipants = useMemo(() => orgs.reduce((n, o) => n + o.playerCount, 0), [orgs]);

  const filteredOrgs = useMemo<OrgGroup[]>(() => {
    const q = search.trim().toLowerCase();
    return orgs
      .map((o) => {
        const orgMatches = !q || (o.org?.name ?? 'Unaffiliated').toLowerCase().includes(q);
        const teams = o.teams.filter((t) => {
          if (sports.length && !sports.includes(t.sport?.name ?? '')) return false;
          if (orgMatches) return true; // org-name match (or no search) keeps all its teams
          return t.team_name.toLowerCase().includes(q) ||
            t.players.some((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));
        });
        return { ...o, teams };
      })
      .filter((o) => {
        if (sports.length) return o.teams.length > 0;
        if (q) return o.teams.length > 0 || (o.org?.name ?? 'Unaffiliated').toLowerCase().includes(q);
        return true;
      });
  }, [orgs, sports, search]);

  if (isLoading) return <Skeleton />;
  if (orgs.length === 0) {
    return <EmptyState icon={<Users size={22} />} title="No participants yet" description="Organizations, teams and players appear here as they join." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5 text-xs font-bold">
          <span className="rounded-full bg-[#0a1630] px-3 py-1 text-white">{plural(orgs.length, 'organization')}</span>
          <span className="rounded-full bg-white px-3 py-1 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">{plural(totalTeams, 'team')}</span>
          <span className="rounded-full bg-white px-3 py-1 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">{plural(totalParticipants, 'player')}</span>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          {/* SearchInput will not shrink on its own; this wrapper lets it give way to the Sports button. */}
          <div className="min-w-0 flex-1 sm:w-64 sm:flex-none"><SearchInput pill placeholder="Search name, organization, team" value={search} onChange={setSearch} className="w-full" /></div>
          {sportOptions.length > 1 && <SportFilterButton open={sportsOpen} picked={sports.length} onToggle={() => setSportsOpen((o) => !o)} controls="participants-sports" />}
        </div>
      </div>
      {sportsOpen && sportOptions.length > 1 && (
        <SportFilterPanel id="participants-sports" sports={sportOptions} value={sports} onChange={setSports} allTotal={totalTeams} />
      )}

      {filteredOrgs.length === 0 ? (
        <EmptyState compact icon={<Users size={20} />} title="No participants match" description="Try another sport or search." />
      ) : filteredOrgs.map((org) => (
        <section key={org.orgId} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/30">
            <span className="flex min-w-0 items-center gap-3">
              <TeamAvatar name={org.org?.name ?? 'Unaffiliated'} short={org.org?.short_name} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">{org.org?.name || 'Unaffiliated'}</span>
                {org.org?.short_name && <span className="block text-xs text-slate-500 dark:text-slate-400">{org.org.short_name}</span>}
              </span>
            </span>
            <span className="flex gap-1.5"><span className={COUNT_CHIP}>{plural(org.teams.length, 'team')}</span><span className={COUNT_CHIP}>{plural(org.playerCount, 'player')}</span></span>
          </div>

          {org.teams.length === 0 ? (
            <div className="px-4 py-4 text-sm text-slate-400 dark:text-slate-500">Approved - no teams entered yet.</div>
          ) : org.teams.map((team) => {
            const isOpen = expanded.has(team.team_id);
            return (
              <div key={team.team_id} className="border-t border-slate-100 first-of-type:border-t-0 dark:border-slate-800">
                <button type="button" onClick={() => toggle(team.team_id)} aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-50 text-base dark:bg-slate-800/60" aria-hidden>{team.sport?.icon || '🏅'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">{team.team_name}</span>
                    {team.sport?.name && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{team.sport.name}</span>}
                  </span>
                  <span className={COUNT_CHIP}>{plural(team.players.length, 'player')}</span>
                  <ChevronDown size={16} className={cn('shrink-0 text-slate-400 transition', isOpen && 'rotate-180')} aria-hidden />
                </button>
                {isOpen && (team.players.length === 0 ? (
                  <div className="px-4 pb-3 text-sm text-slate-400 dark:text-slate-500">No players added to this team yet.</div>
                ) : (
                  <ul className="grid gap-1.5 px-4 pb-3 sm:grid-cols-2">
                    {team.players.map((p) => {
                      const captain = p.role === 'captain';
                      return (
                        <li key={p.id} className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-[11px] font-black text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700" aria-hidden>
                            {p.jersey_number ?? p.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{p.name}</span>
                          {captain
                            ? <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[10px] font-black text-slate-950" title="Captain">C</span>
                            : p.role !== 'player' && <span className="shrink-0 text-[10px] font-bold uppercase text-slate-400">{titleCase(p.role)}</span>}
                        </li>
                      );
                    })}
                  </ul>
                ))}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
