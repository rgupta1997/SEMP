import { SETUP_STALE_APPLY_MS, type SetupEventType } from '@semp/shared';
import type { ContactStats, EventSetupDetail, EventSetupStatus } from './types';

type Tone = 'brand' | 'green' | 'teal' | 'amber' | 'rose' | 'slate' | 'violet' | 'info';

export const STATUS_META: Record<EventSetupStatus, { label: string; tone: Tone; hint: string }> = {
  draft: { label: 'Draft', tone: 'slate', hint: 'No workbook validated yet' },
  invalid: { label: 'Needs fixes', tone: 'rose', hint: 'The workbook has errors to fix' },
  validated: { label: 'Ready to apply', tone: 'info', hint: 'Validated with no errors' },
  applying: { label: 'Applying', tone: 'amber', hint: 'The engine is building the event' },
  applied: { label: 'Applied', tone: 'green', hint: 'The event is on the platform' },
  failed: { label: 'Apply failed', tone: 'rose', hint: 'The run stopped part-way' },
  undone: { label: 'Undone', tone: 'violet', hint: 'Everything the run made was removed' },
};

export const statusMeta = (s: string) =>
  STATUS_META[s as EventSetupStatus] ?? { label: s, tone: 'slate' as Tone, hint: '' };

export const TYPE_SHORT: Record<SetupEventType, string> = { intra: 'Intra', inter: 'Inter', campus: 'Campus' };

/** The statuses a person has to act on before the setup can move. */
export const needsAttention = (s: EventSetupStatus) => s === 'invalid' || s === 'failed';

/**
 * The API treats a setup that has said 'applying' for this long as a run that died:
 * it may then be validated again or undone. On Lambda a detached run can be frozen
 * with its request, so this happens. From @semp/shared, so the two cannot drift.
 */
export const STALE_APPLYING_MS = SETUP_STALE_APPLY_MS;

type StatusAt = { status: EventSetupStatus; updated_at: string };

export const isStaleApplying = (s: StatusAt, now = Date.now()) =>
  s.status === 'applying' && now - new Date(s.updated_at).getTime() > STALE_APPLYING_MS;

/** Mid-run: nothing may change underneath it, unless the run is stale. */
const running = (s: StatusAt, now?: number) => s.status === 'applying' && !isStaleApplying(s, now);

export const canDelete = (s: EventSetupStatus) => s === 'draft' || s === 'invalid' || s === 'undone';
/**
 * "What to build" and the workbook are frozen once applied (undo first) and while
 * a run is live; the API refuses both then, with the same rule.
 */
export const canEditSteps = (s: StatusAt, now?: number) => s.status !== 'applied' && !running(s, now);
export const canUpload = (s: StatusAt, now?: number) => s.status !== 'applied' && !running(s, now);
export const canApply = (s: EventSetupStatus) => s === 'validated';

// ---------------------------------------------------------------------------
// the detail page's stepper
// ---------------------------------------------------------------------------
// The switches come first: the template and sample a client is sent are built for
// them (no Schedule sheet when Fixtures is skipped, no player columns when People is).
export const SECTIONS = ['steps', 'template', 'upload', 'results', 'apply', 'after'] as const;
export type SectionKey = (typeof SECTIONS)[number];

/**
 * done     finished; still readable, and still editable where that makes sense
 * current  the one thing to do next (at most one)
 * open     available, but not the next thing
 * locked   cannot start until an earlier section is done
 */
export type SectionState = 'done' | 'current' | 'open' | 'locked';

export function sectionStates(d: Pick<EventSetupDetail, 'status' | 'file_name' | 'validation' | 'verify_report'>): Record<SectionKey, SectionState> {
  const s = d.status;
  const validated = !!d.validation;
  const reached = (...st: EventSetupStatus[]) => st.includes(s);

  const complete: Record<SectionKey, boolean> = {
    template: !!d.file_name || validated,
    steps: validated,
    // A draft with a validation is one whose steps changed after it: the upload
    // has to be checked again, so it is the next thing to do, not a done thing.
    upload: validated && s !== 'draft' && s !== 'undone',
    results: reached('validated', 'applying', 'applied', 'failed'),
    apply: reached('applied'),
    after: reached('applied') && !!d.verify_report && (d.verify_report.failures?.length ?? 0) === 0,
  };
  const locked: Record<SectionKey, boolean> = {
    template: false,
    steps: false,
    upload: false,
    results: !validated,
    apply: !reached('validated', 'applying', 'applied', 'failed'),
    after: !reached('applied', 'undone'),
  };

  const out = {} as Record<SectionKey, SectionState>;
  let currentTaken = false;
  for (const k of SECTIONS) {
    if (locked[k]) out[k] = 'locked';
    else if (complete[k]) out[k] = 'done';
    else if (!currentTaken) { out[k] = 'current'; currentTaken = true; }
    else out[k] = 'open';
  }
  return out;
}

/**
 * Registration-day progress over the accounts this run CREATED. The API counts
 * `placeholder` as those still on a placeholder phone or email, and `replaced` as
 * the rest (total - placeholder): everyone who now has a real contact, whether the
 * sheet gave one or it was entered since. So the bar is real / total.
 */
export function contactProgress(c: ContactStats | null | undefined): { outstanding: number; done: number; of: number } | null {
  if (!c) return null;
  const outstanding = Math.max(0, c.placeholder ?? 0);
  const done = Math.max(0, c.replaced ?? 0);
  return { outstanding, done, of: Math.max(c.total ?? 0, outstanding + done) };
}
