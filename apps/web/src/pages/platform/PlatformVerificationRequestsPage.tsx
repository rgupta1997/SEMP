import { useState } from 'react';
import { BadgeCheck, Building2, ExternalLink } from 'lucide-react';
import { ORG_VERIFICATION_STATUS, type OrgVerificationStatus } from '@semp/shared';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime, useApi, useApiMutation, useTableControls } from '../../lib/hooks';
import {
  Badge, Button, Card, EmptyState, Field, FilterChips, Modal, Pagination, SearchInput, Spinner,
  Textarea, confirmDialog, toast,
} from '../../components/ui';

// Platform → Verification Requests.
//
// The other end of Administration → Organization Profile → "Request verification".
// An institution submits the details, this is where a super admin reads them and
// answers, and approving is what sets `organizations.verified` - the tick.
//
// Modelled on the demo-requests and feedback queues so the three platform triage
// screens behave the same way. One thing is deliberately different: a status
// dropdown would be wrong here. Approving grants a trust signal that appears beside
// the institution's name everywhere in the product, and refusing has to say why, so
// each is an explicit decision with its own confirmation rather than a select that
// fires on change.

interface VerificationRequest {
  id: string;
  status: OrgVerificationStatus;
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  contact_name: string;
  contact_role: string | null;
  contact_email: string;
  contact_phone: string | null;
  registered_name: string | null;
  registration_id: string | null;
  website: string | null;
  address: string | null;
  document_url: string | null;
  note: string | null;
  organizations?: {
    id: string; name: string; short_name: string | null; kind: string;
    city: string | null; country: string | null; code: string | null;
    verified: boolean; created_at: string;
  } | null;
  users_org_verification_requests_submitted_byTousers?: { id: string; name: string; email: string } | null;
  users_org_verification_requests_reviewed_byTousers?: { id: string; name: string } | null;
}

const STATUS_TONE: Record<OrgVerificationStatus, 'amber' | 'green' | 'rose' | 'slate'> = {
  pending: 'amber', approved: 'green', rejected: 'rose', withdrawn: 'slate',
};

/** A label/value pair, omitted entirely when there is no value. */
function Detail({ label, value, href }: { label: string; value?: string | null; href?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{label}</div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-0.5 inline-flex items-center gap-1 text-sm text-brand-600 hover:underline dark:text-brand-400"
        >
          {value}<ExternalLink size={12} />
        </a>
      ) : (
        <div className="mt-0.5 break-words text-sm text-slate-800 dark:text-slate-200">{value}</div>
      )}
    </div>
  );
}

/** A URL the reviewer can safely click. Anything else is shown as plain text. */
const asHref = (v?: string | null) =>
  v && /^https?:\/\//i.test(v.trim()) ? v.trim() : v ? `https://${v.trim()}` : null;

/**
 * The rejection note.
 *
 * A modal rather than a prompt, because the note is shown to the organisation and
 * becomes the only thing on their screen telling them what to fix. The API requires
 * it for a rejection for the same reason.
 */
function RejectModal({ request, onClose }: { request: VerificationRequest; onClose: () => void }) {
  const [note, setNote] = useState('');
  const name = request.organizations?.name ?? 'this organisation';
  // Invalidating '/verification-requests' is what refreshes the queue behind the
  // modal - the same key the approve mutation uses, so both decisions land the same
  // way rather than one of them needing a manual reload.
  const reject = useApiMutation(
    (review_note: string) => api('POST', `/verification-requests/${request.id}/review`, { status: 'rejected', review_note }),
    ['/verification-requests'],
    () => { toast.success('Request refused'); onClose(); },
  );

  const submit = () => reject.mutate(note.trim(), { onError: (e: any) => toast.error(e.message) });

  return (
    <Modal
      title="Refuse verification"
      onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={submit} disabled={!note.trim() || reject.isPending}>
            {reject.isPending ? 'Sending…' : 'Refuse request'}
          </Button>
        </div>
      )}
    >
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        {name} keeps everything it has - verification is a trust signal, not a gate.
        They will be told why and can submit a new request.
      </p>
      <Field label="Reason *" hint="Shown to the organisation's owners and administrators.">
        <Textarea
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. The registration number does not match the name given. Please resubmit with the certificate of registration."
        />
      </Field>
    </Modal>
  );
}

