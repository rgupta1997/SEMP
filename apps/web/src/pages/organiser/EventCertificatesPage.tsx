import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, Lock, ShieldOff } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { GenerateModal } from '../organization/certificates/GenerateModal';
import type { Template } from '../organization/certificates/shared';
import { Badge, Button, EmptyState, PageHeader, Spinner, SURFACE} from '../../components/ui';
import { useEvent } from './EventLayout';

// Certificates for one event.
//
// Certificates are ISSUED BY an organisation, not by an event - the signature on
// one is an institution's, and a stranger checking it is checking that institution.
// So this page is the event's view onto its host organisation's register, filtered
// to this event, rather than a second issuing system.
//
// When an event has no host organisation - an individual running a local fixture -
// the page says so plainly instead of offering a button that cannot work.

interface Cert {
  id: string; serial: string; recipient_name: string;
  issued_at: string; revoked_at: string | null; superseded_at: string | null;
}

export function EventCertificatesPage() {
  const { championship, eventId, canManage } = useEvent();
  const host = (championship as any).host_organization as { id: string; name: string } | null;
  const [generating, setGenerating] = useState(false);

  const listPath = host ? `/organizations/${host.id}/certificates?championship_id=${eventId}` : null;
  const { data, isLoading, error } = useApi<{ rows: Cert[] } | Cert[]>(listPath);
  // Fetched only once the generate dialog is open. Asking earlier is a request that
  // can only fail for anybody who is not an issuer here, which is most organisers.
  const templates = useApi<{ rows: Template[] }>(
    host && generating ? `/organizations/${host.id}/certificate-templates` : null,
  );

  const rows: Cert[] = Array.isArray(data) ? data : data?.rows ?? [];
  // Organising an event and administering the institution behind it are different
  // jobs, and often different people. The register belongs to the institution, so
  // an organiser without standing there is told whose permission they need rather
  // than shown an empty table that looks like "nothing issued".
  const notIssuer = (error as any)?.status === 403;

  if (!host) {
    return (
      <div className="pb-16">
        <PageHeader title="Certificates" />
        <EmptyState
          icon={<ShieldOff size={24} />}
          title="This event has no issuing organisation"
          description="A certificate carries an institution's signature, so one has to be behind it. Set a host organisation for this event in Settings, and certificates can be generated from its locked results."
        />
      </div>
    );
  }

  if (isLoading) return <Spinner />;

  if (notIssuer) {
    return (
      <div className="pb-16">
        <PageHeader title="Certificates" subtitle={`Issued by ${host.name}.`} />
        <EmptyState
          icon={<Lock size={24} />}
          title="You cannot see this institution's register"
          description={`Certificates for this event carry ${host.name}'s signature, so they are issued and read inside that organisation. Ask an owner or administrator there for permission to issue certificates.`}
        />
      </div>
    );
  }

  return (
    <div className="pb-16">
      <PageHeader
        title="Certificates"
        subtitle={`Issued by ${host.name}, from this event's locked results.`}
      >
        <Link
          to={`/organizations/${host.id}/certificates/register`}
          className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400"
        >
          Full register →
        </Link>
        {canManage && (
          <Button onClick={() => setGenerating(true)}>
            <Award size={15} aria-hidden />Generate certificates
          </Button>
        )}
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Award size={24} />}
          title="Nothing issued for this event yet"
          description="Certificates are generated from locked results — never typed in by hand. Lock a scorecard and the medals, placements and awards behind it become issuable."
          action={canManage ? <Button onClick={() => setGenerating(true)}>Generate certificates</Button> : undefined}
        />
      ) : (
        <div className={`overflow-x-auto ${SURFACE}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left font-mono text-[9px] uppercase tracking-[0.13em] text-slate-500 dark:border-slate-800">
                <th className="px-4 py-3">Recipient</th>
                <th className="px-4 py-3">Serial</th>
                <th className="px-4 py-3">Issued</th>
                <th className="px-4 py-3">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="px-4 py-3">
                    <Link
                      to={`/organizations/${host.id}/certificates/${c.id}`}
                      className="font-semibold text-slate-900 hover:text-brand-600 dark:text-slate-100"
                    >
                      {c.recipient_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-slate-600 dark:text-slate-300">{c.serial}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {new Date(c.issued_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={c.revoked_at ? 'rose' : c.superseded_at ? 'amber' : 'green'}>
                      {c.revoked_at ? 'withdrawn' : c.superseded_at ? 'superseded' : 'live'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {generating && (
        <GenerateModal
          orgId={host.id}
          championship={{ id: eventId, name: championship.name }}
          templates={templates.data?.rows ?? []}
          onClose={() => setGenerating(false)}
          invalidate={[listPath]}
        />
      )}
    </div>
  );
}
