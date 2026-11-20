import { useState, type ReactNode } from 'react';
import { formatPoints, isRankingFormatName, type SportTitlesConfig, type StandingsRule } from '@semp/shared';
import { Calculator, ChevronDown, Info, Minus, Plus, Scale, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useApi, useApiMutation } from '../lib/hooks';
import { ruleSummary, sportTitlesFor, titlesLine } from './StandingsRulesCard';
import { Button, Input, cn, toast } from './ui';
import { PickList, type PickOption } from './PickList';
import { TeamAvatar, categoryRank } from '../features/schedule/ScheduleParts';

// Organiser-only cards under the championship table: manual adjustments (deductions,
// forfeits, OC decisions) with a reason, and a plain summary of how the table is built.

export interface AdjustableRow { entity_id: string; name: string; short_name?: string | null; organization_id: string; org_unit: { id: string } | null }
interface DrawOption { id: string; disciplines?: { name: string } | null; tournament_sports?: { sports?: { name: string; icon?: string | null } | null } | null }
interface Adjustment { id: string; entity_id: string; name: string; points: number; reason: string; discipline: string | null; created_by: string | null; created_at: string }

const PANEL = 'overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';

/** A card heading with an icon tile, shared by both cards. */
function PanelHead({ icon: Icon, title, sub, right }: { icon: typeof Scale; title: string; sub: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"><Icon size={18} aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-black text-slate-800 dark:text-slate-100">{title}</div>
        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</div>
      </div>
      {right}
    </div>
  );
}

const Label = ({ children }: { children: ReactNode }) => (
  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</span>
);

