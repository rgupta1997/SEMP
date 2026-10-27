import { useState } from 'react';
import { formatPoints, isRankingFormatName, type SportTitlesConfig, type StandingsRule } from '@semp/shared';
import { api } from '../lib/api';
import { useApi, useApiMutation } from '../lib/hooks';
import { ruleSummary, sportTitlesFor, titlesLine } from './StandingsRulesCard';
import { Badge, Button, Card, CardBody, CardHeader, Input, Select, toast } from './ui';

// Organiser-only cards under the championship table: manual adjustments (deductions,
// forfeits, OC decisions) with a reason, and a plain summary of how the table is built.

export interface AdjustableRow { entity_id: string; name: string; organization_id: string; org_unit: { id: string } | null }
interface DrawOption { id: string; disciplines?: { name: string } | null; tournament_sports?: { sports?: { name: string } | null } | null }
interface Adjustment { id: string; entity_id: string; name: string; points: number; reason: string; discipline: string | null; created_by: string | null; created_at: string }

export function StandingsAdjustments({ eventId, rows, draws }: { eventId: string; rows: AdjustableRow[]; draws: DrawOption[] }) {
  const path = `/championships/${eventId}/standings-adjustments`;
  const { data: list = [] } = useApi<Adjustment[]>(path);
  const [entity, setEntity] = useState('');
  const [drawId, setDrawId] = useState('');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const add = useApiMutation((body: object) => api('POST', path, body), []);
  const remove = useApiMutation((id: string) => api('DELETE', `${path}/${id}`), []);

  const value = Number(points);
  const valid = !!entity && points.trim() !== '' && Number.isFinite(value) && value !== 0 && Number.isInteger(value * 2) && reason.trim().length >= 3;
  const submit = () => {
    const row = rows.find((r) => r.entity_id === entity);
    if (!row) return;
    add.mutate(
      { organization_id: row.organization_id, org_unit_id: row.org_unit?.id ?? null, tournament_discipline_id: drawId || null, points: value, reason: reason.trim() },
      { onSuccess: () => { toast.success('Adjustment added'); setPoints(''); setReason(''); }, onError: (e: any) => toast.error(e.message) },
    );
  };

  return (
    <Card>
      <CardHeader title="Adjust points" subtitle="Add or deduct points with a reason (OC decisions, forfeits, conduct). Every change is in the audit log." />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_110px]">
          <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Choose who</option>
            {rows.map((r) => <option key={r.entity_id} value={r.entity_id}>{r.name}</option>)}
          </Select>
          <Select value={drawId} onChange={(e) => setDrawId(e.target.value)}>
            <option value="">Overall only (no discipline)</option>
            {draws.map((d) => <option key={d.id} value={d.id}>{[d.tournament_sports?.sports?.name, d.disciplines?.name].filter(Boolean).join(' · ')}</option>)}
          </Select>
          <Input value={points} inputMode="decimal" placeholder="-2 or 1.5" onChange={(e) => setPoints(e.target.value.replace(/[^\d.-]/g, ''))} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input className="flex-1" value={reason} maxLength={300} placeholder="Reason, e.g. Fielded an ineligible player (OC decision 12 Nov)" onChange={(e) => setReason(e.target.value)} />
          <Button disabled={!valid || add.isPending} onClick={submit}>{add.isPending ? 'Saving…' : 'Add adjustment'}</Button>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">Whole or half points. A discipline is optional; with one, the adjustment also shows in that sport's table.</p>

        {list.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {list.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <Badge tone={a.points < 0 ? 'rose' : 'green'}>{a.points > 0 ? '+' : ''}{formatPoints(a.points)}</Badge>
                  <span className="ml-2 font-medium text-slate-800 dark:text-slate-100">{a.name}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {[a.discipline, a.reason, a.created_by, new Date(a.created_at).toLocaleDateString()].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <Button size="sm" variant="ghost" disabled={remove.isPending}
                  onClick={() => remove.mutate(a.id, { onSuccess: () => toast.success('Adjustment removed'), onError: (e: any) => toast.error(e.message) })}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

interface RulesResponse {
  default: StandingsRule;
  rules: Array<{ scope_type: string; scope_id: string | null; config: StandingsRule }>;
  disciplines: Array<{ id: string; name: string; sport: string | null; sport_id: string | null; entry_type: string | null; format: string | null }>;
  formats: Array<{ id: string; name: string }>;
  sports: Array<{ id: string; name: string; titles: SportTitlesConfig | null }>;
}

/** "How this table is calculated", in plain words, from the saved point systems. */
export function StandingsCalculation({ eventId }: { eventId: string }) {
  const { data } = useApi<RulesResponse>(`/championships/${eventId}/standings-rules`);
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const saved = data.rules.find((r) => r.scope_type === 'championship');
  const def = saved?.config ?? data.default;
  const name = (r: RulesResponse['rules'][number]) => {
    if (r.scope_type === 'format') return data.formats.find((f) => f.id === r.scope_id)?.name ?? 'Format';
    const d = data.disciplines.find((x) => x.id === r.scope_id);
    return d ? [d.sport, d.name].filter(Boolean).join(' · ') : 'Discipline';
  };
  // A Rankings format rule no longer applies (ranking events take their own rule), so it isn't listed.
  const overrides = data.rules.filter((r) => r.scope_type !== 'championship'
    && !(r.scope_type === 'format' && isRankingFormatName(data.formats.find((f) => f.id === r.scope_id)?.name)));
  return (
    <Card>
      <button type="button" className="flex w-full items-center justify-between px-5 py-4 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">How this table is calculated</span>
        <span className="text-xs text-slate-400">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <CardBody className="space-y-2 pt-0 text-sm text-slate-600 dark:text-slate-300">
          <p><span className="font-semibold">Every discipline</span>{saved ? '' : ' (built-in, not saved)'}: {ruleSummary(def)}</p>
          {overrides.map((r, i) => <p key={i}><span className="font-semibold">{name(r)}</span>: {ruleSummary(r.config, data.disciplines.find((d) => d.id === r.scope_id)?.sport, data.disciplines.find((d) => d.id === r.scope_id)?.entry_type)}</p>)}
          {sportTitlesFor(data).map((s) => (
            <p key={s.sport} className={s.mixed ? 'text-amber-700 dark:text-amber-300' : undefined}>
              <span className="font-semibold">{s.sport} titles</span>: {titlesLine(s, data.sports.find((x) => x.id === s.sportId)?.titles ?? null)}{s.mixed ? '. A whole-sport title sits beside the gender titles; check this is intended.' : ''}
            </p>
          ))}
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Each discipline's points are added up per entrant, plus any adjustments below. Level totals are ordered by {def.scheme === 'league_points' ? def.tiebreakers.join(', ').replace(/_/g, ' ') : 'points, wins, fewest losses, then score difference'}.
            Group and league tables (with their tie-breakers) are on the Schedule page, in each draw's Grid view.
          </p>
        </CardBody>
      )}
    </Card>
  );
}
