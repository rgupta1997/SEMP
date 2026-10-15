import { useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { SETUP_EVENT_TYPE_INFO, SETUP_EVENT_TYPES, type SetupEventType, type SetupSteps } from '@semp/shared';
import { Button, Card, toast } from '../../../components/ui';
import { downloadSetupWorkbook } from '../xlsx';
import { FOCUS_RING } from './pills';

/**
 * "Download template" and "Download sample" for one event type — or, given a setup,
 * for that setup's switches and named after it.
 */
export function TemplateButtons({ type, compact = false, forSetup }: {
  type: SetupEventType; compact?: boolean; forSetup?: { steps: SetupSteps; label: string };
}) {
  const [busy, setBusy] = useState<'template' | 'sample' | null>(null);

  const download = async (kind: 'template' | 'sample') => {
    setBusy(kind);
    try {
      await downloadSetupWorkbook(type, kind, forSetup);
    } catch (e) {
      toast.error(
        kind === 'template' ? 'Could not build the template' : 'Could not build the sample',
        (e as Error)?.message ?? 'Try again.',
      );
    } finally {
      setBusy(null);
    }
  };

  const label = SETUP_EVENT_TYPE_INFO[type]?.label ?? type;
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size={compact ? 'sm' : 'md'}
        className={FOCUS_RING}
        disabled={busy !== null}
        onClick={() => download('template')}
        aria-label={`Download blank template: ${label}`}
      >
        <Download size={14} aria-hidden />
        {busy === 'template' ? 'Preparing…' : 'Download template'}
      </Button>
      <Button
        variant="ghost"
        size={compact ? 'sm' : 'md'}
        className={FOCUS_RING}
        disabled={busy !== null}
        onClick={() => download('sample')}
        aria-label={`Download filled-in sample: ${label}`}
      >
        <FileSpreadsheet size={14} aria-hidden />
        {busy === 'sample' ? 'Preparing…' : 'Download sample'}
      </Button>
    </div>
  );
}

/** The three templates, one card per event type, at the top of the dashboard. */
export function TemplateStrip() {
  return (
    <section aria-labelledby="es-templates" className="flex flex-col gap-3">
      <div>
        <h2 id="es-templates" className="t-section text-slate-900 dark:text-slate-100">Templates</h2>
        <p className="t-meta mt-1 max-w-prose">
          Send the client the template for their kind of event. The sample is the same workbook filled in, for them to copy from.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {SETUP_EVENT_TYPES.map((type) => {
          const info = SETUP_EVENT_TYPE_INFO[type];
          return (
            <Card key={type} className="flex flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" aria-hidden>
                  <FileSpreadsheet size={18} />
                </span>
                <div className="min-w-0">
                  <h3 className="t-card-title text-slate-900 dark:text-slate-100">{info.label}</h3>
                  <p className="t-meta mt-0.5">Competes: {info.competitor}</p>
                </div>
              </div>
              <p className="t-body-sm flex-1 text-slate-600 dark:text-slate-300">{info.blurb}</p>
              <TemplateButtons type={type} compact />
            </Card>
          );
        })}
      </div>
    </section>
  );
}
