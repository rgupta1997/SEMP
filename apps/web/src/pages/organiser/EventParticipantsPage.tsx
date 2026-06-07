import { useMemo, useState } from 'react';
import { useEvent } from './EventLayout';
import { usePageFilters } from '../../lib/filters';
import { useApi, useTableControls } from '../../lib/hooks';
import { Card, Spinner, Badge, SearchInput, Pagination, Avatar, ListToolbar, Select } from '../../components/ui';

interface Participant {
  id: string;
  name: string;
  email: string;
  phone?: string;
  institution?: { id: string; name: string; short_name?: string };
  teams: Array<{ team_id: string; team_name: string; sport?: { name: string; icon?: string }; role: string; jersey_number?: number }>;
}

export function EventParticipantsPage() {
  const { eventId } = useEvent();
  const { data: participants, isLoading } = useApi<Participant[]>(`/events/${eventId}/participants`);
  const [search, setSearch] = useState('');
  const [institutionId, setInstitutionId] = useState('');

  // Sports represented by any participant's team(s) — surfaced in the header filter.
  const sportOptions = useMemo(() => {
    const set = new Set<string>();
    (participants ?? []).forEach((p) => p.teams.forEach((tm) => { if (tm.sport?.name) set.add(tm.sport.name); }));
    return [...set].sort().map((name) => ({ id: name, name }));
  }, [participants]);
  const { sportId } = usePageFilters({ sports: sportOptions.length ? sportOptions : undefined });

  // Institutions present among participants — drives the dedicated filter.
  const institutionOptions = useMemo(() => {
    const m = new Map<string, string>();
    (participants ?? []).forEach((p) => { if (p.institution?.id) m.set(p.institution.id, p.institution.name); });
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [participants]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (participants ?? []).filter((p) => {
      if (sportId && !p.teams.some((tm) => tm.sport?.name === sportId)) return false;
      if (institutionId && p.institution?.id !== institutionId) return false;
      return p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        (p.institution?.name ?? '').toLowerCase().includes(q);
    });
  }, [participants, search, sportId, institutionId]);

  // Group filtered participants by institution.
  const groups = useMemo(() => {
    const byInstitution = new Map<string, Participant[]>();
    for (const p of filtered) {
      const instId = p.institution?.id || 'unaffiliated';
      if (!byInstitution.has(instId)) byInstitution.set(instId, []);
      byInstitution.get(instId)!.push(p);
    }
    return [...byInstitution.entries()];
  }, [filtered]);

  const t = useTableControls(groups, { pageSize: 8 });

  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Participants</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {participants?.length || 0} participants from {groups.length} institutions
          </p>
        </div>
        <ListToolbar inline className="w-full sm:w-auto">
          <SearchInput
            placeholder="Search by name, email, institution…"
            value={search}
            onChange={setSearch}
            className="w-full sm:w-72"
          />
          {institutionOptions.length > 1 && (
            <Select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)} aria-label="Filter by institution">
              <option value="">All institutions</option>
              {institutionOptions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </Select>
          )}
        </ListToolbar>
      </div>

      {groups.length === 0 ? (
        <Card className="p-8 text-center text-slate-500 dark:text-slate-400">
          {search || sportId || institutionId ? 'No participants match your filters.' : 'No participants yet. Participants will appear here once institutions create teams and add players.'}
        </Card>
      ) : (
        <>
          {t.view.map(([instId, members]) => {
            const inst = members[0]?.institution;
            return (
              <Card key={instId} className="overflow-hidden">
                <div className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      {inst?.name || 'Unaffiliated'}
                      {inst?.short_name && <span className="ml-2 text-slate-500 dark:text-slate-400">({inst.short_name})</span>}
                    </div>
                    <Badge tone="slate">{members.length} players</Badge>
                  </div>
                </div>
                <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  <thead className="bg-slate-50/50">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Player</th>
                      <th className="px-4 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Contact</th>
                      <th className="px-4 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Teams</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {members.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <Avatar name={p.name} size={28} />
                            <span className="font-medium text-slate-800 dark:text-slate-200">{p.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                          <div>{p.email}</div>
                          {p.phone && <div className="text-xs text-slate-400 dark:text-slate-500">{p.phone}</div>}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {p.teams.map((tm) => (
                              <Badge key={tm.team_id} tone="slate" className="text-xs">
                                {tm.sport?.icon || '🏅'} {tm.team_name}
                                {tm.jersey_number && ` #${tm.jersey_number}`}
                              </Badge>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            );
          })}
          <Pagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} />
        </>
      )}
    </div>
  );
}
