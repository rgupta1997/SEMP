import { useMemo, useState } from 'react';
import { useApi } from '../../lib/hooks';
import { Trophy } from 'lucide-react';
import { Avatar, Badge, EmptyState, ListToolbar, Select, Spinner, Table } from '../../components/ui';

// A draw row (subset of GET /:id/draws) - used only to source the tournament + sport
// filter options (with their UUIDs, which the materialized scopes are keyed by).
interface DrawRow {
  tournament_sports: {
    sports: { id: string; name: string } | null;
    tournaments: { id: string; name: string } | null;
  } | null;
}

interface StandingRow {
  organization_id: string;
  organization: { id: string; name: string; short_name?: string | null; logo_url?: string | null } | null;
  played: number; won: number; drawn: number; lost: number; points: number;
  detail: Record<string, number>;
  rank: number | null;
}
interface StandingsResponse { scope: string; scope_id: string | null; standings: StandingRow[]; completed_matches: number }

const MEDAL = ['🥇', '🥈', '🥉'];

// Read-only standings for the participant view - the same per-scope tables the
// organiser sees. Standings are materialized one scope at a time, so the tournament
// + sport filters select a single scope (most specific wins): sport → tournament →
// whole championship.
export function ChampionshipStandings({ championshipId }: { championshipId: string }) {
  const { data: draws = [] } = useApi<DrawRow[]>(`/championships/${championshipId}/draws`);
  const [tournamentId, setTournamentId] = useState('');
  const [sportId, setSportId] = useState('');

  const tournamentOptions = useMemo(() => {
    const map = new Map<string, string>();
    draws.forEach((d) => { const t = d.tournament_sports?.tournaments; if (t) map.set(t.id, t.name); });
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [draws]);
  const sportOptions = useMemo(() => {
    const map = new Map<string, string>();
    draws.forEach((d) => { const s = d.tournament_sports?.sports; if (s) map.set(s.id, s.name); });
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [draws]);

  const { scope, scopeId } = useMemo(() => {
    if (sportId) return { scope: 'sport', scopeId: sportId };
    if (tournamentId) return { scope: 'tournament', scopeId: tournamentId };
    return { scope: 'championship', scopeId: null as string | null };
  }, [sportId, tournamentId]);

  const query = scopeId ? `?scope=${scope}&scopeId=${scopeId}` : `?scope=${scope}`;
  const { data, isLoading } = useApi<StandingsResponse>(`/championships/${championshipId}/standings${query}`);
  const rows = data?.standings ?? [];

  // Show a medals column only when some discipline used the medal scheme.
  const showMedals = rows.some((r) => r.detail && (r.detail.gold || r.detail.silver || r.detail.bronze));

  return (
    <div className="space-y-4">
      {(tournamentOptions.length > 1 || sportOptions.length > 1) && (
        <ListToolbar>
          {tournamentOptions.length > 1 && (
            <Select value={tournamentId} onChange={(e) => { setTournamentId(e.target.value); setSportId(''); }} className="w-auto" aria-label="Filter by tournament">
              <option value="">All tournaments</option>
              {tournamentOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          )}
          {sportOptions.length > 1 && (
            <Select value={sportId} onChange={(e) => { setSportId(e.target.value); setTournamentId(''); }} className="w-auto" aria-label="Filter by sport">
              <option value="">All sports</option>
              {sportOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
        </ListToolbar>
      )}

      {isLoading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState icon={<Trophy size={24} />} title="No results yet" description="Standings populate as matches are completed." />
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
              {showMedals && <th className="px-3 py-3 text-center">Medals</th>}
              <th className="px-4 py-3 text-center">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.organization_id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-4 py-3 text-lg">{MEDAL[i] ?? <span className="font-bold text-slate-400 dark:text-slate-500">{r.rank ?? i + 1}</span>}</td>
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
                {showMedals && (
                  <td className="px-3 py-3 text-center text-sm tabular-nums">
                    {(['gold', 'silver', 'bronze'] as const).map((m, mi) =>
                      r.detail?.[m] ? <span key={m} className="mr-1.5 whitespace-nowrap">{MEDAL[mi]}{r.detail[m]}</span> : null,
                    )}
                    {!r.detail?.gold && !r.detail?.silver && !r.detail?.bronze && <span className="text-slate-300 dark:text-slate-600">-</span>}
                  </td>
                )}
                <td className="px-4 py-3 text-center"><Badge tone="brand">{r.points}</Badge></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
