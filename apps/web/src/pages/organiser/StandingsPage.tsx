import { useEvent } from './EventLayout';
import { useApi } from '../../lib/hooks';
import { Avatar, Badge, Card, CardBody, CardHeader, EmptyState, Spinner, StatCard, Table } from '../../components/ui';

interface StandingRow {
  organization_id: string; organization: any;
  played: number; won: number; drawn: number; lost: number; points: number;
}
interface StandingsResponse { standings: StandingRow[]; completed_matches: number }

const MEDAL = ['🥇', '🥈', '🥉'];

export function StandingsPage() {
  const { eventId } = useEvent();
  const { data, isLoading } = useApi<StandingsResponse>(`/championships/${eventId}/standings`);
  const rows = data?.standings ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Completed matches" value={data?.completed_matches ?? 0} />
        <StatCard label="Organizations scoring" value={rows.length} />
        <StatCard label="Leader" value={rows[0]?.organization?.short_name ?? rows[0]?.organization?.name ?? '—'} accent />
      </div>

      <Card>
        <CardHeader title="Championship table" subtitle="Computed live from completed fixtures · win = 3, draw = 1" />
        <CardBody>
          {isLoading ? <Spinner /> : rows.length === 0 ? (
            <EmptyState icon="🏆" title="No results yet" description="Standings populate as officials complete matches with scores." />
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
                {rows.map((r, i) => (
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
          )}
        </CardBody>
      </Card>
    </div>
  );
}
