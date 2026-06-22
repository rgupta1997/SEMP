import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';
import { Button, Card, CardBody, EmptyState, PageHeader, Spinner } from '../../components/ui';
import { CareerStats } from '../../components/participant/CareerStats';
import { EventCard } from '../../components/participant/EventCard';
import { MatchRow } from '../../components/participant/MatchRow';
import { AchievementRow } from '../../components/participant/AchievementRow';
import type { AchievementGroup, DashboardData } from '../../components/participant/types';

// Initial counts per section — the rest reveal inline via "Show more" so the
// dashboard stays scannable instead of rendering everything at once.
const CHAMP_INITIAL = 6;
const MATCH_INITIAL = 4;
const ACH_INITIAL = 4;

// Reveals the remaining items in a section on click (reveal-all).
function ShowMore({ hidden, onClick }: { hidden: number; onClick: () => void }) {
  if (hidden <= 0) return null;
  return (
    <div className="mt-3 text-center">
      <Button variant="ghost" size="sm" onClick={onClick}>Show {hidden} more</Button>
    </div>
  );
}

export function ParticipantDashboard() {
  const { ctx } = useAuth();
  const user = ctx!.user;
  const { data, isLoading } = useApi<DashboardData>('/me/dashboard');

  const [champShown, setChampShown] = useState(CHAMP_INITIAL);
  const [matchShown, setMatchShown] = useState(MATCH_INITIAL);
  const [achShown, setAchShown] = useState(ACH_INITIAL);

  // Collapse awards by name so repeated honours (e.g. seven "Player of the Match")
  // read as one "7 · Player of the Match" entry; each occurrence's championship /
  // tournament / match is kept for the hover tooltip.
  const achievementGroups = useMemo(() => {
    const map = new Map<string, AchievementGroup>();
    for (const a of data?.achievements ?? []) {
      let g = map.get(a.award_name);
      if (!g) { g = { award_name: a.award_name, count: 0, latest_date: null, instances: [] }; map.set(a.award_name, g); }
      g.count += 1;
      if (a.date && (g.latest_date == null || a.date > g.latest_date)) g.latest_date = a.date;
      g.instances.push({
        id: a.id, championship: a.championship?.name ?? null, tournament: a.tournament?.name ?? null,
        sport: a.sport, discipline: a.discipline, opponent_team_name: a.opponent_team_name,
        date: a.date, fixture_id: a.fixture_id,
      });
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.award_name.localeCompare(b.award_name));
  }, [data?.achievements]);

  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome, ${user.name.split(' ')[0]}`} subtitle="Your matches and championships across the platform." />

      {isLoading || !data ? (
        <Spinner />
      ) : data.stats.total_events === 0 ? (
        <EmptyState
          icon="◎"
          title="You haven't participated in any championships yet"
          description="Join a team via an invite link from your captain — your championships and matches will show up here."
        />
      ) : (
        <>
          <CareerStats stats={data.stats} />

          {achievementGroups.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-bold uppercase tracking-wide text-slate-800 dark:text-slate-200">Achievements</h2>
                <Link to="/profile/achievements" className="text-sm font-semibold text-brand-600 dark:text-brand-300 hover:text-brand-700 dark:hover:text-brand-200">All achievements →</Link>
              </div>
              <div className="space-y-2">
                {achievementGroups.slice(0, achShown).map((g) => <AchievementRow key={g.award_name} group={g} />)}
              </div>
              <ShowMore hidden={achievementGroups.length - achShown} onClick={() => setAchShown(achievementGroups.length)} />
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">My championships</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.championships.slice(0, champShown).map((e) => <EventCard key={e.id} championship={e} />)}
            </div>
            <ShowMore hidden={data.championships.length - champShown} onClick={() => setChampShown(data.championships.length)} />
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold uppercase tracking-wide text-slate-800 dark:text-slate-200">Recent matches</h2>
              <Link to="/profile/matches" className="text-sm font-semibold text-brand-600 dark:text-brand-300 hover:text-brand-700 dark:hover:text-brand-200">All matches →</Link>
            </div>
            {data.recent_matches.length === 0 ? (
              <Card><CardBody className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">No matches scheduled yet.</CardBody></Card>
            ) : (
              <>
                <div className="space-y-2">
                  {data.recent_matches.slice(0, matchShown).map((m) => <MatchRow key={m.id} match={m} />)}
                </div>
                <ShowMore hidden={data.recent_matches.length - matchShown} onClick={() => setMatchShown(data.recent_matches.length)} />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