export function StandingsAdjustments({ eventId, rows, draws }: { eventId: string; rows: AdjustableRow[]; draws: DrawOption[] }) {
  const path = `/championships/${eventId}/standings-adjustments`;
  const { data: list = [] } = useApi<Adjustment[]>(path);
  const [entity, setEntity] = useState('');
  const [drawId, setDrawId] = useState('');
  // Deduct is the common case (forfeits, conduct), so it is the default.
  const [sign, setSign] = useState<1 | -1>(-1);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const add = useApiMutation((body: object) => api('POST', path, body), []);
  const remove = useApiMutation((id: string) => api('DELETE', `${path}/${id}`), []);

  const size = Number(amount);
  const value = sign * size;
  const validAmount = amount.trim() !== '' && Number.isFinite(size) && size > 0 && Number.isInteger(size * 2);
  const valid = !!entity && validAmount && reason.trim().length >= 3;
  // Half-point steps from the buttons; typing still allows any whole or half value.
  const step = (d: number) => setAmount(String(Math.max(0.5, (Number.isFinite(size) ? size : 0) + d)));
  const row = rows.find((r) => r.entity_id === entity);
  const draw = draws.find((d) => d.id === drawId);
  const drawName = (d: DrawOption) => [d.tournament_sports?.sports?.name, d.disciplines?.name].filter(Boolean).join(' · ');

  const teamOptions: PickOption[] = rows.map((r) => ({ value: r.entity_id, label: r.name, icon: <TeamAvatar name={r.name} short={r.short_name} size="sm" /> }));
  // Grouped by sport (A-Z), then Men's > Women's > Mixed inside each.
  const drawOptions: PickOption[] = [
    { value: '', label: 'Overall table only', hint: 'No discipline' },
    ...draws
      .map((d) => ({ d, sport: d.tournament_sports?.sports?.name ?? 'Other', name: d.disciplines?.name ?? 'Discipline' }))
      .sort((a, b) => a.sport.localeCompare(b.sport) || categoryRank(a.name) - categoryRank(b.name) || a.name.localeCompare(b.name))
      .map(({ d, sport, name }) => ({ value: d.id, label: name, group: sport, icon: <span className="text-base leading-none">{d.tournament_sports?.sports?.icon || '🏅'}</span> })),
  ];

  const submit = () => {
    if (!row) return;
    add.mutate(
      { organization_id: row.organization_id, org_unit_id: row.org_unit?.id ?? null, tournament_discipline_id: drawId || null, points: value, reason: reason.trim() },
      { onSuccess: () => { toast.success('Adjustment added'); setAmount(''); setReason(''); }, onError: (e: any) => toast.error(e.message) },
    );
  };

  return (
    <section className={PANEL}>
      <div className="p-4 sm:p-5">
        <PanelHead icon={Scale} title="Adjust points"
          sub="Add or deduct points with a reason: OC decisions, forfeits, conduct. Every change is in the audit log." />
      </div>

      <div className="space-y-3 border-y border-slate-100 bg-slate-50/70 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-800/30">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="min-w-0">
            <Label>Team</Label>
            <PickList value={entity} onChange={setEntity} options={teamOptions} placeholder="Choose a team" searchPlaceholder="Search teams" ariaLabel="Team" />
          </div>
          <div className="min-w-0">
            <Label>Applies to</Label>
            <PickList value={drawId} onChange={setDrawId} options={drawOptions} searchPlaceholder="Search sports or disciplines" ariaLabel="Applies to" />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)]">
          <div>
            <Label>Points</Label>
            <div className="flex items-center gap-2">
              {/* Deduct / Add, then the size: a sign is never typed by mistake. */}
              <div role="radiogroup" aria-label="Deduct or add" className="inline-flex rounded-lg bg-slate-200/70 p-0.5 dark:bg-slate-700/60">
                {([[-1, 'Deduct'], [1, 'Add']] as const).map(([s, label]) => (
                  <button key={label} type="button" role="radio" aria-checked={sign === s} onClick={() => setSign(s)}
                    className={cn('rounded-md px-3 py-1.5 text-[13px] font-semibold transition',
                      sign === s
                        ? s < 0 ? 'bg-white text-rose-600 shadow-sm dark:bg-slate-950 dark:text-rose-300' : 'bg-white text-emerald-600 shadow-sm dark:bg-slate-950 dark:text-emerald-300'
                        : 'text-slate-500 hover:text-slate-700 dark:text-slate-400')}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                <button type="button" onClick={() => step(-0.5)} aria-label="Half a point less" className="grid h-9 w-8 place-items-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><Minus size={14} /></button>
                <input value={amount} inputMode="decimal" placeholder="0" aria-label="Points"
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                  className="h-9 w-12 bg-transparent text-center text-sm font-bold tabular-nums text-slate-800 outline-none placeholder:text-slate-300 dark:text-slate-100" />
                <button type="button" onClick={() => step(0.5)} aria-label="Half a point more" className="grid h-9 w-8 place-items-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><Plus size={14} /></button>
              </div>
            </div>
          </div>
          <label className="block min-w-0">
            <Label>Reason</Label>
            <Input value={reason} maxLength={300} placeholder="e.g. Fielded an ineligible player (OC decision 12 Nov)" onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* What saving will do, in one line. */}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {row && validAmount ? (
              <>
                <span className={cn('font-bold tabular-nums', value < 0 ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-300')}>
                  {value > 0 ? '+' : ''}{formatPoints(value)} pts
                </span>{' '}
                for <span className="font-semibold text-slate-700 dark:text-slate-200">{row.name}</span>
                {draw ? <>, also shown in <span className="font-semibold text-slate-700 dark:text-slate-200">{drawName(draw)}</span></> : ', overall table only'}
              </>
            ) : 'Whole or half points. Pick a discipline to show it in that sport\'s table too.'}
          </p>
          <Button disabled={!valid || add.isPending} onClick={submit}>{add.isPending ? 'Saving…' : 'Add adjustment'}</Button>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">History</span>
          {list.length > 0 && <span className="text-[11px] text-slate-400">{list.length} change{list.length === 1 ? '' : 's'}</span>}
        </div>
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-xs text-slate-400 dark:border-slate-700">No adjustments yet.</p>
        ) : (
          <ul className="space-y-2">
            {list.map((a) => {
              const team = rows.find((r) => r.entity_id === a.entity_id);
              return (
                <li key={a.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-800">
                  <span className={cn('grid h-9 min-w-[3rem] shrink-0 place-items-center rounded-lg px-2 text-sm font-black tabular-nums',
                    a.points < 0 ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300')}>
                    {a.points > 0 ? '+' : ''}{formatPoints(a.points)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <TeamAvatar name={a.name} short={team?.short_name} size="sm" />
                      <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{a.name}</span>
                      {a.discipline && <span className="truncate rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{a.discipline}</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400" title={a.reason}>
                      {a.reason}
                      <span className="text-slate-400"> · {[a.created_by, new Date(a.created_at).toLocaleDateString()].filter(Boolean).join(' · ')}</span>
                    </span>
                  </span>
                  <button type="button" disabled={remove.isPending} title="Remove this adjustment" aria-label="Remove this adjustment"
                    onClick={() => remove.mutate(a.id, { onSuccess: () => toast.success('Adjustment removed'), onError: (e: any) => toast.error(e.message) })}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-500/10">
                    <Trash2 size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

interface RulesResponse {
  default: StandingsRule;
  rules: Array<{ scope_type: string; scope_id: string | null; config: StandingsRule }>;
  disciplines: Array<{ id: string; name: string; sport: string | null; sport_id: string | null; entry_type: string | null; format: string | null }>;
  formats: Array<{ id: string; name: string }>;
  sports: Array<{ id: string; name: string; titles: SportTitlesConfig | null }>;
}

/** A rule line: who it applies to, then its parts as chips ("Match points (W/D/L) · Win 2 · ..."). */
function RuleRow({ label, note, summary, warn }: { label: string; note?: string; summary: string; warn?: boolean }) {
  const [scheme, ...parts] = summary.split(' · ');
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-xl border px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3',
      warn ? 'border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10' : 'border-slate-200 dark:border-slate-800')}>
      <span className="min-w-0 sm:w-56 sm:shrink-0">
        <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</span>
        {note && <span className="block text-[11px] text-slate-400">{note}</span>}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className={cn('text-xs', warn ? 'text-amber-800 dark:text-amber-200' : 'text-slate-600 dark:text-slate-300')}>{scheme}</span>
        {parts.map((p) => <span key={p} className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">{p}</span>)}
      </span>
    </div>
  );
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
  const defSummary = ruleSummary(def);
  return (
    <section className={PANEL}>
      <button type="button" className="w-full p-4 text-left sm:p-5" onClick={() => setOpen(!open)} aria-expanded={open}>
        <PanelHead icon={Calculator} title="How this table is calculated"
          sub={open ? 'The point system behind every row above.' : defSummary.split(' · ').slice(1).join(' · ') || defSummary}
          right={(
            <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-400">
              {open ? 'Hide' : 'Show'}<ChevronDown size={15} className={cn('transition-transform', open && 'rotate-180')} />
            </span>
          )} />
      </button>
      {open && (
        <div className="space-y-2 px-4 pb-4 sm:px-5 sm:pb-5">
          <RuleRow label="Every discipline" note={saved ? undefined : 'Built-in, not saved'} summary={defSummary} />
          {overrides.map((r, i) => {
            const d = data.disciplines.find((x) => x.id === r.scope_id);
            return <RuleRow key={i} label={name(r)} summary={ruleSummary(r.config, d?.sport, d?.entry_type)} />;
          })}
          {sportTitlesFor(data).map((s) => (
            <RuleRow key={s.sport} label={`${s.sport} titles`} warn={s.mixed}
              note={s.mixed ? 'A whole-sport title sits beside the gender titles; check this is intended.' : undefined}
              summary={titlesLine(s, data.sports.find((x) => x.id === s.sportId)?.titles ?? null)} />
          ))}
          <p className="flex gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
            <Info size={14} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
            <span>
              Each discipline's points are added up per entrant, plus any adjustments below. Level totals are ordered by {def.scheme === 'league_points' ? def.tiebreakers.join(', ').replace(/_/g, ' ') : 'points, wins, fewest losses, then score difference'}.
              Group and league tables (with their tie-breakers) are on the Schedule page, in each draw's Grid view.
            </span>
          </p>
        </div>
      )}
    </section>
  );
}
