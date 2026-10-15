import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Building2, CircleAlert, CircleCheck, KeyRound, Phone, ShieldCheck, Trophy, Undo2,
} from 'lucide-react';
import { Button, Card, cn, Progress, toast } from '../../../components/ui';
import { fmtDateTime } from '../../../lib/hooks';
import { eventSetupApi, useSetupCache } from '../api';
import { credentialsCsvRows, downloadCsv, slug } from '../csv';
import { contactProgress } from '../status';
import type { EventSetupDetail } from '../types';
import { Banner, FOCUS_RING } from './pills';
import { useUndoSetup } from './useUndoSetup';

function Panel({ icon, title, children, className }: { icon: ReactNode; title: string; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('flex min-w-0 flex-col gap-3 p-4', className)}>
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
        <span className="text-slate-400" aria-hidden>{icon}</span>{title}
      </h3>
      {children}
    </Card>
  );
}

const LINK = cn(
  'inline-flex min-h-[44px] max-w-full min-w-0 items-center gap-2 rounded-lg border border-eos-line bg-white px-3.5 text-sm font-semibold text-slate-800 transition-colors hover:border-brand-300 hover:text-brand-700 sm:min-h-[40px]',
  'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-brand-500/50 dark:hover:text-brand-300',
  FOCUS_RING,
);

