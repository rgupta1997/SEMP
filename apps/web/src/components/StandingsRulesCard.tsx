import { useState } from 'react';
import { DEFAULT_STANDINGS_RULE, STANDINGS_SCHEME, type StandingsRule, type StandingsScheme } from '@semp/shared';
import { api } from '../lib/api';
import { useApi, useApiMutation } from '../lib/hooks';
import { Badge, Button, Card, CardBody, CardHeader, Select, Spinner, toast } from './ui';

// Scoring-rules editor (organiser-only). Lets the host set the championship default
// scheme and optionally override it per format or per discipline. Saving recomputes
// standings server-side; we refresh all queries so the Standings tab reflects it.

interface RuleRow { id: string; scope_type: 'championship' | 'format' | 'discipline'; scope_id: string | null; config: StandingsRule }
interface ScopeOption { id: string; name: string }
interface RulesResponse { default: StandingsRule; rules: RuleRow[]; formats: ScopeOption[]; disciplines: ScopeOption[] }

const SCHEME_LABEL: Record<StandingsScheme, string> = {
  league_points: 'League points (W/D/L)',
  placement: 'Placement (knockout)',
  medal: 'Medals (top 3)',
};

const SCHEME_DEFAULTS: Record<StandingsScheme, StandingsRule> = {
  league_points: DEFAULT_STANDINGS_RULE,
  placement: { scheme: 'placement', points: { winner: 7, runner_up: 5, semi_finalist: 3, quarter_finalist: 1 }, participation: 0 },
  medal: { scheme: 'medal', gold: 5, silver: 3, bronze: 1, participation: 0 },
};

const PLACEMENT_KEYS = ['winner', 'runner_up', 'semi_finalist', 'quarter_finalist'] as const;
const PLACEMENT_LABEL: Record<(typeof PLACEMENT_KEYS)[number], string> = {
  winner: 'Winner', runner_up: 'Runner-up', semi_finalist: 'Semi-finalist', quarter_finalist: 'Quarter-finalist',
};

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</span>
      <input
        type="number" min={0} value={value}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      />
    </label>
  );
}

// One editable rule (scheme picker + scheme-specific point fields).
function RuleForm({ value, onChange }: { value: StandingsRule; onChange: (r: StandingsRule) => void }) {
  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Scheme</span>
        <Select
          className="w-full max-w-xs"
          value={value.scheme}
          // Preserve the participation point when switching schemes.
          onChange={(e) => onChange({ ...SCHEME_DEFAULTS[e.target.value as StandingsScheme], participation: value.participation })}
        >
          {STANDINGS_SCHEME.map((s) => <option key={s} value={s}>{SCHEME_LABEL[s]}</option>)}
        </Select>
      </label>

      <div className="flex flex-wrap gap-4">
        {value.scheme === 'league_points' && (
          <>
            <NumberField label="Win" value={value.win} onChange={(n) => onChange({ ...value, win: n })} />
            <NumberField label="Draw" value={value.draw} onChange={(n) => onChange({ ...value, draw: n })} />
            <NumberField label="Loss" value={value.loss} onChange={(n) => onChange({ ...value, loss: n })} />
          </>
        )}
        {value.scheme === 'placement' && PLACEMENT_KEYS.map((k) => (
          <NumberField
            key={k} label={PLACEMENT_LABEL[k]} value={value.points[k] ?? 0}
            onChange={(n) => onChange({ ...value, points: { ...value.points, [k]: n } })}
          />
        ))}
        {value.scheme === 'medal' && (
          <>
            <NumberField label="Gold" value={value.gold} onChange={(n) => onChange({ ...value, gold: n })} />
            <NumberField label="Silver" value={value.silver} onChange={(n) => onChange({ ...value, silver: n })} />
            <NumberField label="Bronze" value={value.bronze} onChange={(n) => onChange({ ...value, bronze: n })} />
          </>
        )}
        {/* Awarded to every org that takes part, on top of the scheme above. */}
        <NumberField label="Participation" value={value.participation} onChange={(n) => onChange({ ...value, participation: n })} />
      </div>

      {value.scheme !== 'league_points' && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Position points are awarded once the discipline's final has been played. Participation counts as soon as an org plays.
        </p>
      )}
    </div>
  );
}

// The championship-wide default rule.
function DefaultRuleEditor({ eventId, initial }: { eventId: string; initial: StandingsRule }) {
  const [rule, setRule] = useState<StandingsRule>(initial);
  const save = useApiMutation(
    (config: StandingsRule) => api('PUT', `/championships/${eventId}/standings-rules`, { scope_type: 'championship', config }),
    [], // recompute touches every scope — refresh all queries
  );
  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Championship default</span>
        <Badge tone="slate">applies unless overridden</Badge>
      </div>
      <RuleForm value={rule} onChange={setRule} />
      <div className="mt-3 flex justify-end">
        <Button disabled={save.isPending}
          onClick={() => save.mutate(rule, { onSuccess: () => toast.success('Default rule saved'), onError: (e: any) => toast.error(e.message) })}>
          {save.isPending ? 'Saving…' : 'Save default'}
        </Button>
      </div>
    </div>
  );
}

// A per-format / per-discipline override that inherits the default until customized.
function ScopeRuleEditor({ eventId, scopeType, option, override, fallback }: {
  eventId: string; scopeType: 'format' | 'discipline'; option: ScopeOption; override?: RuleRow; fallback: StandingsRule;
}) {
  const [open, setOpen] = useState(false);
  const [rule, setRule] = useState<StandingsRule>(override?.config ?? fallback);
  const save = useApiMutation(
    (config: StandingsRule) => api('PUT', `/championships/${eventId}/standings-rules`, { scope_type: scopeType, scope_id: option.id, config }),
    [],
  );
  const reset = useApiMutation(
    () => api('DELETE', `/championships/${eventId}/standings-rules/${override!.id}`),
    [],
  );

  const expanded = open || !!override;
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{option.name}</span>
          {override ? <Badge tone="brand">override</Badge> : <Badge tone="slate">inherits default</Badge>}
        </div>
        {!expanded && <Button variant="ghost" onClick={() => setOpen(true)}>Customize</Button>}
      </div>

      {expanded && (
        <div className="mt-3">
          <RuleForm value={rule} onChange={setRule} />
          <div className="mt-3 flex justify-end gap-2">
            {override && (
              <Button variant="ghost" disabled={reset.isPending}
                onClick={() => reset.mutate(undefined, { onSuccess: () => toast.success('Override removed'), onError: (e: any) => toast.error(e.message) })}>
                {reset.isPending ? 'Removing…' : 'Reset to default'}
              </Button>
            )}
            <Button disabled={save.isPending}
              onClick={() => save.mutate(rule, { onSuccess: () => toast.success('Override saved'), onError: (e: any) => toast.error(e.message) })}>
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
      <Card><CardHeader title="Scoring rules" /><CardBody><Spinner /></CardBody></Card>
    );
  }

  const championshipRule = data.rules.find((r) => r.scope_type === 'championship');
  const defaultRule = championshipRule?.config ?? data.default;
  const findOverride = (type: 'format' | 'discipline', id: string) => data.rules.find((r) => r.scope_type === type && r.scope_id === id);

  return (
    <Card>
      <CardHeader
        title="Scoring rules"
        subtitle="How completed fixtures become standings points. Set a championship default, then override per format or discipline."
      />
      <CardBody className="space-y-5">
        <DefaultRuleEditor key={JSON.stringify(defaultRule)} eventId={eventId} initial={defaultRule} />

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
