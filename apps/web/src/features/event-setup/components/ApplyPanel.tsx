import { useState } from 'react';
import { CircleAlert, LoaderCircle, Play, RefreshCw, TriangleAlert, Undo2 } from 'lucide-react';
import { SETUP_STEPS, stepLabel, type SetupEventType } from '@semp/shared';
import { Button, confirmDialog, cn, toast } from '../../../components/ui';
import { DataList } from '../../../components/primitives';
import { fmtDateTime } from '../../../lib/hooks';
import { APPLY_POLL_MS, eventSetupApi, useSetupCache } from '../api';
import { STALE_APPLYING_MS } from '../status';
import type { ApplyReportRow, EventSetupDetail } from '../types';
import { MODE_LABEL } from './StepModesEditor';
import { Banner, FOCUS_RING } from './pills';
import { useUndoSetup } from './useUndoSetup';

const labelFor = (key: string, type: SetupEventType) => {
  const info = SETUP_STEPS.find((s) => s.key === key);
  return info ? stepLabel(info, type) : key;
};

const fmtN = (v: number | null | undefined) => (v ?? 0).toLocaleString();

export function ApplyReport({ rows, type }: { rows: ApplyReportRow[]; type: SetupEventType }) {
  return (
    <DataList
      caption="What the run did, per step"
      rows={rows}
      rowKey={(r) => r.step}
      columns={[
        {
          key: 'step', header: 'Step', primary: true,
          render: (r) => (
            <>
              <span className="font-semibold">{labelFor(r.step, type)}</span>
              {!!r.notes?.length && <span className="t-meta mt-0.5 block font-normal sm:hidden">{r.notes.join(' · ')}</span>}
            </>
          ),
        },
        { key: 'mode', header: 'Mode', render: (r) => <span className="whitespace-nowrap text-slate-600 dark:text-slate-300">{MODE_LABEL[r.mode] ?? r.mode}</span> },
        { key: 'found', header: 'Reused', align: 'right', render: (r) => <span className="t-num">{fmtN(r.found)}</span> },
        { key: 'created', header: 'Created', align: 'right', render: (r) => <span className="t-num font-semibold text-emerald-700 dark:text-emerald-400">{fmtN(r.created)}</span> },
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

/** The confirmation's body: what the run is about to create, step by step. */
function ApplyPlan({ setup }: { setup: EventSetupDetail }) {
  const steps = (setup.platform?.steps ?? []).filter((s) => s.mode !== 'skip');
  const s = setup.validation?.summary;
  return (
    <div className="flex flex-col gap-3 text-sm text-slate-600 dark:text-slate-300">
      <p>This builds <strong className="text-slate-900 dark:text-slate-100">{setup.label}</strong> on the live platform:</p>
      {steps.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
          {steps.map((st) => (
            <li key={st.step} className="flex justify-between gap-3">
              <span>{labelFor(st.step, setup.event_type)}</span>
              <span className="t-num shrink-0 text-right">
                {st.create > 0 && <strong className="text-slate-900 dark:text-slate-100">create {fmtN(st.create)}</strong>}
                {st.create > 0 && st.found > 0 && ' · '}
                {st.found > 0 && <>reuse {fmtN(st.found)}</>}
                {!(st.create > 0) && !(st.found > 0) && <span className="text-slate-400">nothing</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : s ? (
        <p>{fmtN(s.squads)} squads, {fmtN(s.people)} people, {fmtN(s.staff)} staff and {fmtN(s.matches)} matches.</p>
      ) : null}
      <p>It runs in the background. It can be undone until the first match is played.</p>
    </div>
  );
}

/** Section e: apply, watch it run, and see what it did. */
export function ApplyPanel({ setup, stale, onRevalidate }: {
  setup: EventSetupDetail;
  /** 'applying' for longer than the API's stale window: the run very likely died. */
  stale: boolean;
  onRevalidate: () => void;
}) {
  const { put, refresh } = useSetupCache();
  const [starting, setStarting] = useState(false);
  const { undo, undoing } = useUndoSetup(setup);
  const report = setup.apply_report ?? [];

  const apply = async () => {
    const ok = await confirmDialog({
      title: 'Apply this setup?',
      message: <ApplyPlan setup={setup} />,
      confirmLabel: 'Apply',
      tone: 'primary',
    });
    if (!ok) return;
    setStarting(true);
    try {
      const d = await eventSetupApi.apply(setup.id);
      put(d);
      // Normally 'applying' and the poll takes over; a run small enough to finish
      // inside the request comes back already settled, and is said so here.
      if (d.status === 'applied') toast.success('Applied', 'The event is on the platform. Verify it next.');
      else if (d.status === 'failed') toast.error('The run stopped part-way', d.error ?? undefined);
    } catch (e) {
      toast.error('Could not start the run', (e as Error)?.message ?? 'Try again.');
      // A refusal can move the setup: one that no longer validates comes back
      // 409 having been set to 'invalid', with the fresh issues on it.
      refresh(setup.id);
    } finally {
      setStarting(false);
    }
  };

  if (setup.status === 'applying' && stale) {
    return (
      <div className="flex flex-col gap-4">
        <Banner
          tone="amber"
          icon={<TriangleAlert size={20} />}
          title="This run looks stuck"
          action={(
            <>
              <Button variant="outline" size="sm" className={FOCUS_RING} disabled={undoing} onClick={onRevalidate}>
                <RefreshCw size={13} aria-hidden /> Re-validate
              </Button>
              <Button variant="ghost" size="sm" className={FOCUS_RING} disabled={undoing} onClick={undo}>
                <Undo2 size={13} aria-hidden /> {undoing ? 'Undoing…' : 'Undo what it made'}
              </Button>
            </>
          )}
        >
          It has said "applying" since {fmtDateTime(setup.updated_at)}, over {STALE_APPLYING_MS / 60000} minutes, so it most
          likely stopped without recording why. Validate again and apply (what it already made is reused), or undo what it made.
        </Banner>
        {report.length > 0 && <ApplyReport rows={report} type={setup.event_type} />}
      </div>
    );
  }

  if (setup.status === 'applying') {
    return (
      <div className="flex flex-col gap-4">
        <Banner tone="info" icon={<LoaderCircle size={20} className="animate-spin" />} title="Building the event…">
          Creating the organisation, people, squads, draws and fixtures. This page checks in every {APPLY_POLL_MS / 1000} seconds; you can leave it and come back.
        </Banner>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="progressbar" aria-label="Applying" aria-busy="true">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-brand-500" />
        </div>
        {report.length > 0 && <ApplyReport rows={report} type={setup.event_type} />}
      </div>
    );
  }

  if (setup.status === 'failed') {
    return (
      <div className="flex flex-col gap-4">
        <Banner
          tone="rose"
          icon={<CircleAlert size={20} />}
          title="The run stopped part-way"
          action={(
            <>
              <Button variant="outline" size="sm" className={FOCUS_RING} disabled={undoing} onClick={onRevalidate}>
                <RefreshCw size={13} aria-hidden /> Re-validate
              </Button>
              <Button variant="ghost" size="sm" className={FOCUS_RING} disabled={undoing} onClick={undo}>
                <Undo2 size={13} aria-hidden /> {undoing ? 'Undoing…' : 'Undo what it made'}
              </Button>
            </>
          )}
        >
          <span className="block font-mono text-[12.5px] [overflow-wrap:anywhere]">{setup.error || 'No error message was recorded.'}</span>
          <span className="mt-1.5 block">
            Fix the cause, validate again, then apply. Running again is safe: what this run already made is found and reused, not duplicated.
          </span>
        </Banner>
        {report.length > 0 && <ApplyReport rows={report} type={setup.event_type} />}
      </div>
    );
  }

  if (setup.status === 'applied') {
    return (
      <div className="flex flex-col gap-3">
        <p className="t-meta">Applied {fmtDateTime(setup.applied_at)}.</p>
        {report.length > 0 ? <ApplyReport rows={report} type={setup.event_type} /> : <p className="t-meta">No step report was recorded.</p>}
      </div>
    );
  }

  // validated (this section is locked in every other status)
  const steps = (setup.platform?.steps ?? []).filter((s) => s.mode !== 'skip');
  const toCreate = steps.reduce((n, s) => n + (s.create ?? 0), 0);
  const toReuse = steps.reduce((n, s) => n + (s.found ?? 0), 0);
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="t-body-sm text-slate-600 dark:text-slate-300">
        {steps.length > 0
          ? <>Creates <strong className="t-num text-slate-900 dark:text-slate-100">{toCreate.toLocaleString()}</strong> rows and reuses <strong className="t-num text-slate-900 dark:text-slate-100">{toReuse.toLocaleString()}</strong> across {steps.length} steps. You will see the full list before it starts.</>
          : 'You will see what it creates before it starts.'}
      </p>
      <Button size="lg" className={cn('shrink-0', FOCUS_RING)} disabled={starting || setup.status !== 'validated'} onClick={apply}>
        <Play size={16} aria-hidden /> {starting ? 'Starting…' : 'Apply setup'}
      </Button>
    </div>
  );
}
