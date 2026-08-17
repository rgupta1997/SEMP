import { Link, useParams } from 'react-router-dom';
import { CalendarClock, Download, ExternalLink, RefreshCw, Share2, ShieldOff } from 'lucide-react';
import { useApi, useApiMutation } from '../../../lib/hooks';
import { api } from '../../../lib/api';
import { BackButton, Button, Card, PageHeader, Skeleton, cn, confirmDialog, toast } from '../../../components/ui';
import { CertStatus, SheetPreview, openDoc, shortDate, whenish, type Cert } from './shared';

// One certificate, end to end: what it says, what happened to it, and what can be done
// about it. The audit trail is the reason this screen exists - "is this real?" is
// answered by the verifier, but "what happened here?" is only answerable from history.

interface Detail extends Cert {
  organization_id: string;
  organizations: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  issued_by_name: string | null;
  verify_url: string;
  signature: string;
  lock_version: number | null;
  trail: Array<{ at: string; label: string; detail: string; tone?: string }>;
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-4 py-2">
    <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="min-w-0 text-right text-sm text-slate-800 dark:text-slate-200">{children}</dd>
  </div>
);

export function CertificateDetailPage() {
  const { orgId, certId } = useParams();
  const path = certId ? `/certificates/${certId}` : null;
  const { data: c, isLoading } = useApi<Detail>(path);

  const revoke = useApiMutation(
    (body: { reason: string }) => api('POST', `/certificates/${certId}/revoke`, body),
    [path, orgId ? `/organizations/${orgId}/certificates` : null],
  );

  const onRevoke = async () => {
    if (!c) return;
    const ok = await confirmDialog({
      title: `Withdraw ${c.serial}?`,
      // The consequence, stated plainly - this is the point of the confirmation.
      message: 'It will stop verifying immediately for anyone who scans it. The record of it being issued is kept, so the register stays complete.',
      confirmLabel: 'Withdraw',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await revoke.mutateAsync({ reason: 'Withdrawn from the certificates register' });
      toast.success(`${c.serial} withdrawn`);
    } catch (e: any) { toast.error('Could not withdraw it', e?.message); }
  };

  const onShare = async () => {
    if (!c) return;
    // The public verify link, not a link into the admin area: sharing a certificate
    // means letting somebody else check it, and they will not have an account.
    try {
      await navigator.clipboard.writeText(c.verify_url);
      toast.success('Verification link copied', 'Anyone can open it — no account needed.');
    } catch { toast.error('Could not copy the link', c.verify_url); }
  };

  if (isLoading) return <Skeleton className="h-96" />;
  if (!c) return null;

  const dead = c.status === 'withdrawn' || c.status === 'superseded';

  const actions = [
    { label: 'Download certificate', icon: Download, onClick: () => openDoc(`/certificates/${c.id}/render?download=1`, { download: `${c.serial}.html` }) },
    { label: 'Share certificate', icon: Share2, onClick: onShare },
    { label: 'Open verification page', icon: ExternalLink, onClick: () => window.open(`/verify/${c.token}`, '_blank', 'noopener') },
    // Re-running generation is how a corrected result gets a fresh certificate; there
    // is deliberately no "edit" - a certificate whose text can be typed over is not
    // evidence of anything.
    { label: 'Regenerate from result', icon: RefreshCw, to: `/organizations/${orgId}/certificates/register`, hint: 'Withdraw this one first, then run generation again' },
    ...(c.championships ? [{ label: 'View event context', icon: CalendarClock, to: `/championships/${c.championships.id}` }] : []),
  ];

  return (
    <div className="grid gap-5">
      <BackButton to={`/organizations/${orgId}/certificates/register`}>Back to register</BackButton>
      <PageHeader title={c.recipient_name} subtitle={<span className="font-mono text-xs">{c.serial}</span>}>
        <CertStatus status={c.status} />
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="grid gap-5">
          <Card className="grid place-items-center overflow-x-auto p-4">
            <SheetPreview path={`/certificates/${c.id}/render`} width={640} />
          </Card>

          <Card className="p-0">
            <div className="border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Audit trail</h2>
            </div>
            <ol className="grid gap-0 px-4 py-3">
              {c.trail.map((t, i) => (
                <li key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      t.tone === 'warning' ? 'bg-rose-500' : 'bg-emerald-500')} aria-hidden />
                    {i < c.trail.length - 1 && <span className="w-px flex-1 bg-slate-200 dark:bg-slate-700" aria-hidden />}
                  </div>
                  <div className="pb-4">
                    <p className={cn('text-sm font-medium', t.tone === 'warning'
                      ? 'text-rose-700 dark:text-rose-300' : 'text-slate-800 dark:text-slate-200')}>{t.label}</p>
                    {t.detail && <p className="text-xs text-slate-500 dark:text-slate-400">{t.detail}</p>}
                    <p className="text-xs tabular-nums text-slate-400 dark:text-slate-500">
                      {new Date(t.at).toLocaleString()} · {whenish(t.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="grid h-fit gap-5">
          <Card className="p-0">
            <div className="border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Certificate information</h2>
            </div>
            <dl className="divide-y divide-slate-100 px-4 py-1 dark:divide-slate-800">
              <Row label="Certificate ID"><span className="font-mono text-xs">{c.serial}</span></Row>
              <Row label="Type">{c.certificate_templates?.name ?? 'Default'}</Row>
              <Row label="Recipient">{c.recipient_name}</Row>
              <Row label="Team">{c.team?.name ?? '—'}</Row>
              <Row label="Event">
                {c.championships
                  ? <Link to={`/championships/${c.championships.id}`} className="text-brand-600 hover:underline dark:text-brand-400">{c.championships.name}</Link>
                  : '—'}
              </Row>
              <Row label="Sport">{c.sport ?? '—'}</Row>
              <Row label="Achievement">{c.title ?? '—'}</Row>
              <Row label="Issue date">{shortDate(c.issued_at)}</Row>
              <Row label="Issued by">{c.issued_by_name ?? 'System'}</Row>
              <Row label="Status"><CertStatus status={c.status} /></Row>
              <Row label="Verification scans"><span className="tabular-nums">{c.scans}</span></Row>
              {/* The signature prefix, so somebody comparing two copies of the same
                  document can see at a glance whether they are the same certificate. */}
              <Row label="Signature"><span className="font-mono text-[11px] text-slate-500">{c.signature.slice(0, 16)}…</span></Row>
              {c.revoked_reason && <Row label="Withdrawn because"><span className="text-rose-700 dark:text-rose-300">{c.revoked_reason}</span></Row>}
            </dl>
          </Card>

          <Card className="p-0">
            <div className="border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Actions</h2>
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {actions.map((a) => {
                const Icon = a.icon;
                const inner = (
                  <>
                    <Icon size={15} aria-hidden className="shrink-0 text-slate-400" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-800 dark:text-slate-200">{a.label}</span>
                      {'hint' in a && a.hint && <span className="block text-xs text-slate-500 dark:text-slate-400">{a.hint}</span>}
                    </span>
                  </>
                );
                const cls = 'flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60';
                return (
                  <li key={a.label}>
                    {'to' in a && a.to
                      ? <Link to={a.to} className={cls}>{inner}</Link>
                      : <button type="button" onClick={(a as any).onClick} className={cls}>{inner}</button>}
                  </li>
                );
              })}
              <li>
                <button
                  type="button" onClick={onRevoke} disabled={dead || revoke.isPending}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:text-rose-400 dark:hover:bg-rose-950/30"
                >
                  <ShieldOff size={15} aria-hidden className="shrink-0" />
                  <span className="text-sm">{dead ? 'Already withdrawn' : 'Withdraw certificate'}</span>
                </button>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
