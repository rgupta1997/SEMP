import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  SETUP_DEFAULT_STEPS, SETUP_STEP_MODES, SETUP_STEPS, stepLabel,
  type SetupEventType, type SetupStepKey, type SetupStepMode, type SetupSteps,
} from '@semp/shared';
import { Button, Card, cn, toast } from '../../../components/ui';
import { eventSetupApi, useSetupCache } from '../api';
import { FOCUS_RING } from './pills';

export const MODE_LABEL: Record<SetupStepMode, string> = {
  sheet: 'From sheet',
  existing: 'Already exists',
  skip: 'Skip',
};

const MODE_HINT: Record<SetupStepMode, string> = {
  sheet: 'Build it from the workbook. Anything already on the platform is found and reused.',
  existing: 'It is already on the platform. Look it up and stop if it is not there.',
  skip: 'This run does not touch it.',
};

const sameSteps = (a: SetupSteps, b: SetupSteps) => SETUP_STEPS.every((s) => a[s.key] === b[s.key]);

/** A three-way radio group drawn as a segmented control. */
function ModeSwitch({ label, value, onChange, disabled }: {
  label: string; value: SetupStepMode; onChange: (m: SetupStepMode) => void; disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`${label}: how this run treats it`}
      className="grid w-full grid-cols-3 rounded-lg bg-slate-100 p-0.5 sm:inline-grid sm:w-auto dark:bg-slate-800"
    >
      {SETUP_STEP_MODES.map((m) => {
        const active = value === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={MODE_HINT[m]}
            onClick={() => onChange(m)}
            className={cn(
              'min-h-[36px] whitespace-nowrap rounded-md px-2.5 text-xs font-semibold transition-colors sm:min-h-[30px]',
              FOCUS_RING,
              active
                ? m === 'skip'
                  ? 'bg-white text-slate-700 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                  : 'bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-brand-200'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            {MODE_LABEL[m]}
          </button>
        );
      })}
    </div>
  );
}

export function StepModesEditor({ setupId, type, steps, editable, validated }: {
  setupId: string;
  type: SetupEventType;
  steps: SetupSteps;
  editable: boolean;
  /** A validation exists, so saving new choices makes it stale. */
  validated: boolean;
}) {
  const { put, refresh } = useSetupCache();
  const [draft, setDraft] = useState<SetupSteps>(steps);
  const [saving, setSaving] = useState(false);
  const dirty = !sameSteps(draft, steps);
  const defaults = SETUP_DEFAULT_STEPS[type] ?? steps;
  const atDefaults = sameSteps(draft, defaults);

  // Follow the server's copy while there are no local edits to lose. "No local
  // edits" means the draft still equals the PREVIOUS server copy - comparing it to
  // the new one would call every server-side change an edit and never take it.
  const serverKey = useMemo(() => SETUP_STEPS.map((s) => steps[s.key]).join(','), [steps]);
  const lastServer = useRef(steps);
  useEffect(() => {
    const prev = lastServer.current;
    lastServer.current = steps;
    setDraft((d) => (sameSteps(d, prev) ? steps : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  const set = (key: SetupStepKey, mode: SetupStepMode) => setDraft((d) => ({ ...d, [key]: mode }));

  const save = async () => {
    setSaving(true);
    try {
      const saved = await eventSetupApi.saveSteps(setupId, draft);
      put(saved);
      // Take what the server kept, in case it normalised a choice.
      setDraft((d) => ({ ...d, ...saved.steps }));
      toast.success('Saved', validated ? 'Validate the workbook again so the checks use these choices.' : undefined);
    } catch (e) {
      toast.error('Could not save', (e as Error)?.message ?? 'Try again.');
      refresh(setupId);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {SETUP_STEPS.map((s) => {
          const label = stepLabel(s, type);
          const changed = draft[s.key] !== steps[s.key];
          return (
            <li key={s.key} className="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</span>
                  {s.sheet && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {s.sheet} sheet
                    </span>
                  )}
                  {changed && <span className="t-eyebrow !text-amber-600 dark:!text-amber-400">unsaved</span>}
                </div>
                <p className="t-meta mt-0.5">Found by {s.foundBy}.</p>
              </div>
              <ModeSwitch label={label} value={draft[s.key]} onChange={(m) => set(s.key, m)} disabled={!editable || saving} />
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-800/30">
        <p className="t-meta">
          {editable
            ? validated
              ? 'Changing these after validating means validating the workbook again.'
              : 'Start from the usual choices for this event type and change only what differs.'
            : 'Fixed: the run has started, so these record what it was asked to do.'}
        </p>
        {editable && (
          <div className="flex shrink-0 gap-2">
            <Button
              variant="ghost"
              size="sm"
              className={FOCUS_RING}
              disabled={saving || atDefaults}
              onClick={() => setDraft(defaults)}
            >
              <RotateCcw size={13} aria-hidden /> Defaults
            </Button>
            {dirty && (
              <Button variant="ghost" size="sm" className={FOCUS_RING} disabled={saving} onClick={() => setDraft(steps)}>
                Discard
              </Button>
            )}
            <Button size="sm" className={FOCUS_RING} disabled={!dirty || saving} onClick={save}>
              {saving ? 'Saving…' : 'Save choices'}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
