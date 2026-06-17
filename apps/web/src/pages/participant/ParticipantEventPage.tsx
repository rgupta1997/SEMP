import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApi, fmtDateRange } from '../../lib/hooks';
import {
  Avatar, BackButton, Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Spinner, StatCard, StatusBadge, Table, Tabs,
} from '../../components/ui';
import { MatchRow } from '../../components/participant/MatchRow';
import type { MatchSummary } from '../../components/participant/types';

interface EventDetail {
  championship: {
    id: string; name: string; slug: string; status: string;
    start_date: string | null; end_date: string | null; venue: string | null; description: string | null;
  };
  stats: { matches: number; wins: number; losses: number; draws: number };
  teams: {
    id: string; name: string; sport: string | null; discipline: string | null;
    role: string; jersey_number: number | null; status: string;
    roster: { name: string; role: string; jersey_number: number | null }[];
  }[];
  matches: MatchSummary[];
  standings: {
    organization_id: string; organization: any;
    played: number; won: number; drawn: number; lost: number; points: number;
  }[];
}

const MEDAL = ['🥇', '🥈', '🥉'];

export function ParticipantEventPage() {
  const { eventId } = useParams();
  const [tab, setTab] = useState('overview');
  const { data, isLoading, error } = useApi<EventDetail>(`/me/championships/${eventId}`);

  if (isLoading) return <Spinner />;
  if (error || !data) {
    return <EmptyState icon="◆" title="Championship not available" description="This championship doesn't exist or you didn't participate in it." />;
  }

  const { championship, stats, teams, matches, standings } = data;

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
          <EmptyState icon="⚑" title="No matches yet" description="Fixtures appear here once your teams are drawn." />
        ) : (
          <div className="space-y-2">
            {matches.map((m) => <MatchRow key={m.id} match={m} showEvent={false} />)}
          </div>
        )
      )}

      {tab === 'standings' && (
        standings.length === 0 ? (
          <EmptyState icon="🏆" title="No results yet" description="Standings populate as matches are completed." />
        ) : (
          <Table>
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Organization</th>
                <th className="px-3 py-3 text-center">P</th>
                <th className="px-3 py-3 text-center">W</th>
                <th className="px-3 py-3 text-center">D</th>
                <th className="px-3 py-3 text-center">L</th>
                <th className="px-4 py-3 text-center">Pts</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((r, i) => (
                <tr key={r.organization_id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-3 text-lg">{MEDAL[i] ?? <span className="font-bold text-slate-400 dark:text-slate-500">{i + 1}</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={r.organization?.name} size={30} />
                      <span className="font-medium text-slate-800 dark:text-slate-200">{r.organization?.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center text-slate-600 dark:text-slate-300">{r.played}</td>
                  <td className="px-3 py-3 text-center font-semibold text-emerald-600">{r.won}</td>
                  <td className="px-3 py-3 text-center text-slate-500 dark:text-slate-400">{r.drawn}</td>
                  <td className="px-3 py-3 text-center text-rose-500">{r.lost}</td>
                  <td className="px-4 py-3 text-center"><Badge tone="brand">{r.points}</Badge></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      )}
    </div>
  );
}
