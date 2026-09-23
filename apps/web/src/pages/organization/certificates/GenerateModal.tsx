import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import {
  CERTIFICATE_ISSUE_TRIGGER_LABEL, DEFAULT_TEMPLATE_LABEL, isEventWideCategory, RECIPIENT_CATEGORY,
  type CertificateIssueTrigger, type RecipientCategory,
} from '@semp/shared';
import { useApi, useApiMutation } from '../../../lib/hooks';
import { api } from '../../../lib/api';
import { Badge, Button, Checkbox, Modal, Select, Spinner, cn, toast } from '../../../components/ui';
import type { BadgeTone } from '../../../components/ui';
import type { Template } from './shared';

// The Recipients -> Templates -> Review wizard (replacing the old one-shot "pick a
// championship, pick kinds, Generate" flow).
//
// Recipients is not just achievements any more: Winners & medals and Special awards
// still come from locked results, but Participation, Organising team & volunteers,
// Officials & referees and Coaches & mentors are read straight from the roster/role
// tables the rest of the product already has. Each category is its own generate
// call, because each has its own template and its own issuing rule - there is no
// single "kinds" array any more, per-category is the unit of everything here.
//
// RecipientCategory and isEventWide come from @semp/shared - same source recipients.ts
// reads - instead of this file retyping its own copy.

type Trigger = CertificateIssueTrigger;

interface Champ { id: string; name: string }
interface GenerateResult { issued: number; skipped: number; note?: string; results?: Array<{ ok: boolean; serial?: string; reason?: string }> }

const CATEGORY_META: Record<RecipientCategory, { label: string; desc: string; source: string; tone: BadgeTone }> = {
  winners: { label: 'Winners & medals', desc: 'Gold, silver and bronze per game and discipline', source: 'From locked results', tone: 'amber' },
  awards: { label: 'Special awards', desc: 'Player of the match and the rest', source: 'From locked results', tone: 'brand' },
  participation: { label: 'Participation', desc: 'Everyone on a locked roster who played - no win required', source: 'From confirmed roster', tone: 'slate' },
  organising: { label: 'Organising team & volunteers', desc: "Members added to this event's organising team", source: 'From the event organising team', tone: 'teal' },
  officials: { label: 'Officials & referees', desc: 'Umpires, referees and technical officials', source: 'From officials assigned to this event', tone: 'teal' },
  coaches: { label: 'Coaches & mentors', desc: 'One certificate per coach, however many teams they coach', source: 'From team rosters', tone: 'teal' },
};

const CATEGORIES = [...RECIPIENT_CATEGORY];

/** Organising team & volunteers and Officials & referees have no sport, discipline or
 *  team column at all - they are event-wide by construction, not by choice. */
const isEventWide = isEventWideCategory;

// on_lock and on_complete aren't wired to anything yet - queueCertificates
// (fixtures/downstream.ts) is a TODO stub and there is no championship-completion
// hook either, so picking either one would silently drop that category from every
// run with no automatic issuance ever happening. Manual only until that lands.
const TRIGGER_OPTIONS: Array<{ value: Trigger; label: string }> = [
  { value: 'manual', label: CERTIFICATE_ISSUE_TRIGGER_LABEL.manual },
];

interface Filters { sportId: string; tournamentDisciplineId: string; teamId: string }

const candidatesPath = (orgId: string, championshipId: string, category: RecipientCategory, filters: Filters) =>
  `/organizations/${orgId}/certificates/candidates?championship_id=${championshipId}&category=${category}`
  + (!isEventWide(category) && filters.sportId ? `&sport_id=${filters.sportId}` : '')
  + (!isEventWide(category) && filters.tournamentDisciplineId ? `&tournament_discipline_id=${filters.tournamentDisciplineId}` : '')
  + (!isEventWide(category) && filters.teamId ? `&team_id=${filters.teamId}` : '');

/* ----------------------------- Wizard chrome ----------------------------- */

const STEP_LABELS = [
  { label: 'Recipients', desc: 'Scope and categories' },
  { label: 'Templates', desc: 'Artwork and rules' },
  { label: 'Review', desc: 'Confirm the list' },
];

