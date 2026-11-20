import { useMemo, useState } from 'react';
import { TEAM_MEMBER_ROLE } from '@semp/shared';
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Users } from 'lucide-react';
import { useEvent } from './EventLayout';
import { useApi, useTableControls } from '../../lib/hooks';
import { titleCase } from '../../lib/format';
import { Avatar, EmptyState, PILL_PICK, Pagination, SearchInput, cn } from '../../components/ui';
import { useUrlState } from '../../components/primitives';
import { PickList } from '../../components/PickList';
import { ParticipantsSkeleton, PillButton, SportChips, SportsDecor, TeamAvatar } from '../../features/schedule/ScheduleParts';

// Organizations → teams → players, as returned by GET /championships/:id/participants.
// Approved orgs appear even with no teams; teams appear even with no players.
interface PlayerRow { id: string; name: string; email: string | null; phone?: string | null; role: string; jersey_number?: number | null }
interface TeamGroup { team_id: string; team_name: string; sport?: { id?: string; name: string; icon?: string | null } | null; players: PlayerRow[] }
interface OrgGroup { orgId: string; org?: { id: string; name: string; short_name?: string | null } | null; playerCount: number; teams: TeamGroup[] }
interface ParticipantsResponse { organizations: OrgGroup[] }

/** Banner tiles double as filters. */
type Show = '' | 'ready' | 'empty' | 'nosquad';
const PAGE_SIZE = 8;
const UNAFFILIATED = 'Unaffiliated';
// Short tags beside a name; plain players get none.
const ROLE_TAG: Record<string, { label: string; tone: string }> = {
  captain: { label: 'C', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200' },
  vice_captain: { label: 'VC', tone: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200' },
  substitute: { label: 'Sub', tone: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
};
const roleRank = (r: string) => { const i = (TEAM_MEMBER_ROLE as readonly string[]).indexOf(r); return i < 0 ? TEAM_MEMBER_ROLE.length : i; };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const orgName = (o: OrgGroup) => o.org?.name ?? UNAFFILIATED;
const COUNT_PILL = 'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums';
/** Organisation faces shown in the hero before "+N". */
const MAX_FACES = 7;

interface HeroFace { id: string; name: string; short: string | null }
interface HeroPill { key: Show; label: string; count: number; dot: string }

/** A roll call: who has turned up, and which squads still need players. */
function RollCallHero({ players, orgCount, squads, ready, empty, faces, pills, show, onShow, orgId, onPickOrg }: {
  players: number; orgCount: number; squads: number; ready: number; empty: number;
  faces: HeroFace[]; pills: HeroPill[]; show: Show; onShow: (s: Show) => void; orgId: string; onPickOrg: (id: string) => void;
}) {
  const pct = (n: number) => `${squads ? (n / squads) * 100 : 0}%`;
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 text-white shadow-sm">
      <SportsDecor />
      <div className="relative flex flex-col gap-5 p-4 sm:p-5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">Participants</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-black tabular-nums">{players}</span>
            <span className="text-sm font-semibold text-white/80">{players === 1 ? 'player' : 'players'} registered</span>
          </div>
          <p className="mt-0.5 text-sm font-semibold text-white/85">from {plural(orgCount, 'organisation')} in {plural(squads, 'squad')}</p>
          {/* Ready squads in green, empty ones in rose. */}
          <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-white/20 md:w-72" aria-hidden>
            <span className="bg-emerald-300 transition-all" style={{ width: pct(ready) }} />
            <span className="bg-rose-300/80 transition-all" style={{ width: pct(empty) }} />
          </div>
          <p className="mt-1 text-xs text-white/70">{squads ? `${ready} of ${squads} squads have players` : 'No squads entered yet'}</p>
        </div>

        <div className="flex flex-col gap-3 md:items-end">
          {faces.length > 0 && (
            <div className="flex items-center gap-2.5 md:flex-row-reverse">
              <div className="flex items-center">
                {faces.slice(0, MAX_FACES).map((o) => (
                  <button key={o.id} type="button" title={`${o.name}: show only them`} aria-pressed={orgId === o.id}
                    onClick={() => onPickOrg(orgId === o.id ? '' : o.id)}
                    className={cn('-ml-2 rounded-full bg-white ring-2 transition first:ml-0 hover:z-10 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-white',
                      orgId === o.id ? 'z-10 -translate-y-0.5 ring-white' : 'ring-brand-700')}>
                    <TeamAvatar name={o.name} short={o.short} />
                  </button>
                ))}
                {faces.length > MAX_FACES && (
                  <span className="-ml-2 grid h-9 w-9 place-items-center rounded-full bg-white/15 text-[11px] font-black ring-2 ring-brand-700 backdrop-blur">+{faces.length - MAX_FACES}</span>
                )}
              </div>
              <span className="text-xs font-semibold text-white/70">Who's here</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2 md:justify-end">
            {pills.map((p) => {
              const active = show === p.key;
              return (
                <button key={p.key} type="button" aria-pressed={active} onClick={() => onShow(active ? '' : p.key)}
                  title={active ? 'Tap to clear' : `Show ${p.label.toLowerCase()}`}
                  className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold ring-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white',
                    active ? 'bg-white text-brand-700 shadow-lg ring-white' : 'bg-white/10 text-white ring-white/15 hover:bg-white/15')}>
                  <span className={cn('h-2 w-2 rounded-full', p.dot)} aria-hidden />
                  {p.label}
                  <span className={cn('rounded-full px-1.5 text-[11px] font-black tabular-nums', active ? 'bg-brand-50 text-brand-700' : 'bg-white/15')}>{p.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export function EventParticipantsPage() {
  const { eventId } = useEvent();
  const { data, isLoading } = useApi<ParticipantsResponse>(`/championships/${eventId}/participants`);
  const orgs = useMemo(() => data?.organizations ?? [], [data]);
  const [search, setSearch] = useState('');
  const [orgId, setOrgId] = useUrlState<string>('org', '');
  const [sportParam, setSportParam] = useUrlState<string>('sport', '');
  const [showRaw, setShow] = useUrlState<string>('show', '');
  const show = (['ready', 'empty', 'nosquad'].includes(showRaw) ? showRaw : '') as Show;
  const pickedSports = useMemo(() => (sportParam ? sportParam.split(',') : []), [sportParam]);

  // Orgs and squads both start collapsed.
  const [openOrgs, setOpenOrgs] = useState<Set<string>>(new Set());
  const [openTeams, setOpenTeams] = useState<Set<string>>(new Set());
  const flip = (set: (fn: (s: Set<string>) => Set<string>) => void, id: string) => set((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Sport chips, counted in squads.
  const sports = useMemo(() => {
    const map = new Map<string, { id: string; name: string; icon: string | null; live: number; total: number }>();
    orgs.forEach((o) => o.teams.forEach((t) => {
      if (!t.sport?.name) return;
      const e = map.get(t.sport.name) ?? { id: t.sport.name, name: t.sport.name, icon: t.sport.icon ?? null, live: 0, total: 0 };
      e.total += 1;
      map.set(t.sport.name, e);
    }));
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [orgs]);
  const inSport = (t: TeamGroup) => !pickedSports.length || pickedSports.includes(t.sport?.name ?? '');

  const totals = useMemo(() => {
    const squads = orgs.flatMap((o) => o.teams).filter(inSport);
    return {
      players: orgs.reduce((n, o) => n + o.playerCount, 0),
      squads: squads.length,
      ready: squads.filter((t) => t.players.length > 0).length,
      empty: squads.filter((t) => t.players.length === 0).length,
      noSquad: orgs.filter((o) => o.org && o.teams.length === 0).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgs, sportParam]);

  const filtered = useMemo<OrgGroup[]>(() => {
    const q = search.trim().toLowerCase();
    const narrowed = !!(q || pickedSports.length || show);
    return orgs
      .filter((o) => !orgId || o.orgId === orgId)
      .filter((o) => (show === 'nosquad' ? o.teams.length === 0 : true))
      .map((o) => {
        const orgHit = !q || orgName(o).toLowerCase().includes(q);
        const teams = o.teams.filter((t) => {
          if (!inSport(t)) return false;
          if (show === 'ready' && t.players.length === 0) return false;
          if (show === 'empty' && t.players.length > 0) return false;
          if (orgHit) return true; // an org-name hit keeps all its squads
          return t.team_name.toLowerCase().includes(q)
            || t.players.some((p) => p.name.toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q));
        });
        return { ...o, teams, orgHit };
      })
      // Unfiltered, every approved org shows (squads or not); narrowed, only orgs with a hit.
      .filter((o) => !narrowed || o.teams.length > 0 || (o.orgHit && !pickedSports.length && (show === '' || show === 'nosquad')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgs, orgId, sportParam, show, search]);

  const t = useTableControls(filtered, { pageSize: PAGE_SIZE });
  // While narrowed, matching orgs stay open so the hits are visible.
  const narrowed = !!(search.trim() || pickedSports.length || show || orgId);
  const allOpen = t.view.length > 0 && t.view.every((o) => openOrgs.has(o.orgId));
  const toggleAll = () => setOpenOrgs(allOpen ? new Set() : new Set(t.view.map((o) => o.orgId)));
  const clear = () => { setSearch(''); setOrgId(''); setSportParam(''); setShow(''); };

  if (isLoading) return <ParticipantsSkeleton />;

  const pills: HeroPill[] = [
    { key: 'ready', label: 'Ready', count: totals.ready, dot: 'bg-emerald-300' },
    { key: 'empty', label: 'Empty squads', count: totals.empty, dot: 'bg-rose-300' },
    { key: 'nosquad', label: 'No squad yet', count: totals.noSquad, dot: 'bg-amber-300' },
  ];
  // Biggest contingents first.
  const faces: HeroFace[] = orgs.filter((o) => o.org).sort((a, b) => b.playerCount - a.playerCount || b.teams.length - a.teams.length)
    .map((o) => ({ id: o.orgId, name: o.org!.name, short: o.org!.short_name ?? null }));
  const orgOptions = [
    { value: '', label: 'All organisations' },
    ...orgs.filter((o) => o.org).map((o) => ({ value: o.orgId, label: o.org!.name, hint: o.org!.short_name ?? undefined,
      icon: <TeamAvatar name={o.org!.name} short={o.org!.short_name} size="sm" /> }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];

  return (
    <div className="space-y-5">
      <RollCallHero players={totals.players} orgCount={faces.length} squads={totals.squads} ready={totals.ready} empty={totals.empty}
        faces={faces} pills={pills} show={show} onShow={setShow} orgId={orgId} onPickOrg={setOrgId} />

      <SportChips sports={sports} value={pickedSports} onChange={(ids) => setSportParam(ids.join(','))} />

      {/* Toolbar: search and org on the left, open/close all on the right. */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search players, squads, organisations…" value={search} onChange={setSearch} pill className="w-full sm:w-80" />
        {orgOptions.length > 2 && (
          <PickList value={orgId} onChange={setOrgId} options={orgOptions} ariaLabel="Filter by organisation"
            searchPlaceholder="Find an organisation" className={cn(PILL_PICK, 'w-full sm:w-64')} />
        )}
        <div className="flex w-full items-center justify-between gap-2 sm:ml-auto sm:w-auto">
          <span className="text-xs font-semibold text-slate-400">{plural(filtered.length, 'organisation')}</span>
          {narrowed
            ? <PillButton onClick={clear}>Clear filters</PillButton>
            : filtered.length > 0 && (
              <PillButton icon={allOpen ? ChevronsDownUp : ChevronsUpDown} onClick={toggleAll}>
                {allOpen ? 'Collapse all' : 'Expand all'}
              </PillButton>
            )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<Users size={28} />}
          title={narrowed ? 'Nothing matches' : 'No organisations yet'}
          description={narrowed ? 'Try another search, or clear the filters.' : 'Approved organisations show here with their squads and players.'}
          action={narrowed ? <PillButton onClick={clear}>Clear filters</PillButton> : undefined} />
      ) : (
        <div className="space-y-3">
          {t.view.map((org) => (
            <OrgCard key={org.orgId} org={org} open={narrowed || openOrgs.has(org.orgId)} onToggle={() => flip(setOpenOrgs, org.orgId)}
              openTeams={openTeams} onToggleTeam={(id) => flip(setOpenTeams, id)} />
          ))}
          <Pagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} />
        </div>
      )}
    </div>
  );
}

function OrgCard({ org, open, onToggle, openTeams, onToggleTeam }: {
  org: OrgGroup; open: boolean; onToggle: () => void; openTeams: Set<string>; onToggleTeam: (id: string) => void;
}) {
  const name = orgName(org);
  const icons = [...new Set(org.teams.map((t) => t.sport?.icon || '🏅'))];
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50/70 dark:hover:bg-slate-800/30',
          open && 'border-b border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/20')}>
        <TeamAvatar name={name} short={org.org?.short_name} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-bold text-slate-800 dark:text-slate-100" title={name}>{name}</span>
            {org.org?.short_name && <span className="shrink-0 text-xs font-semibold text-slate-400">{org.org.short_name}</span>}
          </span>
          <span className="mt-0.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">
            {plural(org.teams.length, 'squad')} · {plural(org.playerCount, 'player')}
          </span>
        </span>
        {org.teams.length === 0
          ? <span className={cn(COUNT_PILL, 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300')}>No squad yet</span>
          : (
            <span className="hidden max-w-[12rem] shrink-0 items-center gap-1 overflow-hidden sm:flex" aria-hidden>
              {icons.slice(0, 6).map((i) => <span key={i} className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-sm dark:bg-slate-800">{i}</span>)}
              {icons.length > 6 && <span className="text-xs font-bold text-slate-400">+{icons.length - 6}</span>}
            </span>
          )}
        <ChevronDown size={16} className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (org.teams.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-400 sm:pl-16">Approved, but no squad entered yet.</p>
      ) : (
        <ul>
          {org.teams.map((team) => (
            <SquadRow key={team.team_id} team={team} open={openTeams.has(team.team_id)} onToggle={() => onToggleTeam(team.team_id)} />
          ))}
        </ul>
      ))}
    </section>
  );
}

function SquadRow({ team, open, onToggle }: { team: TeamGroup; open: boolean; onToggle: () => void }) {
  const players = [...team.players].sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.name.localeCompare(b.name));
  return (
    <li className="border-t border-slate-100 first:border-t-0 dark:border-slate-800">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50/70 sm:pl-16 dark:hover:bg-slate-800/30">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-base dark:bg-brand-500/15" aria-hidden>{team.sport?.icon || '🏅'}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{team.team_name}</span>
          {team.sport?.name && <span className="block truncate text-xs text-slate-400">{team.sport.name}</span>}
        </span>
        {players.length
          ? <span className={cn(COUNT_PILL, 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>{plural(players.length, 'player')}</span>
          : <span className={cn(COUNT_PILL, 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300')}>No players</span>}
        <ChevronDown size={15} className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (players.length === 0 ? (
        <p className="px-4 pb-3 text-sm text-slate-400 sm:pl-16">No players added to this squad yet.</p>
      ) : (
        <ul className="grid gap-2 px-4 pb-3 sm:grid-cols-2 sm:pl-16 2xl:grid-cols-3">
          {players.map((p) => <PlayerCard key={p.id} p={p} />)}
        </ul>
      ))}
    </li>
  );
}

function PlayerCard({ p }: { p: PlayerRow }) {
  const tag = ROLE_TAG[p.role];
  const contact = [p.email, p.phone].filter(Boolean).join(' · ');
  return (
    <li className="flex min-w-0 items-center gap-2.5 rounded-xl border border-slate-100 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
      <Avatar name={p.name} size={30} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100" title={p.name}>{p.name}</span>
          {tag && <span title={titleCase(p.role)} className={cn('shrink-0 rounded px-1 text-[10px] font-black', tag.tone)}>{tag.label}</span>}
        </span>
        {contact && <span className="block truncate text-xs text-slate-400" title={contact}>{contact}</span>}
      </span>
      {p.jersey_number != null && <span className="shrink-0 text-xs font-black tabular-nums text-slate-400">#{p.jersey_number}</span>}
    </li>
  );
}
