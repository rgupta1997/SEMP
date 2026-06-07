import { StatCard } from '../ui';
import type { CareerStatsData } from './types';

// Career totals across every event the participant has played in.
export function CareerStats({ stats }: { stats: CareerStatsData }) {
  const record = `${stats.wins}-${stats.losses}-${stats.draws}`;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StatCard label="Events" value={stats.total_events} />
      <StatCard label="Matches" value={stats.total_matches} />
      <StatCard label="Record (W-L-D)" value={record} accent />
      <StatCard label="Wins" value={stats.wins} hint={`${stats.losses} losses · ${stats.draws} draws`} />
    </div>
  );
}