export function PlatformVerificationRequestsPage() {
  const { data: requests = [], isLoading } = useApi<VerificationRequest[]>('/verification-requests');
  const [filter, setFilter] = useState<'open' | OrgVerificationStatus>('open');
  const [rejecting, setRejecting] = useState<VerificationRequest | null>(null);

  const approve = useApiMutation(
    (id: string) => api('POST', `/verification-requests/${id}/review`, { status: 'approved' }),
    ['/verification-requests'],
  );

  const rows = requests.filter((r) => (filter === 'open' ? r.status === 'pending' : r.status === filter));

  const t = useTableControls(rows, {
    search: (r) => [
      r.organizations?.name, r.organizations?.city, r.organizations?.code,
      r.registered_name, r.registration_id, r.contact_name, r.contact_email,
    ].filter(Boolean).join(' '),
    sorts: { received: (a, b) => +new Date(a.created_at) - +new Date(b.created_at) },
    initialSort: 'received',
    initialDir: 'desc',
    pageSize: 10,
  });

  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>;

  const open = requests.filter((r) => r.status === 'pending').length;

  async function handleApprove(r: VerificationRequest) {
    const ok = await confirmDialog({
      title: 'Verify this organisation?',
      message: `“${r.organizations?.name ?? 'This organisation'}” will carry the verification tick everywhere it appears. Its administrators are notified.`,
      confirmLabel: 'Verify organisation',
    });
    if (ok) approve.mutate(r.id);
  }

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Institutions asking to be verified, submitted from Administration → Organization
        Profile. Approving sets the tick; refusing takes nothing away and has to say why.
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold dark:text-slate-100">
          Verification requests
          {open > 0 && <Badge tone="amber" className="ml-2">{open} waiting</Badge>}
        </h2>
        <SearchInput value={t.query} onChange={t.setQuery} placeholder="Search institutions…" className="w-56" />
      </div>

      <FilterChips
        className="mb-4"
        value={filter}
        onChange={setFilter}
        options={[
          { key: 'open' as const, label: 'Waiting', count: open },
          ...ORG_VERIFICATION_STATUS.map((s) => ({
            key: s, label: s, count: requests.filter((r) => r.status === s).length,
          })),
        ]}
      />

      {t.total === 0 ? (
        <EmptyState
          icon={<BadgeCheck size={32} />}
          title={filter === 'open' ? 'Nothing waiting' : 'Nothing here'}
          description="Requests submitted from an organisation's Administration screen appear here."
        />
      ) : (
        <>
          {/* Cards, not a table. A reviewer has to read nine fields and follow a link
              before deciding, and a row that has to be expanded to be readable is a
              row that gets approved without being read. */}
          <div className="flex flex-col gap-3">
            {t.view.map((r) => {
              const org = r.organizations;
              return (
                <Card key={r.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[240px]">
                      <div className="flex items-center gap-2">
                        <Building2 size={16} className="text-slate-400" />
                        <span className="font-semibold text-slate-800 dark:text-slate-100">{org?.name ?? 'Unknown organisation'}</span>
                        {org?.verified && <Badge tone="green">already verified</Badge>}
                        <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {[org?.kind, org?.city, org?.country, org?.code && `code ${org.code}`].filter(Boolean).join(' · ')}
                        {org?.created_at && ` · on Sportagon since ${fmtDate(org.created_at)}`}
                      </div>
                    </div>

                    {r.status === 'pending' && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setRejecting(r)}>Refuse</Button>
                        <Button size="sm" onClick={() => handleApprove(r)} disabled={approve.isPending}>Verify</Button>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 dark:border-slate-800 sm:grid-cols-2 lg:grid-cols-3">
                    <Detail label="Authorised contact" value={[r.contact_name, r.contact_role].filter(Boolean).join(' · ')} />
                    <Detail label="Email" value={r.contact_email} />
                    <Detail label="Phone" value={r.contact_phone} />
                    <Detail label="Registered name" value={r.registered_name} />
                    <Detail label="Registration no." value={r.registration_id} />
                    <Detail label="Website" value={r.website} href={asHref(r.website)} />
                    <Detail label="Document" value={r.document_url} href={asHref(r.document_url)} />
                    <Detail label="Address" value={r.address} />
                    <Detail label="Note" value={r.note} />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2.5 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
                    <span>Submitted {fmtDateTime(r.created_at)}</span>
                    {r.users_org_verification_requests_submitted_byTousers && (
                      <span>by {r.users_org_verification_requests_submitted_byTousers.name}</span>
                    )}
                    {r.reviewed_at && (
                      <span>
                        {r.status} {fmtDateTime(r.reviewed_at)}
                        {r.users_org_verification_requests_reviewed_byTousers
                          && ` by ${r.users_org_verification_requests_reviewed_byTousers.name}`}
                      </span>
                    )}
                  </div>

                  {r.review_note && (
                    <p className="mt-2 rounded-xl bg-slate-50 p-2.5 text-[12.5px] italic leading-relaxed text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                      “{r.review_note}”
                    </p>
                  )}
                </Card>
              );
            })}
          </div>

          <div className="mt-3">
            <Pagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} />
          </div>
        </>
      )}

      {rejecting && (
        <RejectModal request={rejecting} onClose={() => setRejecting(null)} />
      )}
    </div>
  );
}
