import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw, Trash2, Upload } from 'lucide-react';
import { SETUP_DEFAULT_STEPS, SETUP_EVENT_TYPE_INFO } from '@semp/shared';
import { BackButton, Button, Card, confirmDialog, PageHeader, Skeleton, toast } from '../../components/ui';
import { QueryState } from '../../components/primitives';
import { fmtDateTime } from '../../lib/hooks';
import { eventSetupApi, useEventSetup, useSetupCache } from '../../features/event-setup/api';
import { AfterApplyPanel } from '../../features/event-setup/components/AfterApplyPanel';
import { ApplyPanel } from '../../features/event-setup/components/ApplyPanel';
import { FOCUS_RING, StatusPill, TypeChip } from '../../features/event-setup/components/pills';
import { StepModesEditor } from '../../features/event-setup/components/StepModesEditor';
import { StepSection } from '../../features/event-setup/components/StepSection';
import { TemplateButtons } from '../../features/event-setup/components/TemplateDownloads';
import { ValidationResults } from '../../features/event-setup/components/ValidationResults';
import { WorkbookUpload } from '../../features/event-setup/components/WorkbookUpload';
import { canDelete, canEditSteps, canUpload, isStaleApplying, sectionStates } from '../../features/event-setup/status';
import type { EventSetupDetail, ReadWorkbook } from '../../features/event-setup/types';

// One event setup, walked top to bottom: the template, what to build, the upload,
// how well it was filled in, the run, and everything after it.

export function EventSetupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useEventSetup(id);

  return (
    <div>
      <BackButton to="/platform/event-setup">Event Setup</BackButton>
      <QueryState
        query={query}
        errorTitle="Could not load this setup"
        skeleton={(
          <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-80" />
            <Skeleton className="mt-4 h-40 w-full" rounded="rounded-card" />
            <Skeleton className="h-40 w-full" rounded="rounded-card" />
          </div>
        )}
      >
        {/* Keyed, so local state (a workbook read in this visit) never carries over to another setup. */}
        {query.data && <SetupDetail key={query.data.id} setup={query.data} />}
      </QueryState>
    </div>
  );
}

