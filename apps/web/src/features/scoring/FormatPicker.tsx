import { useEffect, useMemo, useRef, useState } from 'react';
import {
  describeCricketFormat, formatLength, isCricketFormat, knobModelFor, parseRoundFormats, resolveRounds,
  whyNotEditable,
  type AnyKnobSpec, type AnyKnobs, type MatchFormat, type RoundFormatRule,
} from '@semp/shared';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { Button, Field, Input, Modal, Select, Spinner, cn, confirmDialog, toast } from '../../components/ui';

// ============================================================================
// Choosing the format, BEFORE the draw is generated.
//
// The common case is one tap: the sheet names the format that will be used and
// offers "Generate". Everything else - the preset shelf, the knobs, the per-round
// overrides - is behind "Change format", because most organisers on a busy day want
// the default and should not have to dismiss a form to get it.
// ============================================================================

interface SavedFormat {
  id: string; name: string; config: MatchFormat; is_system: boolean; preset_key: string | null;
}

interface ShelfResponse {
  sport: string | null;
  sportId?: string | null;
  supported: boolean;
  presets: MatchFormat[];
  saved: SavedFormat[];
  /** What this draw is set to right now, so edit mode opens on the truth. */
  current?: { formatId: string | null; roundFormats: unknown };
  /** The rounds this draw HAS, or will have once generated. Never a guess. */
  rounds?: Array<{ round: string; matches: number; stageSequence: number }>;
  entrants?: number;
}


export interface FormatPickerProps {
  /**
   * 'generate' settles the format and then builds the draw; 'edit' changes the
   * format of a draw that already exists and saves without touching its fixtures.
   */
  mode?: 'generate' | 'edit';
  /** Matches already played, so the guard rail can say what a change will NOT affect. */
  playedCount?: number;
  tournamentDisciplineId: string;
  /** Knockout draws get per-round overrides; round-robin labels carry a match number
   *  and would never match, so the control is hidden rather than offered uselessly. */
  isKnockout?: boolean;
  fixtureCount?: number;
  generateLabel?: string;
  onGenerate: () => void;
  onClose: () => void;
}

/** One line describing what a format actually does, for the shelf rows. */
export function describeFormat(f: MatchFormat): string {
  // Cricket describes itself: it has no levels to read, and reaching into
  // `f.levels[0]` for a cricket format is how this crashed before the union.
  if (isCricketFormat(f)) return describeCricketFormat(f);
  const inner = f.levels[0];
  const top = f.levels[f.levels.length - 1];
  const bits: string[] = [];
  if (top !== inner && top.target > 1) bits.push(`best of ${top.target * 2 - 1}`);
  bits.push(`${inner.label.toLowerCase()}s to ${inner.target}`);
  bits.push(inner.winBy > 1 ? `win by ${inner.winBy}` : 'sudden death');
  if (inner.cap != null) bits.push(`cap ${inner.cap}`);
  if (f.serve.movement === 'everyN' && f.serve.every) bits.push(`serve every ${f.serve.every}`);
  if (f.serve.pointScoring === 'serverOnly') bits.push('server scores only');
  if (f.clock) bits.push(`${f.clock.minutes} min cap`);
  return bits.join(' · ');
}

/**
 * A format being edited.
 *
 * `fromId` null means SAVING CREATES A NEW FORMAT. `derivedFrom` is the name of
 * whatever it was varied from, so the editor can say out loud that the original is
 * untouched - which is the whole guarantee a shared preset needs.
 */
interface Draft {
  base: MatchFormat;
  knobs: AnyKnobs;
  name: string;
  fromId: string | null;
  derivedFrom: string | null;
}

