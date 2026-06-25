import { useEffect, useState } from 'react';
import { DEFAULT_STANDINGS_RULE, type StandingsRule, type StandingsScheme } from '@semp/shared';
import { api } from '../lib/api';
import { useApi, useApiMutation } from '../lib/hooks';
import { Badge, Button, Card, CardBody, CardHeader, Select, Spinner, toast } from './ui';

// Scoring-rules editor (organiser-only). Lets the host set the championship default
// scheme and optionally override it per format or per discipline. Saving recomputes
// standings server-side; we refresh all queries so the Standings tab reflects it.

interface RuleRow { id: string; scope_type: 'championship' | 'format' | 'discipline'; scope_id: string | null; config: StandingsRule }
interface ScopeOption { id: string; name: string; sport?: string | null; entry_type?: string | null; format?: string | null }
interface RulesResponse { default: StandingsRule; rules: RuleRow[]; formats: ScopeOption[]; disciplines: ScopeOption[] }

const SCHEME_LABEL: Record<StandingsScheme, string> = {
  league_points: 'League points (W/D/L)',
  placement: 'Knockout',
  medal: 'Medals (top 3)',
  custom: 'Custom points',
  ranking: 'Ranking (by place)',
};

const SCHEME_DEFAULTS: Record<StandingsScheme, StandingsRule> = {
  league_points: DEFAULT_STANDINGS_RULE,
  placement: { scheme: 'placement', points: { winner: 7, runner_up: 5, semi_finalist: 3, quarter_finalist: 1 }, participation: 0 },
  medal: { scheme: 'medal', gold: 5, silver: 3, bronze: 1, participation: 0 },
  custom: { scheme: 'custom', participation: 0 },
  ranking: { scheme: 'ranking', places: [5, 3, 1], participation: 0 },
};

// Organisers pick one of these point systems. Legacy league/medal rules still compute,
// but the picker only offers these - and editing coerces anything else to Knockout so the
// dropdown always shows a supported option. "Ranking" is for the ranking sports
// (swimming/powerlifting/athletics) - best set per format/discipline, not as the
// championship default (it gives head-to-head sports no points).
const POINT_SYSTEM_OPTIONS: { value: StandingsScheme; label: string }[] = [
  { value: 'placement', label: 'Knockout' },
  { value: 'custom', label: 'Custom points' },
  { value: 'ranking', label: 'Ranking (by place)' },
];
const coerceScheme = (r: StandingsRule): StandingsRule =>
  r.scheme === 'placement' || r.scheme === 'custom' || r.scheme === 'ranking' ? r : SCHEME_DEFAULTS.placement;

// 1 -> "1st", 2 -> "2nd", … for the ranking place labels.
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

const PLACEMENT_KEYS = ['winner', 'runner_up', 'semi_finalist', 'quarter_finalist'] as const;
const PLACEMENT_LABEL: Record<(typeof PLACEMENT_KEYS)[number], string> = {
  winner: 'Winner', runner_up: 'Runner-up', semi_finalist: 'Semi-finalist', quarter_finalist: 'Quarter-finalist',
};

// A compact, read-only summary of a saved rule - shown when the editor is frozen.
function ruleSummary(rule: StandingsRule): string {
  const parts: string[] = [SCHEME_LABEL[rule.scheme]];
  if (rule.scheme === 'league_points') parts.push(`Win ${rule.win} · Draw ${rule.draw} · Loss ${rule.loss}`);
  else if (rule.scheme === 'placement') parts.push(PLACEMENT_KEYS.map((k) => `${PLACEMENT_LABEL[k]} ${rule.points[k] ?? 0}`).join(' · '));
  else if (rule.scheme === 'medal') parts.push(`Gold ${rule.gold} · Silver ${rule.silver} · Bronze ${rule.bronze}`);
  else if (rule.scheme === 'ranking') parts.push(rule.places.map((p, i) => `${ordinal(i + 1)} ${p}`).join(' · '));
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
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</span>
      <input
        type="text" inputMode="numeric"
        value={text}
        onChange={(e) => {
          const cleaned = e.target.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
          setText(cleaned);
          onChange(cleaned === '' ? 0 : Math.min(999, parseInt(cleaned, 10)));
        }}
        onBlur={() => setText(String(value))}
        className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      />
    </label>
  );
}

// One editable rule (point-system picker + scheme-specific point fields). The picker
// offers two options: Knockout (placement points) and Custom points (entered per
// match). `value` is always coerced to one of these before it reaches here.
function RuleForm({ value, onChange }: { value: StandingsRule; onChange: (r: StandingsRule) => void }) {
  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Point system</span>
        <Select
          className="w-full max-w-xs"
          value={POINT_SYSTEM_OPTIONS.some((o) => o.value === value.scheme) ? value.scheme : 'placement'}
          // Preserve the participation point when switching schemes.
          onChange={(e) => onChange({ ...SCHEME_DEFAULTS[e.target.value as StandingsScheme], participation: value.participation })}
        >
          {POINT_SYSTEM_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
      </label>

      <div className="flex flex-wrap items-end gap-4">
        {value.scheme === 'placement' && PLACEMENT_KEYS.map((k) => (
          <NumberField
            key={k} label={PLACEMENT_LABEL[k]} value={value.points[k] ?? 0}
            onChange={(n) => onChange({ ...value, points: { ...value.points, [k]: n } })}
          />
        ))}
        {value.scheme === 'ranking' && value.places.map((p, i) => (
          <NumberField
            key={i} label={ordinal(i + 1)} value={p}
            onChange={(n) => onChange({ ...value, places: value.places.map((x, j) => (j === i ? n : x)) })}
          />
        ))}
        {/* Awarded to every org that takes part, on top of the scheme above. */}
        <NumberField label="Participation" value={value.participation} onChange={(n) => onChange({ ...value, participation: n })} />
      </div>

      {value.scheme === 'ranking' && (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => onChange({ ...value, places: [...value.places, 0] })}>+ Add place</Button>
          {value.places.length > 1 && (
            <Button size="sm" variant="ghost" onClick={() => onChange({ ...value, places: value.places.slice(0, -1) })}>− Remove last</Button>
          )}
        </div>
      )}

      <p className="text-xs text-slate-400 dark:text-slate-500">
        {value.scheme === 'custom'
          ? 'Custom points: award championship points to each side after every result, from the Results page. A reminder is sent while a completed match still has no points.'
          : value.scheme === 'ranking'
            ? 'Ranking points are awarded by finishing place once the official saves & signs off the event ranking (swimming / powerlifting / athletics). Places beyond the list score only the participation point.'
            : "Knockout points are awarded by how far a team advances, once the discipline's final has been played. Participation counts as soon as an org plays."}
      </p>
    </div>
  );
}

