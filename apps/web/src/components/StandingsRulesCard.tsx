import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Minus, Pencil, Plus, RotateCcw, Settings2 } from 'lucide-react';
import {
  DEFAULT_RANKING_RULE, DEFAULT_STANDINGS_RULE, EVENT_TITLE_LABEL, EVENT_TITLES, defaultGroupRanking, eventTitleIn, isRankingEvent, isRankingFormatName,
  sportTitles, tiebreakerLabel,
  titlePlacingFor, type EventTitle, type GroupRanking, type SportTitles, type SportTitlesConfig, type StandingsRule, type StandingsScheme,
  type TitlePlacing,
} from '@semp/shared';
import { api } from '../lib/api';
import { useApi, useApiMutation } from '../lib/hooks';
import { useEventPlan } from '../lib/eventPlan';
import { MatchPointsFields, TiebreakerPicker } from './TiebreakerPicker';
import { Checkbox, cn, toast } from './ui';
import { PickList } from './PickList';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, FIELD_LABEL, NUM_INPUT, TAG } from './formStyles';
import { useUrlState } from './primitives';

// Scoring-rules editor (organiser-only). Lets the host set the championship default
// scheme and optionally override it per format or per discipline. Saving recomputes
// standings server-side; we refresh all queries so the Standings tab reflects it.

interface RuleRow { id: string; scope_type: 'championship' | 'format' | 'discipline'; scope_id: string | null; config: StandingsRule }
interface ScopeOption { id: string; name: string; sport?: string | null; sport_id?: string | null; entry_type?: string | null; format?: string | null; default_ranking?: GroupRanking }
interface SportOption { id: string; name: string; titles: SportTitlesConfig | null }
interface RulesResponse { default: StandingsRule; rules: RuleRow[]; formats: ScopeOption[]; disciplines: ScopeOption[]; sports: SportOption[] }

type PlacementRule = Extract<StandingsRule, { scheme: 'placement' }>;

// What the organiser picks. "both" is a placement rule that also counts match points.
type Choice = 'placement' | 'both' | 'league_points' | 'custom' | 'ranking' | 'medal';
const CHOICES: { value: Choice; label: string }[] = [
  { value: 'placement', label: 'Placings (1st, 2nd, 3rd...)' },
  { value: 'both', label: 'Placings + match points' },
  { value: 'league_points', label: 'Match points only (W/D/L)' },
  { value: 'custom', label: 'Custom points (entered per match)' },
  { value: 'ranking', label: 'Event ranking (swimming, powerlifting)' },
];
// Which point systems this event's plan does NOT include. Placings and event
// ranking are the defaults every plan has; the rest are plan capabilities.
const LockedChoices = createContext<(c: Choice) => boolean>(() => false);

const choiceOf = (r: StandingsRule): Choice => (r.scheme === 'placement' && r.include_match_points ? 'both' : r.scheme);

const PLACEMENT_DEFAULT: PlacementRule = {
  scheme: 'placement', points: { winner: 7, runner_up: 5, third_place: 0, fourth_place: 0, semi_finalist: 3, quarter_finalist: 1 },
  participation: 0, table_placings: true,
};
function ruleForChoice(choice: Choice, prev: StandingsRule): StandingsRule {
  const participation = prev.participation;
  const placement = prev.scheme === 'placement' ? prev : PLACEMENT_DEFAULT;
  switch (choice) {
    case 'placement': return { ...placement, participation, include_match_points: false };
    case 'both': return { ...placement, participation, include_match_points: true };
    case 'league_points': return { ...DEFAULT_STANDINGS_RULE, participation } as StandingsRule;
    case 'custom': return { scheme: 'custom', participation };
    case 'ranking': return { scheme: 'ranking', places: [5, 3, 1], participation };
    case 'medal': return { scheme: 'medal', gold: 5, silver: 3, bronze: 1, participation };
  }
}

const SCHEME_LABEL: Record<StandingsScheme, string> = {
  league_points: 'Match points (W/D/L)',
  placement: 'Placings',
  medal: 'Medals (top 3)',
  custom: 'Custom points',
  ranking: 'Event ranking',
};

// 1 -> "1st", 2 -> "2nd", … for the ranking place labels.
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

const PLACEMENT_KEYS = ['winner', 'runner_up', 'third_place', 'fourth_place', 'semi_finalist', 'quarter_finalist'] as const;
const PLACEMENT_LABEL: Record<(typeof PLACEMENT_KEYS)[number], string> = {
  winner: 'Winner', runner_up: 'Runner-up', third_place: '3rd place', fourth_place: '4th place',
  semi_finalist: 'Semi-finalist', quarter_finalist: 'Quarter-finalist',
};