function SetupDetail({ setup }: { setup: EventSetupDetail }) {
  const navigate = useNavigate();
  const { forget } = useSetupCache();
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadSection = useRef<HTMLLIElement>(null);
  const [workbook, setWorkbook] = useState<ReadWorkbook | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Say so when a run the admin started finishes, even if they scrolled away from
  // the Apply section to read something else while it ran.
  const lastStatus = useRef(setup.status);
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = setup.status;
    if (was !== 'applying') return;
    if (setup.status === 'applied') toast.success('Applied', 'The event is on the platform. Verify it next.');
    else if (setup.status === 'failed') toast.error('The run stopped part-way', setup.error ?? undefined);
  }, [setup.status, setup.error]);

  // A clock, while a run is live: "stuck" is a matter of time passing, and a poll
  // that keeps returning the same row re-renders nothing by itself.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (setup.status !== 'applying') return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [setup.status]);

  const states = sectionStates(setup);
  const type = setup.event_type;
  const info = SETUP_EVENT_TYPE_INFO[type];
  const stale = isStaleApplying(setup, now);
  const uploadable = canUpload(setup, now);

  const revalidate = () => {
    if (!uploadable) return;
    uploadSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Synchronously inside the click, or the browser refuses to open the picker.
    fileInput.current?.click();
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete "${setup.label}"?`,
      message: 'The setup, its validation and its history are removed. Nothing on the platform is touched.',
      confirmLabel: 'Delete setup',
      tone: 'danger',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await eventSetupApi.remove(setup.id);
      toast.success('Setup deleted');
      // Leave first, then drop the cache entry, so this page never refetches a
      // setup that no longer exists and flashes an error on the way out.
      navigate('/platform/event-setup');
      forget(setup.id);
    } catch (e) {
      toast.error('Could not delete', (e as Error)?.message ?? 'Try again.');
      setDeleting(false);
    }
  };

  const applyLockedHint =
    setup.status === 'invalid' ? 'Fix the errors and validate the workbook again first.'
      : setup.status === 'undone' ? 'This setup was undone. Validate the workbook again to apply it.'
        : 'Validate a workbook with no errors first.';

  return (
    <div>
      <PageHeader
        title={setup.label}
        subtitle={(
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <TypeChip type={type} />
            <StatusPill status={setup.status} />
            <span>
              {setup.created_by_name ? `Started by ${setup.created_by_name} · ` : ''}updated {fmtDateTime(setup.updated_at)}
            </span>
          </span>
        )}
      >
        {uploadable && (
          <Button variant="outline" className={FOCUS_RING} onClick={revalidate}>
            {setup.file_name ? <RefreshCw size={14} aria-hidden /> : <Upload size={14} aria-hidden />}
            {setup.file_name ? 'Re-validate' : 'Upload workbook'}
          </Button>
        )}
        {canDelete(setup.status) && (
          <Button variant="ghost" className={FOCUS_RING} disabled={deleting} onClick={remove} aria-label="Delete setup">
            <Trash2 size={14} aria-hidden /> <span className="hidden sm:inline">Delete</span>
          </Button>
        )}
      </PageHeader>

      <ol className="mx-auto flex max-w-5xl flex-col">
        <StepSection
          n={1} id="es-steps" title="What to build" state={states.steps}
          description="For each step: build it from the workbook, use what is already on the platform, or leave it alone."
        >
          <StepModesEditor
            setupId={setup.id}
            type={type}
            steps={{ ...SETUP_DEFAULT_STEPS[type], ...setup.steps }}
            editable={canEditSteps(setup, now)}
            validated={!!setup.validation}
          />
        </StepSection>

        <StepSection
          n={2} id="es-template" title="Template" state={states.template}
          description="The workbook the client fills in, built for the switches above: a skipped step leaves out its sheet or columns. Changed a switch? Download it again before sending it."
        >
          <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="t-card-title text-slate-900 dark:text-slate-100">{info?.label ?? type}</div>
              <p className="t-meta mt-0.5">{info?.blurb} The type is fixed for this setup.</p>
            </div>
            <div className="shrink-0">
              <TemplateButtons type={type} compact forSetup={{ steps: { ...SETUP_DEFAULT_STEPS[type], ...setup.steps }, label: setup.label }} />
            </div>
          </Card>
        </StepSection>

        <StepSection
          ref={uploadSection}
          n={3} id="es-upload" title="Upload & validate" state={states.upload}
          description="Upload the workbook the client sent back. Every sheet is read and checked; nothing is written to the platform yet."
        >
          <WorkbookUpload
            ref={fileInput}
            setupId={setup.id}
            enabled={uploadable}
            lastFileName={setup.file_name}
            workbook={workbook}
            onWorkbook={setWorkbook}
          />
        </StepSection>

        <StepSection
          n={4} id="es-results" title="Validation" state={states.results}
          description="How well the workbook was filled in, and what the run would find and create."
          lockedHint="Upload the filled-in workbook to see how well it was filled in."
        >
          <ValidationResults setup={setup} />
        </StepSection>

        <StepSection
          n={5} id="es-apply" title="Apply" state={states.apply}
          description="Build the event on the platform from the validated workbook."
          lockedHint={applyLockedHint}
        >
          <ApplyPanel setup={setup} stale={stale} onRevalidate={revalidate} />
        </StepSection>

        <StepSection
          n={6} id="es-after" title="After apply" state={states.after} last
          description="Check the result, hand over the logins, follow registration day, or take it all back."
          lockedHint="Once applied: verify the event, download the logins and follow registration day from here."
        >
          <AfterApplyPanel setup={setup} />
        </StepSection>
      </ol>
    </div>
  );
}
