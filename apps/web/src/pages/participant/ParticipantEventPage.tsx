import { useState } from 'react';
import { Calendar, Trophy } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useApi, fmtDateRange } from '../../lib/hooks';
import {
  BackButton, Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Spinner, StatCard, StatusBadge, Tabs,
} from '../../components/ui';
import { MatchRow } from '../../components/participant/MatchRow';
import { ChampionshipFixtures } from '../../components/participant/ChampionshipFixtures';
import { ChampionshipParticipants } from '../../components/participant/ChampionshipParticipants';
import { ChampionshipStandings } from '../../components/participant/ChampionshipStandings';
import type { MatchSummary } from '../../components/participant/types';

interface EventDetail {
  championship: {
    id: string; name: string; slug: string; status: string;
    start_date: string | null; end_date: string | null; venue: string | null; description: string | null;
  };
  stats: { matches: number; wins: number; losses: number; draws: number };
  teams: {
    id: string; name: string; sport: string | null; discipline: string | null;
    entry_type: string | null; squad_min: number | null; squad_max: number | null; format: string | null;
    role: string; jersey_number: number | null; status: string;
    roster: { name: string; role: string; jersey_number: number | null }[];
  }[];
  matches: MatchSummary[];
  standings: {
    organization_id: string; organization: any;
    played: number; won: number; drawn: number; lost: number; points: number;
  }[];
}

const RANK_COLORS = [
  { bg: 'var(--gold-500)', color: '#3b1f00' },
  { bg: 'var(--silver)', color: '#1e293b' },
  { bg: 'var(--bronze)', color: '#fff7ed' },
];

function RankBadge({ pos }: { pos: number }) {
  const c = RANK_COLORS[pos - 1];
  if (!c) return <span className="font-bold tabular-nums text-slate-400 dark:text-slate-500">{pos}</span>;
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold"
      style={{ background: c.bg, color: c.color }}
    >{pos}</span>
  );
}

export function ParticipantEventPage() {
  // Route is /profile/championships/:championshipId — must match the param name,
  // otherwise this is undefined and the fetch 404s ("Championship not available").
  const { championshipId } = useParams();
  const [tab, setTab] = useState('overview');
  const { data, isLoading, error } = useApi<EventDetail>(`/me/championships/${championshipId}`);

  if (isLoading) return <Spinner />;
  if (error || !data) {
    return <EmptyState icon="◆" title="Championship not available" description="This championship doesn't exist or you didn't participate in it." />;
  }

  const { championship, stats, teams, matches } = data;

  return (
    <div className="space-y-5">
      <BackButton to="/profile">Dashboard</BackButton>
      <PageHeader title={championship.name} subtitle={`${championship.venue ? `${championship.venue} · ` : ''}${fmtDateRange(championship.start_date, championship.end_date)}`}>
        <StatusBadge status={championship.status} />
      </PageHeader>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'teams', label: 'My teams', badge: <Badge tone="slate">{teams.length}</Badge> },
          { id: 'matches', label: 'My matches', badge: <Badge tone="slate">{matches.length}</Badge> },
          { id: 'participants', label: 'Participants' },
          { id: 'schedule', label: 'Schedule' },
          { id: 'results', label: 'Results' },
          { id: 'standings', label: 'Standings' },
        ]}
      />

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Matches" value={stats.matches} />
            <StatCard label="Wins" value={stats.wins} accent />
            <StatCard label="Losses" value={stats.losses} />
            <StatCard label="Draws" value={stats.draws} />
          </div>
          {championship.description && (
            <Card>
              <CardHeader title="About this championship" />
              <CardBody className="pt-0 text-sm text-slate-600 dark:text-slate-300">{championship.description}</CardBody>
            </Card>
          )}
        </div>
      )}

      {tab === 'teams' && (
        <div className="space-y-4">
          {teams.length === 0 ? (
            <EmptyState icon="⚇" title="No teams" />
          ) : teams.map((t) => (
            <Card key={t.id}>
              <CardHeader
                title={t.name}
                subtitle={[t.sport, t.discipline].filter(Boolean).join(' · ')}
                action={<StatusBadge status={t.status} />}
              />
              <CardBody className="pt-0">
                {(t.entry_type || t.squad_min != null || t.format) && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {t.entry_type && <Badge tone="info">{t.entry_type}</Badge>}
                    {t.squad_min != null && t.squad_max != null && <Badge tone="slate">squad {t.squad_min}–{t.squad_max}</Badge>}
                    {t.format && <Badge tone="brand">{t.format}</Badge>}
                  </div>
                )}
                <div className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                  Your role: <span className="font-semibold text-slate-700 dark:text-slate-300">{t.role.replace(/_/g, ' ')}</span>
                  {t.jersey_number != null ? ` · #${t.jersey_number}` : ''}
                </div>
                {t.roster.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-slate-500">No roster recorded.</p>
                ) : (
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {t.roster.map((r, i) => (
                      <li key={i} className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-sm">
                        <span className="font-medium text-slate-700 dark:text-slate-300">{r.name}</span>
                        <span className="text-xs text-slate-400 dark:text-slate-500">{r.role.replace(/_/g, ' ')}{r.jersey_number != null ? ` · #${r.jersey_number}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {tab === 'matches' && (
        matches.length === 0 ? (
          <EmptyState icon={<Calendar size={24} />} title="No matches yet" description="Fixtures appear here once your teams are drawn." />
        ) : (
          <div className="space-y-2">
            {matches.map((m) => <MatchRow key={m.id} match={m} showEvent={false} />)}
          </div>
        )
      )}

      {tab === 'participants' && championshipId && <ChampionshipParticipants championshipId={championshipId} />}

      {tab === 'schedule' && championshipId && <ChampionshipFixtures championshipId={championshipId} mode="schedule" />}

      {tab === 'results' && championshipId && <ChampionshipFixtures championshipId={championshipId} mode="results" />}

      {tab === 'standings' && championshipId && <ChampionshipStandings championshipId={championshipId} />}
    </div>
  );
}