/** Section f: verify, hand over the logins, follow registration day, and undo. */
export function AfterApplyPanel({ setup }: { setup: EventSetupDetail }) {
  const { put, refresh } = useSetupCache();
  const [busy, setBusy] = useState<'verify' | 'credentials' | null>(null);
  const { undo, undoing } = useUndoSetup(setup);

  if (setup.status === 'undone') {
    return (
      <Banner tone="slate" icon={<Undo2 size={20} />} title="This setup was undone">
        Everything the run created was removed. Upload the workbook again to start over, or delete this setup.
      </Banner>
    );
  }

  const verify = async () => {
    setBusy('verify');
    try {
      const d = await eventSetupApi.verify(setup.id);
      put(d);
      const failures = d.verify_report?.failures?.length ?? 0;
      if (failures) toast.warning(`${failures} ${failures === 1 ? 'check' : 'checks'} failed`, 'The list is in the Verify panel.');
      else toast.success('Verified', 'What is on the platform matches the workbook.');
    } catch (e) {
      toast.error('Could not verify', (e as Error)?.message ?? 'Try again.');
      refresh(setup.id);
    } finally {
      setBusy(null);
    }
  };

  const credentials = async () => {
    setBusy('credentials');
    try {
      const { rows } = await eventSetupApi.credentials(setup.id);
      if (!rows?.length) { toast.info('No logins to download', 'This run created no accounts.'); return; }
      downloadCsv(`credentials-${slug(setup.label)}.csv`, credentialsCsvRows(rows));
      toast.success(`Downloaded ${rows.length.toLocaleString()} logins`, 'The file holds passwords: share it only with the organiser.');
    } catch (e) {
      toast.error('Could not download the credentials', (e as Error)?.message ?? 'Try again.');
    } finally {
      setBusy(null);
    }
  };

  const locked = busy !== null || undoing;
  const vr = setup.verify_report;
  const failures = vr?.failures ?? [];
  const credCount = setup.credentials_count ?? 0;
  const cp = contactProgress(setup.contacts);

  return (
    <div className="flex flex-col gap-3">
      {(setup.championship_id || setup.organization_id) && (
        <div className="flex flex-wrap gap-2">
          {setup.championship_id && (
            <Link to={`/championships/${setup.championship_id}`} className={LINK}>
              <Trophy size={15} className="shrink-0" aria-hidden />
              <span className="truncate">{setup.championship_name ?? 'Open the championship'}</span>
              <ArrowRight size={14} className="shrink-0" aria-hidden />
            </Link>
          )}
          {setup.organization_id && (
            <Link to={`/organizations/${setup.organization_id}/overview`} className={LINK}>
              <Building2 size={15} className="shrink-0" aria-hidden />
              <span className="truncate">{setup.org_name ?? 'Open the organisation'}</span>
              <ArrowRight size={14} className="shrink-0" aria-hidden />
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel icon={<ShieldCheck size={16} />} title="Verify">
          <p className="t-meta">Reads the event back from the platform and checks it against the workbook.</p>
          {vr && (
            failures.length === 0 ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                <CircleCheck size={16} aria-hidden />
                {(vr.checked ?? 0) > 0
                  ? `All ${(vr.checked ?? 0).toLocaleString()} checks passed`
                  // Fixtures skipped, or a generated draw with no sheet times: verify checks
                  // scheduled matches against the sheet, so there is nothing to compare.
                  : 'Nothing to check: this setup has no scheduled matches from the sheet'}
                <span className="t-meta font-normal">· {fmtDateTime(vr.at)}</span>
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-rose-700 dark:text-rose-400">
                  <CircleAlert size={16} aria-hidden /> {failures.length} of {(vr.checked ?? 0).toLocaleString()} checks failed
                  <span className="t-meta font-normal">· {fmtDateTime(vr.at)}</span>
                </p>
                <ul className="max-h-56 list-disc overflow-auto rounded-lg bg-rose-50 py-2 pl-7 pr-3 text-[13px] text-rose-900 dark:bg-rose-500/10 dark:text-rose-200">
                  {failures.map((f, i) => <li key={i} className="py-0.5 [overflow-wrap:anywhere]">{f}</li>)}
                </ul>
              </div>
            )
          )}
          <div>
            <Button variant={vr ? 'outline' : 'primary'} size="sm" className={FOCUS_RING} disabled={locked} onClick={verify}>
              <ShieldCheck size={13} aria-hidden /> {busy === 'verify' ? 'Verifying…' : vr ? 'Verify again' : 'Verify'}
            </Button>
          </div>
        </Panel>

        <Panel icon={<KeyRound size={16} />} title="Credentials">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            <strong className="t-num text-slate-900 dark:text-slate-100">{credCount.toLocaleString()}</strong>{' '}
            {credCount === 1 ? 'login' : 'logins'} created by this run.
          </p>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            The file contains passwords. Send it only to the organiser, over a private channel, and delete it after registration day.
          </p>
          <div>
            <Button variant="outline" size="sm" className={FOCUS_RING} disabled={locked || credCount === 0} onClick={credentials}>
              <KeyRound size={13} aria-hidden /> {busy === 'credentials' ? 'Preparing…' : 'Download credentials (.csv)'}
            </Button>
          </div>
        </Panel>

        <Panel icon={<Phone size={16} />} title="Registration day">
          {cp ? (
            <>
              <p className="text-sm text-slate-700 dark:text-slate-300">
                {cp.outstanding > 0
                  ? <><strong className="t-num text-amber-700 dark:text-amber-300">{cp.outstanding.toLocaleString()}</strong> of the {cp.of.toLocaleString()} accounts this run created are still on a placeholder contact.</>
                  : `All ${cp.of.toLocaleString()} accounts this run created have a real contact.`}
              </p>
              {cp.of > 0 && (
                <Progress
                  value={cp.done}
                  max={cp.of}
                  tone={cp.outstanding ? 'amber' : 'green'}
                  label={`${cp.done.toLocaleString()} of ${cp.of.toLocaleString()} have a real contact`}
                />
              )}
            </>
          ) : (
            <p className="t-meta">This run created no accounts, so there are no contacts to collect.</p>
          )}
          <p className="t-meta">
            Collect real mobiles and emails at the desk, then enter them in All Users with <em>Only placeholder contacts</em> ticked.
          </p>
          <div>
            <Link to="/platform/users" className={cn(LINK, 'min-h-[36px] px-3 text-xs sm:min-h-[32px]')}>
              Open All Users <ArrowRight size={13} aria-hidden />
            </Link>
          </div>
        </Panel>

        <Panel icon={<Undo2 size={16} />} title="Undo" className="border-rose-200 dark:border-rose-500/30">
          <p className="t-meta">
            Removes everything this run created and keeps what it reused. Refused once any match has been played.
          </p>
          <div>
            <Button variant="danger" size="sm" className={FOCUS_RING} disabled={locked} onClick={undo}>
              <Undo2 size={13} aria-hidden /> {undoing ? 'Undoing…' : 'Undo setup'}
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
