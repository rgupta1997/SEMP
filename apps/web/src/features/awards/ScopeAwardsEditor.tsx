import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useApi, useApiMutation } from '../../lib/hooks';
import { Button, Card, CardBody, CardHeader, Field, Input, SearchableSelect, Select, Spinner, toast } from '../../components/ui';
import type { AwardType } from './types';

export type ScopeLevel = 'tournament_sport' | 'tournament' | 'championship';
export interface AwardScopeRef { level: ScopeLevel; tournament_id?: string; tournament_sport_id?: string; title: string; subtitle: string }

export interface ChampionshipAward {
  id: string;
  level: ScopeLevel;
  tournament_id: string | null;
  tournament_sport_id: string | null;
  tournament_name: string | null;
  sport_name: string | null;
  award_type_id: string;
  award_name: string;
  recipient_kind: 'player' | 'team';
  recipient_user_id: string | null;
  recipient_team_id: string | null;
  recipient_name: string | null;
  notes: string | null;
}

interface Options {
  types: AwardType[];
  teams: Array<{ id: string; name: string; organization: string | null; sport: string | null }>;
  players: Array<{ id: string; name: string; team_id: string; team: string }>;
}

type Row = { award_type_id: string; recipient_user_id: string | null; recipient_team_id: string | null; notes: string };

export const inScope = (a: ChampionshipAward, s: AwardScopeRef) =>
  a.level === s.level
  && (a.tournament_id ?? undefined) === (s.level === 'championship' ? undefined : s.tournament_id)
  && (a.tournament_sport_id ?? undefined) === (s.level === 'tournament_sport' ? s.tournament_sport_id : undefined);

export const scopeQuery = (s: AwardScopeRef) => new URLSearchParams({
  level: s.level,
  ...(s.tournament_id && s.level !== 'championship' ? { tournament_id: s.tournament_id } : {}),
  ...(s.tournament_sport_id && s.level === 'tournament_sport' ? { tournament_sport_id: s.tournament_sport_id } : {}),
}).toString();

