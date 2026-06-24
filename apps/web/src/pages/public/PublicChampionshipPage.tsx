import { useState } from 'react';
import { useApi, fmtDate } from '../../lib/hooks';
import { BrandMark } from '../../components/BrandMark';
import { Card, CardBody, EmptyState, Spinner, StatCard, StatusBadge, Tabs } from '../../components/ui';
import { ChampionshipStandings } from '../../components/participant/ChampionshipStandings';
import { ChampionshipFixtures } from '../../components/participant/ChampionshipFixtures';

interface PublicOverview {
  championship: {
    id: string; name: string; slug: string; description?: string | null; venue?: string | null;
    start_date: string; end_date: string; status: string;
  };
  sports: { name: string; icon?: string | null }[];
  stats: { organizations: number; fixtures: number; completed_matches: number };
}

// Unauthenticated, view-only championship page reached via a share token (/c/:token).
// Shows Overview + Standings, fetched from the public (no-auth) API.
export function PublicChampionshipPage({ token }: { token: string }) {
  const [tab, setTab] = useState('overview');
  const { data, isLoading } = useApi<PublicOverview>(token ? `/public/championships/${token}/overview` : null);

  if (isLoading) return <div className="grid h-screen place-items-center"><Spinner /></div>;
  if (!data) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-4 dark:bg-slate-950">
        <EmptyState icon="🔗" title="Link not found" description="This share link is invalid or no longer available." />
      </div>
    );
  }

  const c = data.championship;
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <BrandMark variant="white" />
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Public view</span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{c.name}</h1>
            <StatusBadge status={c.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {c.venue ? `${c.venue} · ` : ''}{fmtDate(c.start_date)} – {fmtDate(c.end_date)}
          </p>
        </div>

        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'schedule', label: 'Schedule' },
            { id: 'results', label: 'Results' },
            { id: 'standings', label: 'Standings' },
          ]}
        />

        {tab === 'schedule' ? (
          <ChampionshipFixtures championshipId="" mode="schedule" apiBase={`/public/championships/${token}`} />
        ) : tab === 'results' ? (
          <ChampionshipFixtures championshipId="" mode="results" apiBase={`/public/championships/${token}`} />
        ) : tab === 'overview' ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Organizations" value={data.stats.organizations} />
              <StatCard label="Matches" value={data.stats.fixtures} />
              <StatCard label="Completed" value={data.stats.completed_matches} accent />
            </div>
            {c.description && (
              <Card><CardBody><p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{c.description}</p></CardBody></Card>
            )}
            {data.sports.length > 0 && (
              <Card><CardBody>
                <div className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Sports</div>
                <div className="flex flex-wrap gap-2">
                  {data.sports.map((s) => (
                    <span key={s.name} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {s.icon ?? '◇'} {s.name}
                    </span>
                  ))}
                </div>
              </CardBody></Card>
            )}
          </div>
        ) : (
          <ChampionshipStandings championshipId="" apiBase={`/public/championships/${token}`} />
        )}
      </main>
    </div>
  );
}