// Swimming, powerlifting, athletics: no matches, so only event ranking or custom points apply.
// A format row has no sport, so a format named like "Rankings" counts too.
const RANKING_ONLY: Choice[] = ['ranking', 'custom'];
const isRankingRow = (option?: ScopeOption) =>
  option?.sport ? isRankingEvent(option.sport, option.format) : isRankingFormatName(option?.name);
/** The rule a ranking row starts from: what it inherits, unless that can't apply to it. */
const startingRule = (rule: StandingsRule, option?: ScopeOption): StandingsRule =>
  isRankingRow(option) && !RANKING_ONLY.includes(choiceOf(rule)) ? ruleForChoice('ranking', rule) : rule;

// A league / round-robin style format, where placings can only come from the table.
const isTableFormat = (format?: string | null) => !!format && /league|round[\s-]?robin|group|pool|swiss/i.test(format);
// A pure league / round robin: no knockout, so no semi-finals or quarter-finals to pay.
const isPureLeagueFormat = (format?: string | null) =>
  !!format && /league|round[\s-]?robin|swiss/i.test(format) && !/knockout|group|pool|final/i.test(format);
const KNOCKOUT_ONLY: Array<(typeof PLACEMENT_KEYS)[number]> = ['semi_finalist', 'quarter_finalist'];