// Give awards within one scope - a sport in a tournament, a tournament, or the
// whole event. Award types come from the catalogue (offered at this level for a
// sport in the scope); recipients are the teams entered in it and their players.
export function ScopeAwardsEditor({ eventId, scope, saved, readOnly }: {
  eventId: string;
  scope: AwardScopeRef;
  saved: ChampionshipAward[];
  readOnly?: boolean;
}) {
  const optionsPath = `/championships/${eventId}/awards/options?${scopeQuery(scope)}`;
  const { data: options, isLoading } = useApi<Options>(optionsPath);
  const types = useMemo(() => options?.types ?? [], [options]);
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const [rows, setRows] = useState<Row[]>([]);

  // Reload whenever the scope or what is saved for it changes.
  const savedKey = saved.map((a) => a.id).join(',');
  useEffect(() => {
    setRows(saved.map((a) => ({
      award_type_id: a.award_type_id,
      recipient_user_id: a.recipient_user_id,
      recipient_team_id: a.recipient_team_id,
      notes: a.notes ?? '',
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey, scope.level, scope.tournament_id, scope.tournament_sport_id]);

  const save = useApiMutation(
    (body: unknown) => api('PUT', `/championships/${eventId}/awards`, body),
    [`/championships/${eventId}/awards`],
  );

  const players = options?.players ?? [];
  const teams = options?.teams ?? [];
  const playerOptions = useMemo(() => players.map((p) => ({ id: p.id, label: `${p.name} · ${p.team}` })), [players]);

  const blank = (typeId: string): Row => {
    const team = typeById.get(typeId)?.recipient_kind === 'team';
    return { award_type_id: typeId, recipient_user_id: null, recipient_team_id: team ? teams[0]?.id ?? null : null, notes: '' };
  };
  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const changeType = (i: number, typeId: string) => setRows((r) => r.map((row, idx) => {
    if (idx !== i) return row;
    const sameKind = typeById.get(typeId)?.recipient_kind === typeById.get(row.award_type_id)?.recipient_kind;
    return sameKind ? { ...row, award_type_id: typeId } : { ...blank(typeId), notes: row.notes };
  }));

  const problem = rows.some((r) => !typeById.has(r.award_type_id)) ? 'Pick an award for every row'
    : rows.some((r) => !r.recipient_user_id && !r.recipient_team_id) ? 'Pick who gets each award' : null;

  const submit = () => save.mutate({
    level: scope.level,
    tournament_id: scope.level === 'championship' ? null : scope.tournament_id ?? null,
    tournament_sport_id: scope.level === 'tournament_sport' ? scope.tournament_sport_id ?? null : null,
    awards: rows.map((r) => ({ ...r, notes: r.notes.trim() || null })),
  }, {
    onSuccess: () => toast.success('Awards saved'),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader title={scope.title} subtitle={scope.subtitle} />
      <CardBody className="space-y-3">
        {isLoading ? (
          <div className="grid h-24 place-items-center"><Spinner /></div>
        ) : types.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No award types are offered at this level for these sports. Add one for this event below, or ask a platform admin.</p>
        ) : teams.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No teams are entered here yet, so there is nobody to give an award to.</p>
        ) : (
          <>
            {rows.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">No awards given here yet.</p>}
            {rows.map((row, i) => {
              const type = typeById.get(row.award_type_id);
              const team = type?.recipient_kind === 'team';
              return (
                <div key={i} data-qa="scope-award-row" className="grid grid-cols-1 items-start gap-x-2 rounded-lg border border-slate-100 p-3 dark:border-slate-800 sm:grid-cols-[1fr_1fr_auto]">
                  <Field label="Award" compact>
                    <Select className="w-full" value={type ? row.award_type_id : ''} disabled={readOnly} onChange={(e) => changeType(i, e.target.value)}>
                      <option value="" disabled>Choose an award…</option>
                      {types.map((t) => <option key={t.id} value={t.id}>{t.label}{t.recipient_kind === 'team' ? ' (team)' : ''}{t.championship_id ? ' · this event' : ''}</option>)}
                    </Select>
                  </Field>
                  <Field label={team ? 'Team' : 'Player'} compact>
                    {team ? (
                      <Select className="w-full" value={row.recipient_team_id ?? ''} disabled={readOnly} onChange={(e) => update(i, { recipient_team_id: e.target.value, recipient_user_id: null })}>
                        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.organization ? ` · ${t.organization}` : ''}</option>)}
                      </Select>
                    ) : (
                      <SearchableSelect
                        className="w-full"
                        value={row.recipient_user_id ?? ''}
                        onChange={(id) => update(i, { recipient_user_id: id, recipient_team_id: null })}
                        options={playerOptions}
                        placeholder="Choose a player…"
                        searchPlaceholder="Search players…"
                      />
                    )}
                  </Field>
                  {!readOnly && (
                    <Button variant="ghost" size="sm" className="sm:mt-6" onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))} aria-label="Remove award" title="Remove">
                      <Trash2 size={14} />
                    </Button>
                  )}
                  <div className="sm:col-span-2">
                    <Field label="Note (optional)" compact>
                      <Input value={row.notes} disabled={readOnly} maxLength={500} placeholder="e.g. 42 raid points across the tournament" onChange={(e) => update(i, { notes: e.target.value })} />
                    </Field>
                  </div>
                </div>
              );
            })}
            {!readOnly && (
              <div className="flex items-center justify-between pt-1">
                <Button variant="outline" size="sm" onClick={() => setRows((r) => [...r, blank(types[0].id)])}>+ Add award</Button>
                <Button size="sm" data-qa="scope-awards-save" disabled={save.isPending || !!problem} title={problem ?? undefined} onClick={submit}>
                  {save.isPending ? 'Saving…' : 'Save awards'}
                </Button>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