// The championship-wide default rule. Frozen (read-only summary) once a rule has
// been saved; "Edit" re-opens the editor.
function DefaultRuleEditor({ eventId, initial, saved }: { eventId: string; initial: StandingsRule; saved: boolean }) {
  const [rule, setRule] = useState<StandingsRule>(coerceScheme(initial));
  const [frozen, setFrozen] = useState(saved);
  const save = useApiMutation(
    (config: StandingsRule) => api('PUT', `/championships/${eventId}/standings-rules`, { scope_type: 'championship', config }),
    [], // recompute touches every scope - refresh all queries
  );
  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Championship default</span>
        <Badge tone="slate">applies unless overridden</Badge>
      </div>
      {frozen ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">{ruleSummary(rule)}</p>
          <Button variant="outline" onClick={() => setFrozen(false)}>Edit</Button>
        </div>
      ) : (
        <>
          <RuleForm value={rule} onChange={setRule} />
          <div className="mt-3 flex justify-end">
            <Button disabled={save.isPending}
              onClick={() => save.mutate(rule, { onSuccess: () => { toast.success('Point system saved'); setFrozen(true); }, onError: (e: any) => toast.error(e.message) })}>
              {save.isPending ? 'Saving…' : 'Save point system'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// A per-format / per-discipline override that inherits the default until customized.
function ScopeRuleEditor({ eventId, scopeType, option, override, fallback }: {
  eventId: string; scopeType: 'format' | 'discipline'; option: ScopeOption; override?: RuleRow; fallback: StandingsRule;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rule, setRule] = useState<StandingsRule>(coerceScheme(override?.config ?? fallback));
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
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
              {option.sport ? `${option.sport} · ${option.name}` : option.name}
            </span>
            {override ? <Badge tone="brand">override</Badge> : <Badge tone="slate">inherits default</Badge>}
          </div>
          {(option.entry_type || option.format) && (
            <div className="mt-0.5 text-xs capitalize text-slate-400 dark:text-slate-500">
              {[option.entry_type, option.format].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {frozen && <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
          {!override && !open && <Button variant="ghost" onClick={() => setOpen(true)}>Customize</Button>}
        </div>
      </div>

      {frozen && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{ruleSummary(override!.config)}</p>}

      {showForm && (
        <div className="mt-3">
          <RuleForm value={rule} onChange={setRule} />
          <div className="mt-3 flex justify-end gap-2">
            {override && (
              <Button variant="ghost" disabled={reset.isPending}
                onClick={() => reset.mutate(undefined, { onSuccess: () => { toast.success('Override removed'); setEditing(false); setOpen(false); }, onError: (e: any) => toast.error(e.message) })}>
                {reset.isPending ? 'Removing…' : 'Reset to default'}
              </Button>
            )}
            <Button disabled={save.isPending}
              onClick={() => save.mutate(rule, { onSuccess: () => { toast.success('Override saved'); setEditing(false); setOpen(false); }, onError: (e: any) => toast.error(e.message) })}>
              {save.isPending ? 'Saving…' : 'Save override'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function StandingsRulesCard({ eventId }: { eventId: string }) {
  const { data, isLoading } = useApi<RulesResponse>(`/championships/${eventId}/standings-rules`);

  if (isLoading || !data) {
    return (
      <Card><CardHeader title="Point System" /><CardBody><Spinner /></CardBody></Card>
    );
  }

  const championshipRule = data.rules.find((r) => r.scope_type === 'championship');
  const defaultRule = championshipRule?.config ?? data.default;
  const findOverride = (type: 'format' | 'discipline', id: string) => data.rules.find((r) => r.scope_type === type && r.scope_id === id);

  return (
    <Card>
      <CardHeader
        title="Point System"
        subtitle="How completed fixtures become standings points. Set a championship default, then override per format or discipline."
      />
      <CardBody className="space-y-5">
        <DefaultRuleEditor key={JSON.stringify(defaultRule)} eventId={eventId} initial={defaultRule} saved={!!championshipRule} />

        {data.formats.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">By format</h4>
            {data.formats.map((f) => (
              <ScopeRuleEditor key={f.id} eventId={eventId} scopeType="format" option={f} override={findOverride('format', f.id)} fallback={defaultRule} />
            ))}
          </div>
        )}

        {data.disciplines.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">By discipline</h4>
            {data.disciplines.map((d) => (
              <ScopeRuleEditor key={d.id} eventId={eventId} scopeType="discipline" option={d} override={findOverride('discipline', d.id)} fallback={defaultRule} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