export function FormatPicker(p: FormatPickerProps) {
  const path = `/tournament-disciplines/${p.tournamentDisciplineId}/scoring-formats`;
  const { data, isLoading, refetch } = useApi<ShelfResponse>(path);
  const [view, setView] = useState<'confirm' | 'shelf' | 'rounds' | 'build'>('confirm');
  /** The format being edited rule-by-rule, and the row it came from (if any). */
  const [draft, setDraft] = useState<Draft | null>(null);
  const [chosen, setChosen] = useState<{ id: string | null; format: MatchFormat } | null>(null);
  const [roundRules, setRoundRules] = useState<RoundFormatRule[]>([]);
  /**
   * SEED THE EXISTING ROUND OVERRIDES.
   *
   * This state started empty and was sent on every save, so opening Format on a
   * draw that already had per-round overrides and pressing Save WIPED them - the
   * dialog would have silently discarded "QF and SF short, Final full" simply by
   * being opened. One-shot, and guarded by `touched` so a slow fetch cannot stomp a
   * change made before it landed.
   */
  const seeded = useRef(false);
  const touched = useRef(false);
  useEffect(() => {
    if (seeded.current || touched.current || !data) return;
    seeded.current = true;
    const existing = parseRoundFormats(data.current?.roundFormats);
    if (existing.length) setRoundRules(existing);
  }, [data]);
  const setRounds = (r: RoundFormatRule[]) => { touched.current = true; setRoundRules(r); };
  const [saving, setSaving] = useState(false);
  const editing = p.mode === 'edit';

  const options = useMemo(() => {
    const out: Array<{ id: string | null; label: string; format: MatchFormat; group: string }> = [];
    for (const s of data?.saved ?? []) {
      out.push({ id: s.id, label: s.name, format: s.config, group: s.is_system ? 'Platform' : 'Your institution' });
    }
    for (const f of data?.presets ?? []) {
      out.push({ id: null, label: f.name, format: f, group: 'Built in' });
    }
    return out;
  }, [data]);

  // The draw's own format wins over the first preset, so opening Format on a draw
  // already running "Our house rules" shows that - not ITTF Standard.
  const currentSaved = data?.saved?.find((x) => x.id === data?.current?.formatId) ?? null;
  const effective = chosen?.format ?? currentSaved?.config ?? data?.presets?.[0] ?? null;
  const effectiveId = chosen ? chosen.id : currentSaved?.id ?? null;

  const applyAndGenerate = async () => {
    // Changing the format of a draw with results in it is a real decision: those
    // matches keep the rules they were PLAYED under (the resolved format is frozen
    // into live_state on the first tap), so the change only reaches what has not
    // been scored. Say that rather than letting somebody assume it rewrites history.
    if (editing && (p.playedCount ?? 0) > 0) {
      const ok = await confirmDialog({
        title: 'Change the format for this draw?',
        confirmLabel: 'Change format',
        message: `${p.playedCount} match${p.playedCount === 1 ? '' : 'es'} in this draw ${p.playedCount === 1 ? 'has' : 'have'} already been scored. Those keep the rules they were played under. The new format applies to everything still unplayed.`,
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      // Rung 4 + 5 are written BEFORE generation, so every fixture resolves a real
      // format from the moment it exists.
      if (editing || chosen?.id !== undefined || roundRules.length) {
        await api('PATCH', `/tournament-disciplines/${p.tournamentDisciplineId}/scoring-format`, {
          ...(chosen ? { scoringFormatId: chosen.id } : {}),
          roundFormats: roundRules,
        });
      }
      if (editing) toast.success('Format updated');
      p.onGenerate();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  /** Save the draft: update the org format it came from, or create a new one. */
  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) { toast.error('Give the format a name so it can be reused.'); return; }
    // A new format cannot take the name of one this institution already has - the
    // unique index would refuse it, and a clear message beats a database error.
    if (!draft.fromId && data?.saved?.some((x) => !x.is_system && x.name.toLowerCase() === name.toLowerCase())) {
      toast.error(`You already have a format called "${name}". Pick another name, or edit that one instead.`);
      return;
    }
    const config = knobModelFor(draft.base).apply(draft.base, draft.knobs, name);
    setSaving(true);
    try {
      if (draft.fromId) {
        await api('PATCH', `${path}/${draft.fromId}`, { name, config });
        setChosen({ id: draft.fromId, format: config });
      } else {
        const r = await api('POST', path, {
          name, presetKey: draft.base.presetKey, sportId: data?.sportId ?? undefined, config,
        }) as { id: string };
        setChosen({ id: r.id, format: config });
      }
      toast.success(draft.fromId ? 'Format updated' : 'Format saved for your institution');
      setDraft(null);
      setView('confirm');
      // The shelf must show the new rules, not the ones it was rendered with.
      await refetch();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  /** Open the rule editor on a format - a preset to vary, or a saved one to change. */
  /** Is this format one of OUR OWN saved rows - the only kind that may be edited in place? */
  const isOurs = (id: string | null) =>
    !!id && !!data?.saved?.some((x) => x.id === id && !x.is_system);

  /**
   * Open the rule editor.
   *
   * NOTHING WE SHIP IS EVER MODIFIED. A built-in preset and a platform row are
   * shared - by every institution, in the case of the platform shelf - so varying
   * one always starts a NEW format and asks for a name. Only a format this
   * institution saved itself can be changed in place.
   *
   * This used to decide from `id === null`, which got a PLATFORM row wrong: it has
   * an id, so the editor tried to save in place, the API refused it (is_system rows
   * are not writable) and the organiser got an error where they should simply have
   * got a new format.
   */
  const build = (from: { id: string | null; format: MatchFormat }, forceNew = false) => {
    // One explanation for both families, so they cannot phrase a refusal differently.
    const refusal = whyNotEditable(from.format);
    if (refusal) {
      toast.error(refusal);
      return;
    }
    const inPlace = !forceNew && isOurs(from.id);
    setDraft({
      base: from.format,
      knobs: knobModelFor(from.format).read(from.format),
      // Editing our own keeps its name. Varying a shared one asks: an empty box with
      // the original as a placeholder, so "(ours)" is never saved as a real name by
      // somebody who just pressed Save.
      name: inPlace ? from.format.name : '',
      fromId: inPlace ? from.id : null,
      derivedFrom: inPlace ? null : from.format.name,
    });
    setView('build');
  };

  const title = view === 'shelf' ? 'Choose a format'
    : view === 'rounds' ? 'Format by round'
    : view === 'build' ? (draft?.fromId ? 'Edit the rules' : 'Build your own rules')
    : editing ? 'Scoring format' : 'Generate draw';

  return (
    <Modal
      title={title}
      onClose={p.onClose}
      wide={view !== 'confirm'}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {view !== 'confirm' && (
            <Button variant="subtle"
              onClick={() => { if (view === 'build') setDraft(null); setView(view === 'build' ? 'shelf' : 'confirm'); }}>
              Back
            </Button>
          )}
          {view === 'build' ? (
            <Button className="ml-auto" disabled={saving || !draft?.name.trim()} onClick={saveDraft}>
              {saving ? 'Saving…' : draft?.fromId ? 'Save changes' : 'Save format'}
            </Button>
          ) : (
            <Button
              className="ml-auto"
              disabled={saving || isLoading || !effective}
              onClick={applyAndGenerate}
            >
              {saving ? 'Working…'
                : editing ? 'Save format'
                : (p.generateLabel ?? `Generate${p.fixtureCount ? ` ${p.fixtureCount} fixtures` : ''}`)}
            </Button>
          )}
        </div>
      }
    >
      {isLoading ? <Spinner /> : !data?.supported ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {data?.sport ?? 'This sport'} is not scored by the racquet kernel yet, so the draw generates
          with its existing scoring. Nothing here changes that.
        </p>
      ) : view === 'confirm' ? (
        <div className="grid gap-4">
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Format
            </div>
            <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-50">
              {effective?.name}
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {effective && describeFormat(effective)}
            </div>
            <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
              {chosen ? 'chosen for this draw' : 'sport default'}
              {effective?.officiatingMode === 'selfScored' && ' · self-scored'}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setView('shelf')}>Change format</Button>
            <Button size="sm" variant="outline" disabled={!effective}
              onClick={() => effective && build({ id: effectiveId, format: effective }, !isOurs(effectiveId))}>
              {isOurs(effectiveId) ? 'Edit rules' : 'Vary these rules'}
            </Button>
            {p.isKnockout && (
              <Button size="sm" variant="outline" onClick={() => setView('rounds')}>
                Different format by round
              </Button>
            )}
          </div>

          {roundRules.length > 0 && (
            <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
              <div className="font-semibold text-slate-700 dark:text-slate-200">Round overrides</div>
              <ul className="mt-1 grid gap-0.5 text-slate-500 dark:text-slate-400">
                {roundRules.map((r, i) => (
                  <li key={i}>
                    {r.round ?? `Stage ${r.stageSequence}`} →{' '}
                    {/* A rule may name a saved row OR a built-in preset, so both have
                        to be resolvable here - naming only the row printed a raw id
                        for every preset-backed override. */}
                    {options.find((o) => (r.formatId ? o.id === r.formatId : o.format.presetKey === r.presetKey))?.label
                      ?? r.formatId ?? r.presetKey}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : view === 'shelf' ? (
        <div className="grid gap-3">
          <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {options.map((o, i) => {
                const active = o.id !== null
                  ? effectiveId === o.id
                  : effectiveId === null && effective?.presetKey === o.format.presetKey;
                const own = o.group === 'Your institution';
                return (
                  <li key={`${o.id ?? o.format.presetKey}-${i}`}
                    className={cn('flex items-center gap-1 pr-2 transition',
                      active ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60')}>
                    <button
                      type="button"
                      onClick={() => setChosen({ id: o.id, format: o.format })}
                      className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-3 py-2.5 text-left"
                    >
                      <span className="flex w-full items-baseline gap-2">
                        <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{o.label}</span>
                        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                          {o.group}
                        </span>
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{describeFormat(o.format)}</span>
                    </button>
                    {/* Editing your OWN format changes it; varying a shared one starts
                        a new format, because a platform preset belongs to everybody. */}
                    <Button size="sm" variant="ghost" className="shrink-0"
                      onClick={() => build({ id: o.id, format: o.format }, !own)}>
                      {own ? 'Edit rules' : 'Vary'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline"
              disabled={!effective}
              onClick={() => effective && build({ id: effectiveId, format: effective }, true)}>
              Build my own rules
            </Button>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              Starts from the selected format. Saved formats are reusable across every
              championship your institution hosts.
            </span>
          </div>
        </div>
      ) : view === 'build' && draft ? (
        <RuleEditor draft={draft} onChange={setDraft} />
      ) : (
        <RoundFormatTable
          rounds={data?.rounds ?? []}
          entrants={data?.entrants ?? 0}
          options={options}
          drawFormatId={chosen ? chosen.id : (data?.current?.formatId ?? null)}
          drawFormat={effective}
          rules={roundRules}
          onChange={setRounds}
        />
      )}
    </Modal>
  );
}

/**
 * The rule editor.
 *
 * Renders whatever `knobsFor` says applies to the format in hand, grouped. Nothing
 * here knows that a cap lives on a level or that the decider is an override - that
 * is applyKnobs's job, which is pure and tested. A knob added to the registry
 * therefore appears here with no change to this file.
 *
 * The live summary line matters more than it looks: it is the same describeKnobs the
 * shelf rows use, so somebody sees the sentence their format will be described by
 * while they are still building it.
 */
function RuleEditor({ draft, onChange }: {
  draft: Draft;
  onChange: (d: Draft) => void;
}) {
  const { knobs } = draft;
  // The model is chosen once, from the format being edited. Everything below is a
  // generic render of whatever it reports - which is why cricket needed no JSX here.
  const model = knobModelFor(draft.base);
  const set = (key: string, value: unknown) =>
    onChange({ ...draft, knobs: { ...knobs, [key]: value } as AnyKnobs });
  const shown = model.specsFor(knobs);

  return (
    <div className="grid gap-4">
      {/* THE ORIGINAL IS NEVER TOUCHED. Said here, not implied, because somebody
          varying a governing-body preset needs to know they are not editing the
          rules every other institution uses. */}
      {draft.derivedFrom && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-800/60">
          <span className="font-semibold text-slate-700 dark:text-slate-200">New format</span>
          <span className="text-slate-500 dark:text-slate-400">
            {' '}based on <span className="font-medium">{draft.derivedFrom}</span>, which is not changed.
            Give it a name and it joins your institution's shelf.
          </span>
        </div>
      )}

      <Field
        label={draft.derivedFrom ? 'Name this format' : 'Format name'}
        hint={draft.derivedFrom
          ? 'Required - this is a new format, so it needs a name of its own.'
          : 'How it appears on the shelf, for every championship your institution hosts.'}
      >
        <Input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder={draft.derivedFrom ? `e.g. ${draft.derivedFrom} - our version` : 'Our table tennis format'}
        />
      </Field>

      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60">
        <span className="font-semibold text-slate-600 dark:text-slate-300">Reads as:</span>{' '}
        <span className="text-slate-500 dark:text-slate-400">{model.describe(knobs)}</span>
      </div>

      <div className="max-h-[26rem] overflow-y-auto pr-1">
        {model.groups.map((g) => {
          const items = shown.filter((k) => k.group === g.key);
          if (!items.length) return null;
          return (
            <fieldset key={g.key} className="mb-4">
              <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {g.label}
              </legend>
              <div className="grid gap-3">
                {items.map((k) => <KnobField key={k.key} spec={k} knobs={knobs} onSet={set} />)}
              </div>
            </fieldset>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        {model.family === 'cricket'
          ? 'Everything not shown above - the rain rule, the powerplay note, anything printed on the draw sheet - comes from the format this was built from and keeps working.'
          : 'Everything not shown above - who serves first, the service court, the doubles rotation - comes from the format this was built from and keeps working.'}
      </p>
    </div>
  );
}

/** One knob, rendered from its spec. */
function KnobField({ spec, knobs, onSet }: {
  spec: AnyKnobSpec;
  knobs: AnyKnobs;
  onSet: (key: string, value: unknown) => void;
}) {
  const value = (knobs as unknown as Record<string, unknown>)[spec.key];

  if (spec.type === 'bool') {
    return (
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onSet(spec.key, e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 dark:border-slate-600"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">{spec.label}</span>
          {spec.hint && <span className="block text-[11px] text-slate-400 dark:text-slate-500">{spec.hint}</span>}
        </span>
      </label>
    );
  }

  if (spec.type === 'enum') {
    return (
      <Field label={spec.label} hint={spec.hint}>
        <Select value={String(value)} onChange={(e) => onSet(spec.key, e.target.value)}>
          {(spec.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </Field>
    );
  }

  return (
    <Field label={spec.label} hint={spec.hint}>
      <Input
        type="number"
        inputMode="numeric"
        min={spec.min}
        max={spec.max}
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          // Empty is not zero: clearing the box to retype must not write 0 and
          // re-render the field as "0" mid-keystroke.
          if (raw === '') return;
          const n = Number(raw);
          if (Number.isFinite(n)) onSet(spec.key, n);
        }}
      />
    </Field>
  );
}

/**
 * THE FORMAT EACH ROUND WILL PLAY.
 *
 * Not a form of exceptions - a table of every round, showing what it resolves to and
 * whether that is inherited or its own rule. The previous version showed only the
 * overrides, so there was no way to see what the rest of the draw was doing, and it
 * offered a generic R32/R16/QF/SF/Final ladder whenever it did not know the real
 * rounds. An 8-team draw could be given rules on R32 and R16 that the generator
 * never creates: saved, invisible, inert.
 *
 * Now the rounds come from the server - the real ones once generated, predicted from
 * the entrant count before - so a rule can only ever be set on a round that exists.
 */
function RoundFormatTable({ rounds, entrants, options, drawFormatId, drawFormat, rules, onChange }: {
  rounds: Array<{ round: string; matches: number; stageSequence: number }>;
  entrants: number;
  options: Array<{ id: string | null; label: string; format: MatchFormat; group: string }>;
  drawFormatId: string | null;
  drawFormat: MatchFormat | null;
  rules: RoundFormatRule[];
  onChange: (r: RoundFormatRule[]) => void;
}) {
  if (!rounds.length) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {entrants < 2
          ? 'This draw has fewer than two squads entered, so it has no rounds yet. Enter squads first, then each round can play its own format.'
          : 'No rounds to configure for this draw.'}
      </p>
    );
  }

  // A rule points at either a saved row or a built-in preset. One value in the
  // select covers both, so nothing has to be saved before a round can use it.
  const valueOf = (o: { id: string | null; format: MatchFormat }) =>
    o.id ? `id:${o.id}` : `preset:${o.format.presetKey ?? ''}`;

  const ruleFor = (round: string, stage: number) =>
    rules.find((r) => r.round === round && (r.stageSequence ?? stage) === stage);

  const currentValue = (round: string, stage: number) => {
    const r = ruleFor(round, stage);
    if (!r) return '';
    return r.formatId ? `id:${r.formatId}` : `preset:${r.presetKey ?? ''}`;
  };

  const set = (round: string, stage: number, value: string) => {
    const rest = rules.filter((r) => !(r.round === round && (r.stageSequence ?? stage) === stage));
    if (!value) { onChange(rest); return; }
    const [kind, key] = value.split(':');
    const rule: RoundFormatRule = kind === 'id'
      ? { round, stageSequence: stage, formatId: key }
      : { round, stageSequence: stage, presetKey: key };
    // Specific-round rules first, so a later stage-wide rule can never shadow one.
    onChange([rule, ...rest]);
  };

  // What each round resolves to right now, so the table shows the whole picture.
  const resolved = resolveRounds(
    rounds.map((r) => ({ round: r.round, matches: r.matches, stageSequence: r.stageSequence })),
    { round_formats: rules, scoring_format_id: drawFormatId ?? undefined },
    options.filter((o) => o.id).map((o) => ({ id: o.id as string, config: o.format, name: o.label })),
  );

  const multiStage = new Set(rounds.map((r) => r.stageSequence)).size > 1;
  const overrides = rules.length;

  return (
    <div className="grid gap-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Every round plays the draw format unless you give it one of its own. Only the
        rounds this draw actually has are listed.
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-400 dark:bg-slate-800/60 dark:text-slate-500">
              <th className="px-3 py-2 font-semibold">Round</th>
              <th className="px-3 py-2 font-semibold">Matches</th>
              <th className="px-3 py-2 font-semibold">Plays</th>
              <th className="px-3 py-2 font-semibold">Format</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rounds.map((r, i) => {
              const res = resolved[i];
              return (
                <tr key={`${r.stageSequence}-${r.round}`} className={res?.overridden ? 'bg-emerald-50/60 dark:bg-emerald-500/5' : undefined}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {r.round}
                    {multiStage && <span className="ml-1 text-[10px] font-normal text-slate-400">S{r.stageSequence}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-xs text-slate-500 dark:text-slate-400">
                    {r.matches}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {res?.format?.name ?? drawFormat?.name ?? '-'}
                    </div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500">
                      {res?.overridden ? 'this round only' : 'inherited'}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      className="!py-1 text-xs"
                      value={currentValue(r.round, r.stageSequence)}
                      onChange={(e) => set(r.round, r.stageSequence, e.target.value)}
                      aria-label={`Format for ${r.round}`}
                    >
                      <option value="">Same as the draw</option>
                      {options.map((o, n) => (
                        <option key={`${o.id ?? o.format.presetKey}-${n}`} value={valueOf(o)}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* The two things people actually want, as one tap each. Enumerating rounds
          by hand is the long way round for "the final should be longer". */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Quick set
        </span>
        {rounds.some((r) => r.round === 'Final') && (
          <Button size="sm" variant="subtle"
            onClick={() => {
              // The longest format on the shelf is what "the final plays longer"
              // means, and picking it here saves hunting through the list.
              // formatLength rather than reading levels[0] here: a cricket format
              // has no levels, and this is where that crashed.
              const longest = [...options].sort((a, b) => formatLength(b.format) - formatLength(a.format))[0];
              if (!longest) return;
              const fin = rounds.find((r) => r.round === 'Final')!;
              set('Final', fin.stageSequence, valueOf(longest));
            }}>
            Final plays the longest format
          </Button>
        )}
        {overrides > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onChange([])}>
            Clear {overrides} override{overrides === 1 ? '' : 's'}
          </Button>
        )}
      </div>
    </div>
  );
}

