import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Medal, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useApi, useApiMutation } from '../../lib/hooks';
import { EmptyState, Input, cn, toast } from '../../components/ui';
import { PickList } from '../../components/PickList';
import { IconAction } from '../../components/CrewPanel';
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

const FIELD_LABEL = 'mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-400';

// Give awards within one scope - a sport in a tournament, a tournament, or the
// whole event. Award types come from the catalogue (offered at this level for a
// sport in the scope); recipients are the teams entered in it and their players.
export function ScopeAwardsEditor({ eventId, scope, saved, readOnly, icon }: {
  eventId: string;
  scope: AwardScopeRef;
  saved: ChampionshipAward[];
  readOnly?: boolean;
  /** The scope's own mark in the header (a sport's emoji, a trophy). */
  icon?: ReactNode;
}) {
  const optionsPath = `/championships/${eventId}/awards/options?${scopeQuery(scope)}`;
  const { data: options, isLoading } = useApi<Options>(optionsPath);
  const types = useMemo(() => options?.types ?? [], [options]);
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const [rows, setRows] = useState<Row[]>([]);

  // What is saved for this scope, as editable rows.
  const savedRows = useMemo<Row[]>(() => saved.map((a) => ({
    award_type_id: a.award_type_id,
    recipient_user_id: a.recipient_user_id,
    recipient_team_id: a.recipient_team_id,
    notes: a.notes ?? '',
  })), [saved]);
  // Reload whenever the scope or what is saved for it changes.
  const savedKey = saved.map((a) => a.id).join(',');
  useEffect(() => {
    setRows(savedRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey, scope.level, scope.tournament_id, scope.tournament_sport_id]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(savedRows);

  const save = useApiMutation(
    (body: unknown) => api('PUT', `/championships/${eventId}/awards`, body),
    [`/championships/${eventId}/awards`],
  );

  const players = options?.players ?? [];
  const teams = options?.teams ?? [];
  const typeOptions = useMemo(() => types.map((t) => ({
    value: t.id, label: t.label, hint: t.recipient_kind === 'team' ? 'Team' : 'Player',
    group: t.championship_id ? 'This event only' : 'Standard awards',
  })), [types]);
  const teamOptions = useMemo(() => teams.map((t) => ({ value: t.id, label: t.name, hint: t.organization ?? undefined })), [teams]);
  const playerOptions = useMemo(() => players.map((p) => ({ value: p.id, label: p.name, hint: p.team })), [players]);

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
  const add = () => setRows((r) => [...r, blank(types[0].id)]);

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
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-lg text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" aria-hidden>
          {icon ?? <Medal size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-black text-slate-900 dark:text-slate-100">{scope.title}</h2>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{scope.subtitle}</p>
        </div>
        {saved.length > 0 && (
          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            {saved.length} given
          </span>
        )}
      </header>

      {isLoading ? (
        <div className="space-y-2 p-4" aria-label="Loading">{[0, 1].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}</div>
      ) : types.length === 0 ? (
        <EmptyState bare compact icon={<Medal size={22} />} title="No awards offered here"
          description="No award types are offered at this level for these sports. Add one for this event below, or ask a platform admin." />
      ) : teams.length === 0 ? (
        <EmptyState bare compact icon={<Medal size={22} />} title="Nobody to award yet"
          description="No teams are entered here yet, so there is nobody to give an award to." />
      ) : rows.length === 0 && saved.length === 0 ? (
        // Only when nothing was saved: removing every saved award must still leave Save to confirm it.
        <EmptyState bare compact icon={<Medal size={22} />} title="No awards given here yet"
          description="Pick an award and who gets it - best player, fair play, top scorer."
          action={!readOnly ? <button type="button" onClick={add} className="bg-brand-600 text-white hover:bg-brand-700"><Plus size={14} aria-hidden />Add award</button> : undefined} />
      ) : (
        <>
          {rows.length === 0 && <p className="px-4 pt-4 text-sm text-slate-500 dark:text-slate-400">Every award here has been removed. Save to confirm, or add one back.</p>}
          <ol className="space-y-2.5 p-3 empty:hidden sm:p-4">
            {rows.map((row, i) => {
              const type = typeById.get(row.award_type_id);
              const team = type?.recipient_kind === 'team';
              return (
                <li key={i} data-qa="scope-award-row" className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-800/20">
                  <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-sm sm:grid" aria-hidden>
                    <Medal size={16} />
                  </span>
                  <div className="grid min-w-0 flex-1 gap-2.5 sm:grid-cols-2">
                    <label className="min-w-0">
                      <span className={FIELD_LABEL}>Award</span>
                      {readOnly
                        ? <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{type?.label ?? '-'}</span>
                        : <PickList value={type ? row.award_type_id : ''} onChange={(v) => changeType(i, v)} options={typeOptions} placeholder="Choose an award…" searchPlaceholder="Find an award" ariaLabel="Award" />}
                    </label>
                    <label className="min-w-0">
                      <span className={FIELD_LABEL}>{team ? 'Team' : 'Player'}</span>
                      {readOnly
                        ? <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                            {(team ? teams.find((t) => t.id === row.recipient_team_id)?.name : players.find((p) => p.id === row.recipient_user_id)?.name) ?? '-'}
                          </span>
                        : team
                          ? <PickList value={row.recipient_team_id ?? ''} onChange={(v) => update(i, { recipient_team_id: v, recipient_user_id: null })} options={teamOptions} placeholder="Choose a team…" searchPlaceholder="Find a team" ariaLabel="Team" />
                          : <PickList value={row.recipient_user_id ?? ''} onChange={(v) => update(i, { recipient_user_id: v, recipient_team_id: null })} options={playerOptions} placeholder="Choose a player…" searchPlaceholder="Search players" ariaLabel="Player" />}
                    </label>
                    <label className="min-w-0 sm:col-span-2">
                      <span className={FIELD_LABEL}>Note <span className="normal-case tracking-normal text-slate-400/80">(optional)</span></span>
                      <Input value={row.notes} disabled={readOnly} maxLength={500} placeholder="e.g. 42 raid points across the tournament" onChange={(e) => update(i, { notes: e.target.value })} className="w-full" />
                    </label>
                  </div>
                  {!readOnly && (
                    <span className="shrink-0 pt-5">
                      <IconAction icon={Trash2} danger label="Remove award" onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))} />
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-3 sm:px-4 dark:border-slate-800">
              <button type="button" onClick={add}
                className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-[13px] font-semibold text-slate-600 transition hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-700 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-brand-500/10">
                <Plus size={14} aria-hidden />Add award
              </button>
              <span className="ml-auto flex items-center gap-3">
                {dirty && <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />Unsaved changes</span>}
                <button type="button" data-qa="scope-awards-save" disabled={save.isPending || !!problem || !dirty} title={problem ?? (!dirty ? 'Nothing to save' : undefined)} onClick={submit}
                  className={cn('inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50',
                    'bg-brand-600 text-white hover:bg-brand-700 dark:bg-brand-500')}>
                  {save.isPending ? 'Saving…' : 'Save awards'}
                </button>
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