// A compact, read-only summary of a saved rule - shown when the editor is frozen.
export function ruleSummary(rule: StandingsRule, sport?: string | null, entryType?: string | null): string {
  const parts: string[] = [rule.scheme === 'placement' && rule.include_match_points ? 'Placings + match points' : SCHEME_LABEL[rule.scheme]];
  if (rule.scheme === 'league_points') parts.push(`Win ${rule.win} · Draw ${rule.draw} · Loss ${rule.loss}`);
  else if (rule.scheme === 'placement') {
    parts.push(PLACEMENT_KEYS.filter((k) => (rule.points[k] ?? 0) > 0).map((k) => `${PLACEMENT_LABEL[k]} ${rule.points[k]}`).join(' · '));
    if (rule.table_placings) parts.push('placings from tables');
    if (rule.rank_semi_losers) parts.push('semi-final losers ranked');
    if (rule.ranking) {
      const r = rule.ranking;
      parts.push(`league / group ${r.win}/${r.draw}/${r.loss}${r.tiebreakers ? `, ${r.tiebreakers.map((t) => tiebreakerLabel(t, sport, entryType)).join(', ')}` : ''}`);
    }
  } else if (rule.scheme === 'medal') parts.push(`Gold ${rule.gold} · Silver ${rule.silver} · Bronze ${rule.bronze}`);
  else if (rule.scheme === 'ranking') {
    parts.push(rule.places.map((p, i) => `${ordinal(i + 1)} ${p}`).join(' · '));
    if (rule.bestPerSide) parts.push('best finisher per institute only');
  }
  if (rule.participation) parts.push(`Participation ${rule.participation}`);
  return parts.join('  ·  ');
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  // Hold the raw text so the field can go EMPTY while editing (a plain number input bound
  // to 0 can never be cleared, and typing in front of it leaves a leading "07"). Strip
  // non-digits + leading zeros on input; normalise back to the number on blur. Sync from
  // `value` only when it actually differs (so our own edits don't clobber an empty field).
  const [text, setText] = useState(String(value));
  useEffect(() => { if (Number(text) !== value) setText(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="block">
      <span className={FIELD_LABEL}>{label}</span>
      <input
        type="text" inputMode="numeric"
        value={text}
        onChange={(e) => {
          const cleaned = e.target.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
          setText(cleaned);
          onChange(cleaned === '' ? 0 : Math.min(999, parseInt(cleaned, 10)));
        }}
        onBlur={() => setText(String(value))}
        className={NUM_INPUT}
      />
    </label>
  );
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div role="button" tabIndex={-1} onClick={() => onChange(!checked)}
      className={cn('flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition',
        checked ? 'border-brand-300 bg-brand-50/60 dark:border-brand-500/40 dark:bg-brand-500/10' : 'border-slate-200 bg-white hover:border-brand-200 dark:border-slate-700 dark:bg-slate-900')}>
      <span className="pt-0.5"><Checkbox checked={checked} onChange={onChange} aria-label={label} /></span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</span>
        {hint && <span className="block text-xs leading-snug text-slate-500 dark:text-slate-400">{hint}</span>}
      </span>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/30">
    <div className="text-sm font-black text-slate-800 dark:text-slate-100">{title}</div>
    {children}
  </div>
);

type TableRanking = NonNullable<PlacementRule['ranking']>;
/** What a rule inherits when it sets no table ranking: its parent's, or each sport's default. */
export interface InheritedRanking { ranking?: TableRanking; from: string }

// Match points and tie-breakers for league / group tables. The default and format rows
// may leave tie-breakers unset so each sport keeps its own order.
function RankingSection({ rule, onChange, option, inherited }: {
  rule: PlacementRule; onChange: (r: StandingsRule) => void; option?: ScopeOption; inherited: InheritedRanking;
}) {
  const sport = option?.sport ?? null;
  const entryType = option?.entry_type ?? null;
  const sportDefault = option?.default_ranking ?? defaultGroupRanking(sport);
  const parent = inherited.ranking;
  const own = rule.ranking;
  const shown = own ?? parent;
  const points = shown ?? sportDefault;
  const order = shown?.tiebreakers ?? sportDefault.tiebreakers;
  const inheritLabel = parent
    ? `Same as ${inherited.from} (${parent.win} / ${parent.draw} / ${parent.loss})`
    : sport ? `${sport} default (${sportDefault.win} / ${sportDefault.draw} / ${sportDefault.loss})` : "Each sport's default (e.g. football 3 / 1 / 0, basketball 2 / 1 / 0)";
  return (
    <Section title="League / group match points">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Points per league or group match: they order the tables{rule.include_match_points ? ' and are added to the overall table' : ''}. Configure stages can still set them per stage.
      </p>
      <PickList className="max-w-md" value={own ? 'own' : 'inherit'} ariaLabel="Match points"
        onChange={(v) => onChange({ ...rule, ranking: v === 'own' ? { win: points.win, draw: points.draw, loss: points.loss, ...(sport ? { tiebreakers: order } : {}) } : undefined })}
        options={[{ value: 'inherit', label: inheritLabel }, { value: 'own', label: 'Set my own' }]} />
      {own && (
        <>
          <MatchPointsFields value={own} onChange={(p) => onChange({ ...rule, ranking: { ...own, ...p } })} />
          {sport ? (
            <TiebreakerPicker sport={sport} entryType={entryType} value={order} onChange={(t) => onChange({ ...rule, ranking: { ...own, tiebreakers: t } })} />
          ) : (
            <>
              <Check checked={!!own.tiebreakers} onChange={(v) => onChange({ ...rule, ranking: { ...own, tiebreakers: v ? order : undefined } })}
                label="Also set the tie-breaker order"
                hint="Off: each sport keeps its own order (e.g. goal difference in football, run difference in cricket)." />
              {own.tiebreakers && <TiebreakerPicker value={own.tiebreakers} onChange={(t) => onChange({ ...rule, ranking: { ...own, tiebreakers: t } })} />}
            </>
          )}
        </>
      )}
      {!own && sport && <p className="text-xs text-slate-400 dark:text-slate-500">Tie-breakers: {order.map((t) => tiebreakerLabel(t, sport, entryType)).join(', ')}.</p>}
    </Section>
  );
}

// One editable rule: the point-system choice and its fields. `option` is set for a
// format / discipline row, so the form can speak to that sport and format.
function RuleForm({ value, onChange, option, inherited }: {
  value: StandingsRule; onChange: (r: StandingsRule) => void; option?: ScopeOption; inherited: InheritedRanking;
}) {
  const choice = choiceOf(value);
  const isLocked = useContext(LockedChoices);
  const rankingRow = isRankingRow(option);
  // A rule saved earlier that can't apply here stays listed, marked, until it's changed.
  const choices = rankingRow
    ? [...CHOICES.filter((c) => RANKING_ONLY.includes(c.value)),
      ...(RANKING_ONLY.includes(choice) ? [] : [{ value: choice, label: `${CHOICES.find((c) => c.value === choice)?.label ?? 'Medals (legacy)'} - doesn't apply to this sport` }])]
    : choice === 'medal' ? [...CHOICES, { value: 'medal' as const, label: 'Medals (legacy)' }] : CHOICES;
  const rowFormat = option?.format ?? (option?.sport ? null : option?.name);
  const tableFormat = isTableFormat(rowFormat);
  // League / round-robin rows hide what only a knockout can pay; the default shows everything.
  const pureLeague = isPureLeagueFormat(rowFormat);
  const discipline = !!option?.sport;
  return (
    <div className="space-y-3">
      <div>
        <span className={FIELD_LABEL}>What counts toward the overall table</span>
        <PickList className="max-w-md" value={choice} ariaLabel="What counts toward the overall table"
          onChange={(v) => onChange(ruleForChoice(v as Choice, value))}
          options={choices.map((s) => {
            // The current choice stays selectable so an existing rule still renders.
            const locked = isLocked(s.value) && s.value !== choice;
            return { value: s.value, label: s.label, disabled: locked, hint: locked ? 'Not on this plan' : undefined };
          })} />
      </div>

      {value.scheme === 'placement' && (
        <>
          <div className="flex flex-wrap items-end gap-4">
            {PLACEMENT_KEYS.filter((k) => !pureLeague || !KNOCKOUT_ONLY.includes(k)).map((k) => (
              <NumberField key={k} label={PLACEMENT_LABEL[k]} value={value.points[k] ?? 0}
                onChange={(n) => onChange({ ...value, points: { ...value.points, [k]: n } })} />
            ))}
            <NumberField label="Participation" value={value.participation} onChange={(n) => onChange({ ...value, participation: n })} />
          </div>
          <div className="space-y-2">
            <Check checked={!!value.table_placings} onChange={(v) => onChange({ ...value, table_placings: v })}
              label="Placings from league / group tables"
              hint="When the league or groups finish, places no knockout match decides come from the table (e.g. 3rd and 4th when only a final is played)." />
            {!pureLeague && (
              <Check checked={!!value.rank_semi_losers} onChange={(v) => onChange({ ...value, rank_semi_losers: v })}
                label="No 3rd-place match: rank the semi-final losers by group record"
                hint="The better group record takes 3rd. Level records are ordered by hand on the group table." />
            )}
          </div>
          {tableFormat && !value.table_placings && (
            <p className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              This is a {option?.format ?? option?.name} draw. Without placings from the table, {value.include_match_points ? 'its teams earn no placing points, only their match points and participation.' : 'its teams earn only the participation point.'}
            </p>
          )}
          <RankingSection rule={value} onChange={onChange} option={option} inherited={inherited} />
        </>
      )}

      {value.scheme === 'league_points' && (
        <>
          <MatchPointsFields value={value} onChange={(p) => onChange({ ...value, ...p })} />
          <span className={FIELD_LABEL}>Tie-breakers, in order</span>
          <TiebreakerPicker sport={option?.sport} entryType={option?.entry_type} value={value.tiebreakers} onChange={(t) => onChange({ ...value, tiebreakers: t })} />
          {!discipline && (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {option ? 'Shown with general names here; each discipline reads them in its own terms (goal difference, game difference...).' : 'These also order the overall table when two totals are level.'}
            </p>
          )}
          <NumberField label="Participation" value={value.participation} onChange={(n) => onChange({ ...value, participation: n })} />
        </>
      )}

      {value.scheme === 'medal' && (
        <div className="flex flex-wrap items-end gap-4">
          <NumberField label="Gold" value={value.gold} onChange={(n) => onChange({ ...value, gold: n })} />
          <NumberField label="Silver" value={value.silver} onChange={(n) => onChange({ ...value, silver: n })} />
          <NumberField label="Bronze" value={value.bronze} onChange={(n) => onChange({ ...value, bronze: n })} />
          <NumberField label="Participation" value={value.participation} onChange={(n) => onChange({ ...value, participation: n })} />
        </div>
      )}

      {value.scheme === 'custom' && (
        <NumberField label="Participation" value={value.participation} onChange={(n) => onChange({ ...value, participation: n })} />
      )}

      {value.scheme === 'ranking' && (
        <>
          <div className="flex flex-wrap items-end gap-4">
            {value.places.map((p, i) => (
              <NumberField key={i} label={ordinal(i + 1)} value={p}
                onChange={(n) => onChange({ ...value, places: value.places.map((x, j) => (j === i ? n : x)) })} />
            ))}
            <NumberField label="Participation" value={value.participation} onChange={(n) => onChange({ ...value, participation: n })} />
          </div>
          <div className="flex gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => onChange({ ...value, places: [...value.places, 0] })}><Plus size={14} aria-hidden />Add place</button>
            {value.places.length > 1 && (
              <button type="button" className={BTN_GHOST} onClick={() => onChange({ ...value, places: value.places.slice(0, -1) })}><Minus size={14} aria-hidden />Remove last</button>
            )}
          </div>
          <Check checked={!!value.bestPerSide}
            onChange={(v) => onChange({ ...value, bestPerSide: v || undefined })}
            label="Only each institute's best finisher scores"
            hint="How many an institute may enter is the discipline's squad size. Off: every finisher takes a place, so one institute can be 1st and 2nd. On: its other finishers are passed over and the next institute moves up." />
        </>
      )}

      <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
        {value.scheme === 'custom'
          ? 'Custom points: award championship points to each side after every result, from the Results page. A reminder is sent while a completed match still has no points.'
          : value.scheme === 'ranking'
            ? "Event points are awarded by finishing place once the official saves and signs off the event ranking. Places beyond the list score only the participation point. To turn a sport's event points into titles (e.g. Men's and Women's), use Sport titles at the bottom of this card."
            : value.scheme === 'league_points'
              ? 'Every match adds its win / draw / loss points to the overall table as soon as it is played.'
              : pureLeague
                ? 'Placings come from the final league table once every match is played. A placing worth 0 counts as no placing. Participation goes to teams with no placing; a team that only lost walkovers gets nothing.'
                : 'Placing points build up as teams advance (reaching the semis banks the semi-finalist points) and settle when the final is played. A placing worth 0 counts as no placing. Participation goes to teams with no placing; a team that only lost walkovers gets nothing.'}
      </p>
    </div>
  );
}

// The championship-wide default rule. Frozen (read-only summary) once a rule has
// been saved; "Edit" re-opens the editor.
function DefaultRuleEditor({ eventId, initial, saved }: { eventId: string; initial: StandingsRule; saved: boolean }) {
  const [rule, setRule] = useState<StandingsRule>(initial);
  const [frozen, setFrozen] = useState(saved);
  const save = useApiMutation(
    (config: StandingsRule) => api('PUT', `/championships/${eventId}/standings-rules`, { scope_type: 'championship', config }),
    [], // recompute touches every scope - refresh all queries
  );
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-black text-slate-900 dark:text-slate-100">Championship default</span>
        <span className={cn(TAG, 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>Applies unless overridden</span>
        {!saved && <span className={cn(TAG, 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300')}>Built-in, not saved</span>}
      </div>
      {!saved && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          No point system is saved yet, so every match counts {initial.scheme === 'league_points' ? `${initial.win} / ${initial.draw} / ${initial.loss}` : 'as below'} toward the overall table. Pick and save the system this event uses.
        </p>
      )}
      {frozen ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/40">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{ruleSummary(rule)}</p>
          <button type="button" className={BTN_SECONDARY} onClick={() => setFrozen(false)}><Pencil size={13} aria-hidden />Edit</button>
        </div>
      ) : (
        <>
          <RuleForm value={rule} onChange={setRule} inherited={{ from: "each sport's default" }} />
          <div className="mt-4 flex justify-end border-t border-slate-100 pt-3 dark:border-slate-800">
            <button type="button" className={BTN_PRIMARY} disabled={save.isPending}
              onClick={() => save.mutate(rule, { onSuccess: () => { toast.success('Point system saved'); setFrozen(true); }, onError: (e: any) => toast.error(e.message) })}>
              {save.isPending ? 'Saving…' : 'Save point system'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// A per-format / per-discipline override that inherits the default until customized.
function ScopeRuleEditor({ eventId, scopeType, option, override, fallback, inherited }: {
  eventId: string; scopeType: 'format' | 'discipline'; option: ScopeOption; override?: RuleRow; fallback: StandingsRule; inherited: InheritedRanking;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  // What the form starts from, read fresh: a reset override or a changed default must show.
  const current = () => override?.config ?? startingRule(fallback, option);
  const [rule, setRule] = useState<StandingsRule>(current);
  const openForm = (edit: boolean) => { setRule(current()); if (edit) setEditing(true); else setOpen(true); };
  // Close the form and drop unsaved edits.
  const cancel = () => { setRule(current()); setEditing(false); setOpen(false); };
  const save = useApiMutation(
    (config: StandingsRule) => api('PUT', `/championships/${eventId}/standings-rules`, { scope_type: scopeType, scope_id: option.id, config }),
    [],
  );
  const reset = useApiMutation(
    () => api('DELETE', `/championships/${eventId}/standings-rules/${override!.id}`),
    [],
  );

  // A saved override shows as a frozen summary until "Edit"; an unsaved scope
  // stays collapsed behind "Customize".
  const frozen = !!override && !editing;
  const showForm = editing || (!override && open);
  return (
    <div className={cn('rounded-2xl border bg-white p-4 dark:bg-slate-900', override ? 'border-brand-200 dark:border-brand-500/30' : 'border-slate-200 dark:border-slate-800')}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-black text-slate-900 dark:text-slate-100">
              {option.sport ? `${option.sport} · ${option.name}` : option.name}
            </span>
            {override
              ? <span className={cn(TAG, 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200')}>Custom</span>
              : <span className={cn(TAG, 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400')}>Follows the default</span>}
          </div>
          {(option.entry_type || option.format) && (
            <div className="mt-0.5 text-xs capitalize text-slate-400 dark:text-slate-500">
              {[option.entry_type, option.format].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {frozen && (
            <button type="button" className={BTN_SECONDARY} onClick={() => openForm(true)} aria-label={`Edit ${option.name} rules`}><Pencil size={13} aria-hidden />Edit</button>
          )}
          {!override && !open && <button type="button" className={BTN_SECONDARY} onClick={() => openForm(false)}><Settings2 size={13} aria-hidden />Customize</button>}
        </div>
      </div>

      {frozen && <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 dark:bg-slate-800/40 dark:text-slate-200">{ruleSummary(override!.config, option.sport, option.entry_type)}</p>}

      {showForm && (
        <div className="mt-3">
          <RuleForm value={rule} onChange={setRule} option={option} inherited={inherited} />
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            {override && (
              <button type="button" className={cn(BTN_GHOST, 'mr-auto hover:!bg-rose-50 hover:!text-rose-600')} disabled={reset.isPending}
                onClick={() => reset.mutate(undefined, { onSuccess: () => { toast.success('Back to the default'); setEditing(false); setOpen(false); }, onError: (e: any) => toast.error(e.message) })}>
                <RotateCcw size={13} aria-hidden />{reset.isPending ? 'Removing…' : 'Reset to default'}
              </button>
            )}
            <button type="button" className={BTN_GHOST} onClick={cancel}>Cancel</button>
            <button type="button" className={BTN_PRIMARY} disabled={save.isPending}
              onClick={() => save.mutate(rule, { onSuccess: () => { toast.success('Saved'); setEditing(false); setOpen(false); }, onError: (e: any) => toast.error(e.message) })}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

type RulesShape = { default: StandingsRule; rules: Array<{ scope_type: string; scope_id: string | null; config: StandingsRule }>; formats: Array<{ id: string; name: string }> };

/** A discipline's rule as the engine resolves it: its own, then its format's, then the championship default. */
export function resolvedDisciplineRule(data: RulesShape, d: { id: string; sport?: string | null; format?: string | null }): StandingsRule {
  const own = data.rules.find((r) => r.scope_type === 'discipline' && r.scope_id === d.id)?.config;
  // A ranking event takes only its own rule (as the engine does), else the 5/3/1 default.
  if (isRankingEvent(d.sport, d.format)) return own ?? DEFAULT_RANKING_RULE;
  const fmt = data.formats.find((f) => f.name === d.format);
  const byFormat = fmt ? data.rules.find((r) => r.scope_type === 'format' && r.scope_id === fmt.id)?.config : undefined;
  return own ?? byFormat ?? data.rules.find((r) => r.scope_type === 'championship')?.config ?? data.default;
}

type DisciplineShape = { id: string; name: string; sport?: string | null; sport_id?: string | null; format?: string | null };

/** Each event sport's ranking events, grouped by sport (only events scored by event ranking). */
export function rankingEventsBySport(data: RulesShape & { disciplines: DisciplineShape[] }) {
  const out = new Map<string, { sport: string; events: Array<{ id: string; name: string }> }>();
  for (const d of data.disciplines) {
    if (!d.sport_id || resolvedDisciplineRule(data, d).scheme !== 'ranking') continue;
    const entry = out.get(d.sport_id) ?? { sport: d.sport ?? '', events: [] };
    out.set(d.sport_id, entry);
    entry.events.push({ id: d.id, name: d.name });
  }
  return out;
}

/** The titles of every sport that has them switched on. */
export function sportTitlesFor(data: RulesShape & { disciplines: DisciplineShape[]; sports: Array<{ id: string; titles: SportTitlesConfig | null }> }): SportTitles[] {
  const events = [...rankingEventsBySport(data)].flatMap(([sportId, s]) => s.events.map((e) => ({ ...e, sport: s.sport, sportId })));
  return sportTitles(events, (id) => data.sports.find((s) => s.id === id)?.titles);
}

const placingText = (p: TitlePlacing) => `${p.places.join('/')}${p.participation ? `, others ${p.participation}` : ''}`;

/** "Men's (5 events, pays 10/7/4) + Women's (...)"; a whole-sport title beside gender titles names its events. */
export function titlesLine(s: SportTitles, config: SportTitlesConfig | null | undefined): string {
  return s.titles.map((t) => {
    const events = s.mixed && t.group === 'overall' ? t.events.join(', ') : plural(t.events.length, 'event');
    return `${t.label} (${events}, pays ${placingText(titlePlacingFor(config, t.name))})`;
  }).join(' + ');
}

// Not blocked: a separate whole-sport title can be intended, but is usually an event left behind.
function MixedTitlesWarning({ titles }: { titles: SportTitles }) {
  const whole = titles.titles.find((t) => t.group === 'overall')!;
  const one = whole.events.length === 1;
  return (
    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
      <span className="font-semibold">{titles.sport} will have {plural(titles.titles.length, 'title')}.</span>
      {' '}The Whole sport title is decided by {whole.events.join(', ')} alone.
      {' '}If {one ? 'it belongs' : 'they belong'} to the Men's or Women's competition, change {one ? 'its' : 'their'} title above.
    </p>
  );
}

const EMPTY_TITLES: SportTitlesConfig = { enabled: false, events: {}, titles: {} };

// One event sport's titles, all in one place: on/off, which title each event counts
// toward (Whole sport unless changed), and what each title pays the overall table.
function SportTitlesEditor({ eventId, sport, sportId, events, saved }: {
  eventId: string; sport: string; sportId: string; events: Array<{ id: string; name: string }>; saved: SportTitlesConfig | null;
}) {
  const [draft, setDraft] = useState<SportTitlesConfig>(saved ?? EMPTY_TITLES);
  useEffect(() => setDraft(saved ?? EMPTY_TITLES), [JSON.stringify(saved)]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useApiMutation((body: SportTitlesConfig) => api('PUT', `/championships/${eventId}/sport-titles/${sportId}`, body), []);
  const [summary] = sportTitles(events.map((e) => ({ ...e, sport, sportId })), () => ({ ...draft, enabled: true }));
  const placing = (name: string) => titlePlacingFor(draft, name);
  const setTitle = (name: string, p: Partial<TitlePlacing>) =>
    setDraft((d) => ({ ...d, titles: { ...d.titles, [name]: { ...titlePlacingFor(d, name), ...p } } }));
  const setEvent = (id: string, title: EventTitle) => setDraft((d) => ({ ...d, events: { ...d.events, [id]: title } }));
  // Only what matters is saved: each event's choice and the titles in use.
  const body = (): SportTitlesConfig => ({
    enabled: draft.enabled,
    events: Object.fromEntries(events.map((e) => [e.id, eventTitleIn(draft, e.id)])),
    titles: Object.fromEntries((summary?.titles ?? []).map((t) => [t.name, placing(t.name)])),
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved ?? EMPTY_TITLES);
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-black text-slate-900 dark:text-slate-100">{sport}</span>
        <span className={cn(TAG, draft.enabled ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400')}>{draft.enabled ? 'Titles on' : 'Event points only'}</span>
        {dirty && <span className={cn(TAG, 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300')}>Not saved</span>}
      </div>
      <Check checked={draft.enabled} onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
        label="Convert event points into sport titles"
        hint="Off: each event's points go straight to the overall table. On: events are added up per title, ranked, and each title pays its placing points instead." />
      {draft.enabled && summary && (
        <>
          <div className="space-y-1.5">
            <div className={FIELD_LABEL}>Which title each event counts toward</div>
            {events.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-800/30">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{e.name}</span>
                <PickList className="w-full sm:w-56" value={eventTitleIn(draft, e.id)} onChange={(v) => setEvent(e.id, v as EventTitle)} ariaLabel={`Title for ${e.name}`}
                  options={EVENT_TITLES.map((tt) => ({ value: tt, label: EVENT_TITLE_LABEL[tt] }))} />
              </div>
            ))}
          </div>
          {summary.mixed && <MixedTitlesWarning titles={summary} />}
          {summary.titles.map((t) => {
            const p = placing(t.name);
            return (
              <div key={t.group} className="space-y-2">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-black text-slate-800 dark:text-slate-100">{t.label} title pays</span> · {plural(t.events.length, 'event')}
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  {p.places.map((v, i) => (
                    <NumberField key={i} label={ordinal(i + 1)} value={v} onChange={(n) => setTitle(t.name, { places: p.places.map((x, j) => (j === i ? n : x)) })} />
                  ))}
                  <NumberField label="Others" value={p.participation} onChange={(n) => setTitle(t.name, { participation: n })} />
                  <button type="button" className={BTN_SECONDARY} onClick={() => setTitle(t.name, { places: [...p.places, 0] })}><Plus size={14} aria-hidden />Add place</button>
                  {p.places.length > 1 && <button type="button" className={BTN_GHOST} onClick={() => setTitle(t.name, { places: p.places.slice(0, -1) })}><Minus size={14} aria-hidden />Remove last</button>}
                </div>
              </div>
            );
          })}
          <p className="text-xs text-slate-400 dark:text-slate-500">Level totals are split by more golds, then more silvers; still level, they share the better place.</p>
        </>
      )}
      <div className="flex justify-end border-t border-slate-100 pt-3 dark:border-slate-800">
        <button type="button" className={BTN_PRIMARY} disabled={save.isPending || !dirty} title={!dirty ? 'Nothing to save' : undefined}
          onClick={() => save.mutate(body(), { onSuccess: () => toast.success(`${sport} titles saved`), onError: (e: any) => toast.error(e.message) })}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export type RulesSection = 'default' | 'format' | 'discipline' | 'titles';

export function StandingsRulesCard({ eventId, section: controlled }: {
  eventId: string;
  /** Set by a page that has its own navigation: show just this section, no header or tabs. */
  section?: RulesSection;
}) {
  const plan = useEventPlan(eventId);
  // One section at a time: the default, then overrides by format or discipline, then titles.
  const [ownSection, setSection] = useUrlState<string>('points', 'default');
  const section = controlled ?? ownSection;
  const lockedChoice = (c: Choice) =>
    (c === 'custom' && !plan.has('custom_points'))
    || ((c === 'both' || c === 'league_points' || c === 'medal') && !plan.has('standard_points'));
  const { data, isLoading } = useApi<RulesResponse>(`/championships/${eventId}/standings-rules`);

  if (isLoading || !data) {
    return <div aria-label="Loading" className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />;
  }

  const championshipRule = data.rules.find((r) => r.scope_type === 'championship');
  const defaultRule = championshipRule?.config ?? data.default;
  const findOverride = (type: 'format' | 'discipline', id: string) => data.rules.find((r) => r.scope_type === type && r.scope_id === id);
  const rankingOf = (r?: StandingsRule) => (r?.scheme === 'placement' ? r.ranking : undefined);
  const defaultInherited: InheritedRanking = { ranking: rankingOf(defaultRule), from: 'the championship default' };
  // A discipline sits under its format's override when there is one, as the engine resolves it.
  const parentOf = (d: ScopeOption) => {
    if (isRankingEvent(d.sport, d.format)) return { rule: DEFAULT_RANKING_RULE, inherited: defaultInherited };
    const fmt = data.formats.find((f) => f.name === d.format);
    const fmtRule = fmt ? findOverride('format', fmt.id)?.config : undefined;
    const fmtRanking = rankingOf(fmtRule);
    return {
      rule: fmtRule ?? defaultRule,
      inherited: fmtRanking ? { ranking: fmtRanking, from: `the ${fmt!.name} format` } : defaultInherited,
    };
  };

  const eventSports = [...rankingEventsBySport(data)];
  // A Rankings format has nothing to set: its events take their own rule, titles are per sport.
  const matchFormats = data.formats.filter((f) => !isRankingFormatName(f.name));

  const formatOverrides = matchFormats.filter((f) => findOverride('format', f.id)).length;
  const disciplineOverrides = data.disciplines.filter((d) => findOverride('discipline', d.id)).length;
  const tabs: Array<{ value: RulesSection; label: string; count?: string }> = [
    { value: 'default', label: 'Default' },
    ...(matchFormats.length ? [{ value: 'format' as const, label: 'By format', count: formatOverrides ? `${formatOverrides} custom` : undefined }] : []),
    ...(data.disciplines.length ? [{ value: 'discipline' as const, label: 'By discipline', count: disciplineOverrides ? `${disciplineOverrides} custom` : undefined }] : []),
    ...(eventSports.length ? [{ value: 'titles' as const, label: 'Sport titles' }] : []),
  ];
  const active: RulesSection = controlled ?? (tabs.some((x) => x.value === section) ? section as RulesSection : 'default');
  const intro: Record<RulesSection, string> = {
    default: 'Applies to every match unless a format or discipline sets its own.',
    format: 'Give a whole format (e.g. Knockout) its own points. Its disciplines follow it unless they override too.',
    discipline: 'Give one discipline its own points, on top of its format and the default.',
    titles: 'For sports scored by event ranking: which title each event counts toward, and what each title pays.',
  };

  const body = (
    <div className={cn('space-y-2', !controlled && 'p-4')}>
      {active === 'default' && <DefaultRuleEditor key={JSON.stringify(defaultRule)} eventId={eventId} initial={defaultRule} saved={!!championshipRule} />}
      {active === 'format' && matchFormats.map((f) => (
        <ScopeRuleEditor key={f.id} eventId={eventId} scopeType="format" option={f} override={findOverride('format', f.id)} fallback={defaultRule} inherited={defaultInherited} />
      ))}
      {active === 'discipline' && data.disciplines.map((d) => (
        <ScopeRuleEditor key={d.id} eventId={eventId} scopeType="discipline" option={d} override={findOverride('discipline', d.id)} fallback={parentOf(d).rule} inherited={parentOf(d).inherited} />
      ))}
      {active === 'titles' && eventSports.map(([sportId, s]) => (
        <SportTitlesEditor key={sportId} eventId={eventId} sport={s.sport} sportId={sportId} events={s.events} saved={data.sports.find((x) => x.id === sportId)?.titles ?? null} />
      ))}
      {((active === 'format' && !matchFormats.length) || (active === 'discipline' && !data.disciplines.length)) && (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400 dark:border-slate-700">Nothing to set here yet - add disciplines in Setup first.</p>
      )}
    </div>
  );
  if (controlled) return <LockedChoices.Provider value={lockedChoice}>{body}</LockedChoices.Provider>;

  return (
    <LockedChoices.Provider value={lockedChoice}>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-600 dark:text-slate-300">{intro[active]}</p>
        </div>
        {tabs.length > 1 && (
          <div role="tablist" className="no-scrollbar -mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
            {tabs.map((x) => (
              <button key={x.value} type="button" role="tab" aria-selected={active === x.value} onClick={() => setSection(x.value)}
                className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
                  active === x.value ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')}>
                {x.label}
                {x.count && <span className={cn('rounded-full px-1.5 text-[10px] font-bold', active === x.value ? 'bg-white/20' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300')}>{x.count}</span>}
              </button>
            ))}
          </div>
        )}
      </header>
      {body}
    </section>
    </LockedChoices.Provider>
  );
}
