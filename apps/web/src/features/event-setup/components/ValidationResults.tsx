import { useMemo } from 'react';
import { CircleAlert, CircleCheck, Download, TriangleAlert } from 'lucide-react';
import {
  SETUP_EVENT_TYPE_INFO, SETUP_STEPS, stepLabel,
  type SetupEventType, type SetupIssue, type SetupPlatformStep, type SetupValidationSummary,
} from '@semp/shared';
import { Button, cn } from '../../../components/ui';
import { DataList, Section } from '../../../components/primitives';
import { verdict } from '../issues';
import type { EventSetupDetail } from '../types';
import { BlueprintPreviews } from './BlueprintPreviews';
import { downloadIssuesCsv, IssuesList } from './IssuesList';
import { MODE_LABEL } from './StepModesEditor';
import { Banner, FOCUS_RING, Tile } from './pills';

export function SummaryTiles({ summary, type }: { summary: SetupValidationSummary; type: SetupEventType }) {
  const n = (v: number | null | undefined) => (v ?? 0).toLocaleString();
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      <Tile label="Draws" value={n(summary.draws)} />
      <Tile label={SETUP_EVENT_TYPE_INFO[type]?.competitor ?? 'Competitors'} value={n(summary.competitors)} />
      <Tile label="Squads" value={n(summary.squads)} />
      <Tile label="People" value={n(summary.people)} />
      <Tile
        label="With mobile"
        value={n(summary.peopleWithMobile)}
        hint={summary.people ? `${Math.round(((summary.peopleWithMobile ?? 0) / summary.people) * 100)}% of people` : undefined}
      />
      <Tile
        label="On placeholder"
        value={n(summary.peopleOnPlaceholder)}
        tone={summary.peopleOnPlaceholder > 0 ? 'amber' : undefined}
        hint={summary.peopleOnPlaceholder > 0 ? 'Collected on the day' : 'Everyone has a contact'}
      />
      <Tile label="In several squads" value={n(summary.peopleInSeveralSquads)} />
      <Tile label="Staff" value={n(summary.staff)} />
      <Tile label="Grounds" value={n(summary.grounds)} />
      <Tile label="Matches" value={n(summary.matches)} hint={summary.byes ? `+ ${n(summary.byes)} ${summary.byes === 1 ? 'bye' : 'byes'}` : 'No byes'} />
    </div>
  );
}

const num = (raw: number | null | undefined, tone?: 'rose' | 'brand') => {
  const v = raw ?? 0;
  return (
  <span className={cn(
    't-num font-semibold',
    !v ? 'text-slate-300 dark:text-slate-600'
      : tone === 'rose' ? 'text-rose-600 dark:text-rose-400'
        : tone === 'brand' ? 'text-brand-700 dark:text-brand-300'
          : 'text-slate-800 dark:text-slate-200',
  )}>{v.toLocaleString()}</span>
  );
};

/** Per step: what the platform already has (reused), what the run will create, and what is missing. */
export function PlatformTable({ steps, type }: { steps: SetupPlatformStep[]; type: SetupEventType }) {
  const ordered = useMemo(() => {
    const rank = (k: string) => SETUP_STEPS.findIndex((s) => s.key === k);
    return [...steps].sort((a, b) => rank(a.step) - rank(b.step));
  }, [steps]);
  const label = (k: string) => {
    const info = SETUP_STEPS.find((s) => s.key === k);
    return info ? stepLabel(info, type) : k;
  };
  return (
    <DataList
      caption="What the platform already has, and what the run will create, per step"
      rows={ordered}
      rowKey={(r) => r.step}
      columns={[
        {
          key: 'step', header: 'Step', primary: true,
          render: (r) => (
            <>
              <span className={cn('font-semibold', r.mode === 'skip' ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100')}>
                {label(r.step)}
              </span>
              {!!r.notes?.length && (
                <span className="t-meta mt-0.5 block font-normal sm:hidden">{r.notes.join(' · ')}</span>
              )}
            </>
          ),
        },
        { key: 'mode', header: 'Mode', render: (r) => <span className="whitespace-nowrap text-slate-600 dark:text-slate-300">{MODE_LABEL[r.mode] ?? r.mode}</span> },
        { key: 'found', header: 'Reused', align: 'right', render: (r) => num(r.found) },
        { key: 'create', header: 'To create', align: 'right', render: (r) => num(r.create, 'brand') },
        { key: 'missing', header: 'Missing', align: 'right', render: (r) => num(r.missing, 'rose') },
        {
          // A column on a wide screen; on a phone the notes ride under the step's
          // name instead, so a step with none does not spend a row saying "-".
          key: 'notes', header: 'Notes', desktopOnly: true,
          render: (r) => (r.notes?.length
            ? <span className="whitespace-normal text-[12.5px] text-slate-500 dark:text-slate-400">{r.notes.join(' · ')}</span>
            : <span className="text-slate-300 dark:text-slate-600">-</span>),
        },
      ]}
    />
  );
}

/** Section d: the verdict, the numbers, the platform check, every issue, and the previews. */
export function ValidationResults({ setup }: { setup: EventSetupDetail }) {
  const v = setup.validation;
  const issues = useMemo<SetupIssue[]>(
    () => [...(v?.issues ?? []), ...(setup.platform?.issues ?? [])],
    [v, setup.platform],
  );
  if (!v) return null;
  const verdictInfo = verdict(issues, v.ok);

  return (
    <div className="flex flex-col gap-6">
      {setup.status === 'draft' && (
        // Saving "What to build" after a validation puts the setup back to draft:
        // these results were worked out under the old choices.
        <Banner tone="slate" icon={<TriangleAlert size={20} />} title="These results are out of date">
          What to build changed after this workbook was validated. Validate it again so the checks use the new choices.
        </Banner>
      )}
      <Banner
        tone={verdictInfo.tone === 'ready' ? 'green' : verdictInfo.tone === 'review' ? 'amber' : 'rose'}
        icon={verdictInfo.tone === 'ready' ? <CircleCheck size={20} /> : verdictInfo.tone === 'review' ? <TriangleAlert size={20} /> : <CircleAlert size={20} />}
        title={verdictInfo.title}
        action={verdictInfo.tone === 'blocked' && issues.length > 0 ? (
          <Button variant="outline" size="sm" className={FOCUS_RING} onClick={() => downloadIssuesCsv(issues, setup.label)}>
            <Download size={13} aria-hidden /> Issues for the client
          </Button>
        ) : undefined}
      >
        {verdictInfo.detail}
      </Banner>

      {v.summary && (
        <Section title="What the workbook describes">
          <SummaryTiles summary={v.summary} type={setup.event_type} />
        </Section>
      )}

      {(setup.platform?.steps?.length ?? 0) > 0 && (
        <Section
          title="On the platform"
          description="Each step looked up against what is already there. Reused rows are left as they are; missing ones are errors."
        >
          <PlatformTable steps={setup.platform?.steps ?? []} type={setup.event_type} />
        </Section>
      )}

      <Section title="Issues" count={issues.length}>
        <IssuesList issues={issues} label={setup.label} />
      </Section>

      {v.blueprint ? (
        <Section title="Preview" description="What the run will build, read back from the workbook.">
          <BlueprintPreviews bp={v.blueprint} />
        </Section>
      ) : (
        <p className="t-meta">No preview: the errors leave nothing the run could build yet.</p>
      )}
    </div>
  );
}