function WizardStepper({ current }: { current: number }) {
  return (
    <ol className="relative flex justify-between">
      {/* One continuous line behind the circles, instead of a separate divider per gap. */}
      <div className="absolute left-4 right-4 top-4 -z-10 h-px bg-slate-200 dark:bg-slate-700" />
      {STEP_LABELS.map((s, i) => {
        const done = i < current, active = i === current;
        // The last step's circle needs to sit at ITS column's right edge, not left -
        // that edge is what justify-between pins to the line's right end, so this is
        // what keeps the last circle the same distance from the edge as the first.
        const isLast = i === STEP_LABELS.length - 1;
        const isFirst = i === 0;
        const align = isFirst ? 'items-start' : isLast ? 'items-end text-right' : 'items-center text-center';
        return (
          <li key={s.label} className={cn('flex flex-none flex-col gap-1', align)}>
            {/* A fixed navy for "current", not a tenant's derived brand colour - some
                tenants' brand hue lands close to the teal used for "done", and the two
                states have to read as different at a glance regardless of theme. */}
            <span className={cn(
              'grid h-8 w-8 place-items-center rounded-full text-xs font-bold',
              done ? 'bg-teal-400 text-white' : active ? 'bg-blue-950 text-white' : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
            )}>
              {done ? <Check className="h-4 w-4" strokeWidth={3} /> : String(i + 1).padStart(2, '0')}
            </span>
            <span className={cn('whitespace-nowrap text-sm font-bold', active || done ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500')}>{s.label}</span>
            <span className="whitespace-nowrap text-xs text-slate-400 dark:text-slate-500">{s.desc}</span>
          </li>
        );
      })}
    </ol>
  );
}

const SectionLabel = ({ children, action }: { children: string; action?: React.ReactNode }) => (
  <div className="flex items-center justify-between">
    <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">{children}</div>
    {action}
  </div>
);

/* ----------------------------- Recipients step ----------------------------- */

/** A category's live recipient count - a compact pill label, its own fetch so a
 *  slow or empty category never blocks the others from showing theirs. */
function CategoryCountPill({ orgId, championshipId, category, filters, tone }: {
  orgId: string; championshipId: string; category: RecipientCategory; filters: Filters; tone: BadgeTone;
}) {
  // The candidate pool includes people who already hold this certificate - Generate
  // skips them as duplicates, so the pill has to say how many are actually NEW, or
  // "5 recipients" reads as "5 will be issued" when the true number might be zero.
  const { data, isLoading } = useApi<{ rows: Array<{ already_issued: boolean }> }>(candidatesPath(orgId, championshipId, category, filters));
  const rows = data?.rows ?? [];
  const already = rows.filter((r) => r.already_issued).length;
  const fresh = rows.length - already;
  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1.5">
      <Badge tone={isLoading ? 'slate' : fresh > 0 ? tone : 'slate'} className="uppercase tracking-wide">
        {isLoading ? '…' : `${fresh} new`}
      </Badge>
      {!isLoading && already > 0 && (
        <span className="text-[11px] text-slate-400 dark:text-slate-500">{already} already certified</span>
      )}
    </span>
  );
}

function RecipientsStep({ orgId, championship, filters, setFilter, enabled, onToggleCategory, onSelectAll }: {
  orgId: string; championship: Champ; filters: Filters; setFilter: (p: Partial<Filters>) => void;
  enabled: Record<RecipientCategory, boolean>; onToggleCategory: (c: RecipientCategory) => void; onSelectAll: () => void;
}) {
  const { data: tournaments = [] } = useApi<any[]>(`/tournaments?championship_id=${championship.id}`);
  const tournamentId = tournaments[0]?.id;
  const { data: tsports = [] } = useApi<any[]>(tournamentId ? `/tournament-sports?tournament_id=${tournamentId}` : null);
  const { data: allSports = [] } = useApi<any[]>('/sports');
  const sportName = new Map((allSports as any[]).map((s) => [s.id, s.name]));
  const sportOptions = [...new Map(tsports.map((ts: any) => [ts.sport_id, ts])).values()];

  const activeTournamentSport = tsports.find((ts: any) => ts.sport_id === filters.sportId);
  const { data: disciplineRows = [] } = useApi<any[]>(activeTournamentSport ? `/tournament-disciplines?tournament_sport_id=${activeTournamentSport.id}` : null);
  const { data: teamRows = [] } = useApi<any[]>(filters.tournamentDisciplineId ? `/teams?tournament_discipline_id=${filters.tournamentDisciplineId}` : null);

  const allSelected = CATEGORIES.every((c) => enabled[c]);

  return (
    <div className="grid gap-5">
      <div>
        <SectionLabel>Scope this run</SectionLabel>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-xs">
            <span className="font-medium text-slate-600 dark:text-slate-400">Game</span>
            <Select value={filters.sportId} onChange={(e) => setFilter({ sportId: e.target.value, tournamentDisciplineId: '', teamId: '' })}>
              <option value="">All games</option>
              {sportOptions.map((ts: any) => <option key={ts.sport_id} value={ts.sport_id}>{sportName.get(ts.sport_id) ?? '—'}</option>)}
            </Select>
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium text-slate-600 dark:text-slate-400">Discipline</span>
            <Select value={filters.tournamentDisciplineId} onChange={(e) => setFilter({ tournamentDisciplineId: e.target.value, teamId: '' })} disabled={!filters.sportId}>
              <option value="">All disciplines</option>
              {disciplineRows.map((d: any) => <option key={d.id} value={d.id}>{d.disciplines?.name ?? 'Discipline'}</option>)}
            </Select>
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium text-slate-600 dark:text-slate-400">Team</span>
            <Select value={filters.teamId} onChange={(e) => setFilter({ teamId: e.target.value })} disabled={!filters.tournamentDisciplineId}>
              <option value="">All teams</option>
              {teamRows.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </label>
        </div>
        <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
          Team only narrows Winners, Awards, Participation and Coaches — Organising team and Officials are event-wide.
        </p>
      </div>

      <div>
        <SectionLabel action={
          <button type="button" onClick={onSelectAll} className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
            {allSelected ? 'Clear all' : 'Select all'}
          </button>
        }>Who gets certified</SectionLabel>
        <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {CATEGORIES.map((c) => {
            const meta = CATEGORY_META[c];
            return (
              <label key={c} className={cn(
                'grid cursor-pointer gap-1 rounded-xl border p-3.5 transition-colors',
                enabled[c] ? 'border-brand-200 bg-brand-50/40 dark:border-brand-500/30 dark:bg-brand-500/5' : 'border-slate-200 dark:border-slate-800',
              )}>
                <div className="flex items-start gap-2.5">
                  <Checkbox checked={enabled[c]} onChange={() => onToggleCategory(c)} />
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{meta.label}</span>
                    <CategoryCountPill orgId={orgId} championshipId={championship.id} category={c} filters={filters} tone={meta.tone} />
                  </span>
                </div>
                <p className="pl-6 text-sm text-slate-500 dark:text-slate-400">{meta.desc}</p>
                <p className="pl-6 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{meta.source}</p>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Templates step ----------------------------- */

function TemplatesStep({ enabledCategories, templates, templateId, setTemplateId, trigger, setTrigger, hasDeferred }: {
  enabledCategories: RecipientCategory[]; templates: Template[];
  templateId: Record<RecipientCategory, string>; setTemplateId: (c: RecipientCategory, v: string) => void;
  trigger: Record<RecipientCategory, Trigger>; setTrigger: (c: RecipientCategory, v: Trigger) => void;
  hasDeferred: boolean;
}) {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        One template and one issuing rule per category, for this event only.
      </p>
      <div className="grid gap-2.5">
        {enabledCategories.map((c) => {
          const meta = CATEGORY_META[c];
          return (
            <div key={c} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 p-3.5 sm:grid-cols-[1fr_auto] sm:items-center dark:border-slate-800">
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">{meta.label}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:w-[380px]">
                <label className="grid gap-1 text-xs">
                  <span className="font-medium text-slate-600 dark:text-slate-400">Template</span>
                  <Select value={templateId[c] ?? ''} onChange={(e) => setTemplateId(c, e.target.value)}>
                    <option value="">{DEFAULT_TEMPLATE_LABEL}</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="font-medium text-slate-600 dark:text-slate-400">Issuing rule</span>
                  <Select value={trigger[c]} onChange={(e) => setTrigger(c, e.target.value as Trigger)}>
                    {TRIGGER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </label>
              </div>
            </div>
          );
        })}
      </div>
      {hasDeferred && (
        <div className="rounded-xl bg-sky-50 p-3.5 dark:bg-sky-500/10">
          <div className="font-semibold text-sky-900 dark:text-sky-300">Automated rules aren't wired up yet</div>
          <p className="mt-0.5 text-sm text-sky-800/80 dark:text-sky-300/70">
            A category set to a rule other than "Manual run only" will be skipped when you click Generate, rather than
            issue on its own — set it back to manual to include it in this run.
          </p>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Review step ----------------------------- */

/** One category's recipient list, with an include/exclude toggle per person and a
 *  gray header bar naming the template/rule this run will use for it. Already-
 *  certified people default to excluded. */
function CategoryReview({ orgId, championshipId, category, filters, templateName, triggerLabel, excluded, onToggle, onSeed }: {
  orgId: string; championshipId: string; category: RecipientCategory; filters: Filters;
  templateName: string; triggerLabel: string;
  excluded: Set<string>; onToggle: (userId: string, alreadyIssued: boolean) => void;
  onSeed: (rows: Array<{ user_id: string; already_issued: boolean }>) => void;
}) {
  const { data, isLoading } = useApi<{ rows: Array<{ user_id: string; name: string; title: string; sport: string | null; already_issued: boolean }> }>(
    candidatesPath(orgId, championshipId, category, filters),
  );
  const meta = CATEGORY_META[category];
  const rows = data?.rows ?? [];
  useEffect(() => { if (data?.rows) onSeed(data.rows); }, [data]);

  if (isLoading) return <div className="flex items-center gap-2 py-3 text-sm text-slate-500"><Spinner /> Loading {meta.label.toLowerCase()}…</div>;
  if (!rows.length) return null;
  const included = rows.filter((r) => !excluded.has(r.user_id)).length;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between bg-slate-50 px-3.5 py-2 dark:bg-slate-800/60">
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
          {meta.label} <span className="font-normal normal-case text-slate-400">{included} of {rows.length}</span>
        </span>
        <span className="text-xs text-slate-400 dark:text-slate-500">{templateName} · {triggerLabel}</span>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((r) => {
          const isExcluded = excluded.has(r.user_id);
          return (
            <label key={r.user_id} className={cn('flex items-center gap-3 px-3.5 py-2.5 text-sm', isExcluded && 'opacity-45')}>
              <Checkbox checked={!isExcluded} onChange={() => onToggle(r.user_id, r.already_issued)} />
              <span className="w-40 shrink-0 truncate font-semibold text-slate-800 dark:text-slate-200">{r.name}</span>
              <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-400">{r.title}</span>
              <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
                {r.already_issued ? 'already certified' : r.sport ?? ''}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------- Wizard ----------------------------- */

function Wizard({ orgId, championship, templates, onClose, invalidate }: {
  orgId: string; championship: Champ; templates: Template[]; onClose: () => void; invalidate: (string | null)[];
}) {
  const [step, setStep] = useState(0);
  const [filters, setFilters] = useState<Filters>({ sportId: '', tournamentDisciplineId: '', teamId: '' });
  const [enabled, setEnabled] = useState<Record<RecipientCategory, boolean>>({
    winners: true, awards: true, participation: true, organising: false, officials: false, coaches: false,
  });
  const [templateId, setTemplateIdState] = useState<Record<RecipientCategory, string>>({} as any);
  const [trigger, setTriggerState] = useState<Record<RecipientCategory, Trigger>>(
    Object.fromEntries(CATEGORIES.map((c) => [c, 'manual'])) as any,
  );
  // category -> excluded user_ids, seeded the first time that category is reviewed
  // (already-certified people start excluded, everyone else starts included).
  const [excluded, setExcluded] = useState<Record<string, Set<string>>>({});
  const [seeded, setSeeded] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<Record<string, GenerateResult> | null>(null);
  const [running, setRunning] = useState(false);

  const generate = useApiMutation((body: any) => api('POST', `/organizations/${orgId}/certificates/generate`, body), invalidate);

  const setFilter = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const toggleCategory = (c: RecipientCategory) => setEnabled((e) => ({ ...e, [c]: !e[c] }));
  const selectAll = () => {
    const allOn = CATEGORIES.every((c) => enabled[c]);
    setEnabled(Object.fromEntries(CATEGORIES.map((c) => [c, !allOn])) as any);
  };
  const setTemplateId = (c: RecipientCategory, v: string) => setTemplateIdState((t) => ({ ...t, [c]: v }));
  const setTrigger = (c: RecipientCategory, v: Trigger) => setTriggerState((t) => ({ ...t, [c]: v }));

  const enabledCategories = CATEGORIES.filter((c) => enabled[c]);
  const enabledManualCategories = enabledCategories.filter((c) => trigger[c] === 'manual');
  const enabledDeferredCategories = enabledCategories.filter((c) => trigger[c] !== 'manual');

  const excludedFor = (category: RecipientCategory) => excluded[category] ?? new Set<string>();
  const totalExcluded = enabledManualCategories.reduce((n, c) => n + excludedFor(c).size, 0);
  const onToggleRecipient = (category: RecipientCategory, userId: string) => {
    setExcluded((cur) => {
      const set = new Set(cur[category] ?? new Set<string>());
      if (set.has(userId)) set.delete(userId); else set.add(userId);
      return { ...cur, [category]: set };
    });
  };
  const seedIfNeeded = (category: RecipientCategory, rows: Array<{ user_id: string; already_issued: boolean }>) => {
    if (seeded.has(category)) return;
    setSeeded((s) => new Set(s).add(category));
    const already = rows.filter((r) => r.already_issued).map((r) => r.user_id);
    if (already.length) setExcluded((cur) => ({ ...cur, [category]: new Set(already) }));
  };

  const onGenerate = async () => {
    setRunning(true);
    const combined: Record<string, GenerateResult> = {};
    try {
      for (const category of enabledManualCategories) {
        try {
          const r = await generate.mutateAsync({
            championship_id: championship.id,
            category,
            ...(templateId[category] ? { template_id: templateId[category] } : {}),
            filters: isEventWide(category) ? {} : {
              ...(filters.sportId ? { sport_id: filters.sportId } : {}),
              ...(filters.tournamentDisciplineId ? { tournament_discipline_id: filters.tournamentDisciplineId } : {}),
              ...(filters.teamId ? { team_id: filters.teamId } : {}),
            },
            excluded_user_ids: [...excludedFor(category)],
          }) as GenerateResult;
          combined[category] = r;
        } catch (e: any) {
          combined[category] = { issued: 0, skipped: 0, note: e?.message ?? 'Could not generate this category.' };
        }
      }
      setOutcome(combined);
      const totalIssued = Object.values(combined).reduce((n, r) => n + r.issued, 0);
      if (totalIssued > 0) toast.success(`${totalIssued} issued`);
    } finally {
      setRunning(false);
    }
  };

  const totalIssued = outcome ? Object.values(outcome).reduce((n, r) => n + r.issued, 0) : 0;
  const totalSkipped = outcome ? Object.values(outcome).reduce((n, r) => n + r.skipped, 0) : 0;

  // The footer's running "N certificates in this run" count. On Review it reflects
  // included-minus-excluded; before that it's each enabled category's live total.
  const [scopeCounts, setScopeCounts] = useState<Record<string, number>>({});
  const scopeTotal = enabledManualCategories.reduce((n, c) => n + (scopeCounts[c] ?? 0), 0) - totalExcluded;

  const footerLine2 = outcome
    ? 'Serials are QR-verifiable at sportagon.in/verify'
    : step === 0
      ? (enabledCategories.length ? 'Pick a game, discipline or team to narrow it further' : 'Pick at least one category')
      : step === 1
        ? 'Templates and rules apply to this event'
        : `${totalExcluded} excluded from this run`;

  return (
    <Modal
      title="Generate certificates"
      onClose={onClose}
      size="4xl"
      banner={
        <div>
          <span className="text-lg font-bold text-white">Generate certificates</span>
          <div className="text-xs text-white/70">{championship.name}</div>
        </div>
      }
      dismissible={false}
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-bold text-slate-900 dark:text-slate-100">
              {outcome ? `${totalIssued} certificates issued` : `${Math.max(scopeTotal, 0)} certificates in this run`}
            </div>
            <div className="truncate text-xs text-slate-400 dark:text-slate-500">{footerLine2}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!outcome && step > 0 && (
              <Button variant="ghost" size="lg" onClick={() => setStep((s) => s - 1)}>Back</Button>
            )}
            {outcome ? (
              <Button size="lg" onClick={onClose}>Done</Button>
            ) : step === 0 ? (
              <Button size="lg" onClick={() => setStep(1)} disabled={!enabledCategories.length}>Continue</Button>
            ) : step === 1 ? (
              <Button size="lg" onClick={() => setStep(2)}>Continue</Button>
            ) : (
              <Button size="lg" onClick={onGenerate} disabled={running || !enabledManualCategories.length}>
                {running ? 'Generating…' : `Generate ${Math.max(scopeTotal, 0)}`}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {!outcome && <div className="mb-5"><WizardStepper current={step} /></div>}

      {outcome ? (
        <div className="grid gap-1 py-6 text-center">
          <div className="mx-auto mb-2 grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
            <Check size={26} />
          </div>
          <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{totalIssued} certificates issued</h3>
          <p className="mx-auto max-w-md text-sm text-slate-500 dark:text-slate-400">
            Serials assigned and QR verification is live.{totalSkipped ? ` ${totalSkipped} recipients were skipped because they already hold the same honour.` : ''}
          </p>
          <div className="mt-4 grid gap-1.5 text-left">
            {Object.entries(outcome).map(([category, r]) => (
              <div key={category} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                <span className="font-medium text-slate-700 dark:text-slate-300">{CATEGORY_META[category as RecipientCategory].label}</span>
                <span className="text-slate-500 dark:text-slate-400">{r.issued} issued{r.skipped ? `, ${r.skipped} skipped` : ''}{r.note ? ` — ${r.note}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      ) : step === 0 ? (
        <RecipientsStep
          orgId={orgId} championship={championship} filters={filters} setFilter={setFilter}
          enabled={enabled} onToggleCategory={toggleCategory} onSelectAll={selectAll}
        />
      ) : step === 1 ? (
        <TemplatesStep
          enabledCategories={enabledCategories} templates={templates}
          templateId={templateId} setTemplateId={setTemplateId}
          trigger={trigger} setTrigger={setTrigger}
          hasDeferred={enabledDeferredCategories.length > 0}
        />
      ) : (
        <div className="grid gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500 dark:text-slate-400">Uncheck anyone who should not receive a certificate in this run.</p>
            <span className="shrink-0 text-xs text-slate-400">{totalExcluded} excluded</span>
          </div>
          {enabledDeferredCategories.length > 0 && (
            <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-500/10 dark:text-sky-300/80">
              {enabledDeferredCategories.map((c) => CATEGORY_META[c].label).join(', ')} — set to an automatic issuing rule, so not included in this manual run.
            </p>
          )}
          <div className="grid gap-3">
            {enabledManualCategories.map((c) => (
              <CategoryReview
                key={c} category={c} orgId={orgId} championshipId={championship.id} filters={filters}
                templateName={templates.find((t) => t.id === templateId[c])?.name ?? DEFAULT_TEMPLATE_LABEL}
                triggerLabel={TRIGGER_OPTIONS.find((o) => o.value === trigger[c])!.label}
                excluded={excludedFor(c)}
                onToggle={(userId) => onToggleRecipient(c, userId)}
                onSeed={(rows) => {
                  seedIfNeeded(c, rows);
                  setScopeCounts((cur) => ({ ...cur, [c]: rows.length }));
                }}
              />
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function GenerateModal({ orgId, championship, templates, onClose, invalidate }: {
  orgId: string; championship?: Champ; templates: Template[]; onClose: () => void; invalidate: (string | null)[];
}) {
  const [champId, setChampId] = useState('');
  const champs = useApi<{ rows: Array<{ id: string; name: string; pending: number }> }>(
    championship ? null : `/organizations/${orgId}/certificates/pending-by-event`,
  );

  // Opened from a specific event's own Certificates tab, `championship` is already
  // known. Opened from the org-wide Certificates Manager, ask which event first -
  // every category and filter downstream is scoped to one event at a time.
  if (!championship) {
    // Nothing pending across all six categories means nothing this picker can start -
    // an event with a flat 0 is noise, not a choice.
    const withPending = (champs.data?.rows ?? []).filter((c) => c.pending > 0);
    const picked = withPending.find((c) => c.id === champId);
    if (picked) return <Wizard orgId={orgId} championship={picked} templates={templates} onClose={onClose} invalidate={invalidate} />;
    return (
      <Modal title="Generate certificates" onClose={onClose} footer={<Button variant="ghost" onClick={onClose}>Cancel</Button>}>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-300">Championship</span>
          <Select value={champId} onChange={(e) => setChampId(e.target.value)}>
            <option value="">Choose a championship…</option>
            {withPending.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.pending})</option>)}
          </Select>
        </label>
      </Modal>
    );
  }

  return <Wizard orgId={orgId} championship={championship} templates={templates} onClose={onClose} invalidate={invalidate} />;
}
