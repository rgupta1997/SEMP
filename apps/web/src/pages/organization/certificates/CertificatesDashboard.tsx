import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Award, FileText, LayoutTemplate, QrCode, ScanLine, Sparkles, Upload } from 'lucide-react';
import { useApi } from '../../../lib/hooks';
import { Button, Card, EmptyState, PageHeader, Skeleton, cn } from '../../../components/ui';
import { useWorkspace } from '../../../lib/useWorkspace';
import { GenerateModal } from './GenerateModal';
import { KpiTile, whenish, type Delta, type Template } from './shared';

// The Certificates Manager landing screen.
//
// It answers one question on arrival - "is there anything I need to do?" - and then
// gets out of the way. The register, the gallery and each certificate are their own
// screens, because they are their own jobs.

interface Overview {
  kpis: { issued: Delta; pending_generation: Delta; this_month: Delta; verification_scans: Delta };
  revoked: number;
  activity: Array<{ id: string; at: string; kind: string; title: string; detail: string | null; tone: string }>;
}

export function CertificatesDashboard() {
  const { orgId } = useParams();
  const ws = useWorkspace();
  const [gen, setGen] = useState(false);

  const overviewPath = orgId ? `/organizations/${orgId}/certificates/overview` : null;
  const templatesPath = orgId ? `/organizations/${orgId}/certificate-templates` : null;
  const overview = useApi<Overview>(overviewPath);
  const templates = useApi<{ rows: Template[] }>(templatesPath);

  const k = overview.data?.kpis;
  // The audit trail is a max-tier capability, so the link to it only appears when
  // it would open. A link that 403s is worse than no link.
  const canAudit = ws.granted.has('audit_logs');

  const actions = [
    { to: '#generate', icon: Sparkles, label: 'Generate certificates', hint: 'From a locked championship', onClick: () => setGen(true) },
    { to: `/organizations/${orgId}/students/import`, icon: Upload, label: 'Upload participants', hint: 'Import a roll on the Players page' },
    { to: `/organizations/${orgId}/certificates/templates`, icon: LayoutTemplate, label: 'Certificate templates', hint: `${templates.data?.rows.length ?? 0} in use` },
    { to: `/organizations/${orgId}/certificates/register`, icon: FileText, label: 'Issued register', hint: `${k?.issued.value ?? 0} issued` },
    { to: '/verify', icon: QrCode, label: 'QR verifier', hint: 'Check a certificate is real' },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Certificates"
        subtitle="Issue, withdraw and verify — every one carries a signature a stranger can check."
      >
        <Button variant="ghost" onClick={() => window.open('/verify', '_blank', 'noopener')}>
          <ScanLine size={15} aria-hidden />QR verifier
        </Button>
        <Button onClick={() => setGen(true)}>
          <Sparkles size={15} aria-hidden />Generate certificates
        </Button>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Issued certificates" kpi={k?.issued} />
        <KpiTile label="Pending generation" kpi={k?.pending_generation} tone="warning" note="Nothing waiting" />
        <KpiTile label="This month" kpi={k?.this_month} />
        <KpiTile label="Verification scans" kpi={k?.verification_scans} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Recent activity</h2>
            {canAudit && (
              <Link to={`/organizations/${orgId}/admin?tab=audit`} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                Full audit log
              </Link>
            )}
          </div>
          {overview.isLoading ? <Skeleton className="h-48" /> : (overview.data?.activity.length ?? 0) === 0 ? (
            <EmptyState
              icon={<Award size={28} />}
              title="Nothing has happened yet"
              description="Generated batches, withdrawals and QR scans all show up here as they occur."
            />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {overview.data!.activity.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                  <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                    a.tone === 'warning' ? 'bg-rose-500' : 'bg-emerald-500')} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm', a.tone === 'warning'
                      ? 'text-rose-700 dark:text-rose-300' : 'text-slate-800 dark:text-slate-200')}>{a.title}</p>
                    {a.detail && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{a.detail}</p>}
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-slate-400 dark:text-slate-500">{whenish(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="h-fit p-0">
          <div className="border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Quick actions</h2>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {actions.map((a) => {
              const Icon = a.icon;
              const inner = (
                <>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-400">
                    <Icon size={15} aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-200">{a.label}</span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{a.hint}</span>
                  </span>
                </>
              );
              const cls = 'flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60';
              return (
                <li key={a.label}>
                  {a.onClick
                    ? <button type="button" onClick={a.onClick} className={cls}>{inner}</button>
                    : <Link to={a.to} className={cls}>{inner}</Link>}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {gen && orgId && (
        <GenerateModal
          orgId={orgId} templates={templates.data?.rows ?? []}
          onClose={() => setGen(false)} invalidate={[overviewPath, templatesPath]}
        />
      )}
    </div>
  );
}
