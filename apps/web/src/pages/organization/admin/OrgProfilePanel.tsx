import { useState } from 'react';
import { Check, Clock, ShieldCheck, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { OrgVerificationStatus } from '@semp/shared';
import { fmtDate, useApi } from '../../../lib/hooks';
import { useAuth } from '../../../lib/auth';
import { usePermissions } from '../../../lib/permissions';
import { api } from '../../../lib/api';
import { InstitutionFormModal, type InstitutionFormBody } from '../../../components/InstitutionFormModal';
import {
  Badge, Button, Card, CardBody, Field, Input, Modal, Spinner, Textarea, confirmDialog, toast,
} from '../../../components/ui';

// Admin > Organization Profile (PG-28a).
//
// Verification is a TRUST SIGNAL, not an access gate. An unverified organisation
// runs events, enters championships and issues certificates exactly as a verified
// one does - what it does not carry is the tick. Saying so on this screen matters,
// because the alternative reading (that you are locked out until Sportagon replies)
// is the one people assume.
//
// Editing and deletion live here rather than in a strip above every page. Deleting
// an organisation is the single most destructive thing in this workspace, and a
// button for it does not belong on the screen somebody opens to check a fixture.

const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";

interface Org {
  id: string; name: string; kind: string; verified: boolean;
  city: string | null; code: string | null;
  short_name?: string | null; country?: string | null; logo_url?: string | null;
}

/** The form takes optional strings; the API returns nullable ones. Bridge, don't cast. */
const asFormInitial = (o: Org) => ({
  name: o.name,
  short_name: o.short_name ?? undefined,
  code: o.code ?? undefined,
  city: o.city ?? undefined,
  country: o.country ?? undefined,
  logo_url: o.logo_url ?? undefined,
});

const STEPS = [
  ['Organisation details', 'Name, kind and city are on file.'],
  ['Authorised contact', 'Someone Sportagon can reach about this account.'],
  ['Domain ownership', 'At least one verified email domain.'],
  ['Sportagon review', 'Our team confirms the organisation is what it says it is.'],
] as const;

const BENEFITS = [
  'A verification tick beside your name everywhere it appears',
  'Priority in Discover listings',
  'Invitations from other verified organisations',
  'Certificates that carry the verified issuer mark',
];

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
}

interface VerificationState {
  verified: boolean;
  request: VerificationRequest | null;
}

/**
 * The request form.
 *
 * Two required fields and seven optional ones, and that split is the whole design.
 * A reviewer cannot proceed without somebody to reach and a name to check the
 * registration against; everything else helps and nothing else blocks. A form that
 * demands a UDISE number from a sports club is a form that does not get submitted,
 * and an unsubmitted request is indistinguishable from the dead end this replaces.
 */
function VerificationRequestModal({ orgId, orgName, onClose, onDone }: {
  orgId: string; orgName: string; onClose: () => void; onDone: () => void;
}) {
  const { ctx } = useAuth();
  // Prefilled from the person asking, because in practice they are the contact. Every
  // field stays editable - the authorised contact is often not whoever has the laptop.
  const [form, setForm] = useState({
    contact_name: ctx?.user?.name ?? '',
    contact_role: '',
    contact_email: ctx?.user?.email ?? '',
    contact_phone: '',
    registered_name: orgName,
    registration_id: '',
    website: '',
    address: '',
    document_url: '',
    note: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const ready = form.contact_name.trim() && /.+@.+\..+/.test(form.contact_email.trim());

  async function submit() {
    setSaving(true);
    try {
      // Blanks are stripped rather than sent as empty strings: the columns are
      // nullable and "" would render as a filled-in field showing nothing on the
      // reviewer's screen.
      const body = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== ''),
      );
      await api('POST', `/organizations/${orgId}/verification-request`, body);
      toast.success('Verification request sent');
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Request verification"
      onClose={onClose}
      wide
      footer={(
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Sportagon reviews this by hand. Nothing about your workspace changes while you wait.
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={!ready || saving}>{saving ? 'Sending…' : 'Send request'}</Button>
          </div>
        </div>
      )}
    >
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        We are checking one thing: that {orgName} is the institution it says it is. The
        two contact fields are required; the rest just make that quicker to confirm.
      </p>

      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Authorised contact *">
          <Input value={form.contact_name} onChange={set('contact_name')} placeholder="Full name" />
        </Field>
        <Field label="Their designation">
          <Input value={form.contact_role} onChange={set('contact_role')} placeholder="Sports Director, Registrar…" />
        </Field>
        <Field label="Contact email *" hint="Ideally on the institution's own domain.">
          <Input type="email" value={form.contact_email} onChange={set('contact_email')} />
        </Field>
        <Field label="Contact phone">
          <Input value={form.contact_phone} onChange={set('contact_phone')} />
        </Field>
        <Field label="Registered name" hint="As it appears on the registration, if different from the workspace name.">
          <Input value={form.registered_name} onChange={set('registered_name')} />
        </Field>
        <Field label="Registration / affiliation number">
          <Input value={form.registration_id} onChange={set('registration_id')} placeholder="UDISE, AICTE, society reg. no.…" />
        </Field>
        <Field label="Website">
          <Input value={form.website} onChange={set('website')} placeholder="https://" />
        </Field>
        <Field label="Link to a document" hint="Anything public we can look at. We do not store uploads.">
          <Input value={form.document_url} onChange={set('document_url')} placeholder="https://" />
        </Field>
      </div>

      <Field label="Address">
        <Textarea rows={2} value={form.address} onChange={set('address')} />
      </Field>
      <Field label="Anything else we should know">
        <Textarea rows={3} value={form.note} onChange={set('note')} />
      </Field>
    </Modal>
  );
}

export function OrgProfilePanel({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const perms = usePermissions();
  const canManage = perms.canManageOrg(orgId);
  const canDelete = perms.isOrgOwner(orgId);
  const { data: org, isLoading, refetch } = useApi<Org>(`/organizations/${orgId}`);
  // Only asked for by somebody who could act on it - the endpoint is `org.manage`,
  // and a Viewer opening this tab would otherwise get a 403 in the console for a
  // panel they are not shown.
  const verification = useApi<VerificationState>(`/organizations/${orgId}/verification-request`, canManage);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [requesting, setRequesting] = useState(false);

  // The API protects completed and scored matches and cascades the rest;
  // ?cascade=true is the explicit confirmation it requires.
  async function handleDelete() {
    const ok = await confirmDialog({
      title: 'Delete this organization?',
      message: `“${org?.name ?? 'This organization'}” and its teams, rosters and championship entries will be permanently removed. This can’t be undone.`,
      confirmLabel: 'Delete organization',
      tone: 'danger',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api('DELETE', `/organizations/${orgId}?cascade=true`);
      await refresh();
      toast.success('Organization deleted');
      navigate('/organizations');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
    }
  }

  async function withdrawRequest() {
    const ok = await confirmDialog({
      title: 'Withdraw the request?',
      message: 'Sportagon will stop reviewing it. You can send a new one whenever you like.',
      confirmLabel: 'Withdraw request',
    });
    if (!ok) return;
    try {
      await api('DELETE', `/organizations/${orgId}/verification-request`);
      toast.success('Request withdrawn');
      await verification.refetch();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  if (isLoading) return <Spinner />;
  if (!org) return null;

  // The organisation row is the authority on whether the tick is held; the request
  // row says what is happening about it. Read from the request endpoint where it has
  // answered, so approving in another tab is reflected without a full context refresh.
  const verified = !!(verification.data?.verified ?? org.verified);
  const request = verification.data?.request ?? null;
  const pending = request?.status === 'pending';
  const refused = request?.status === 'rejected';

  return (
    <>
      <div style={{
        borderRadius: 14, padding: '22px 24px',
        background: verified ? '#E4F6EC' : '#F1F6FE',
        border: `1px solid ${verified ? '#C7E9D5' : '#DFEAFB'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden style={{
            width: 38, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center',
            background: verified ? '#1E9E5A' : '#004AAD', color: '#fff',
          }}>{verified ? <Check size={18} /> : pending ? <Clock size={18} /> : <ShieldCheck size={18} />}</span>
          <div>
            <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 18 }}>
              {verified ? 'Verified organisation' : pending ? 'Verification under review' : 'Not yet verified'}
            </div>
            <div style={{ fontSize: 13.5, color: '#4F5F77', marginTop: 2 }}>
              {verified
                ? 'Your organisation carries the tick wherever it appears.'
                : pending
                  ? 'Your request is with Sportagon. Everything keeps working while it is reviewed.'
                  : 'Everything still works. Verification adds trust signals, it does not unlock features.'}
            </div>
          </div>
        </div>
      </div>

      <Card>
        <CardBody>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <h3 style={{ fontFamily: POP, fontWeight: 800, fontSize: 16, margin: 0 }}>Organisation</h3>
            {canManage && <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit details</Button>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginTop: 14 }}>
            {([['Name', org.name], ['Kind', org.kind], ['City', org.city ?? '—'], ['Code', org.code ?? '—']] as const).map(([k, v]) => (
              <div key={k}>
                <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: '#6E7E96' }}>{k}</div>
                <div style={{ fontSize: 14, color: '#14233B', marginTop: 4 }}>{v}</div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {!verified && (
        <Card>
          <CardBody>
            <h3 style={{ fontFamily: POP, fontWeight: 800, fontSize: 16, margin: '0 0 12px' }}>What verification asks for</h3>
            {STEPS.map(([title, note], i) => (
              <div key={title} style={{ display: 'flex', gap: 12, padding: '11px 0', borderTop: i ? '1px solid #EFF2F7' : 'none' }}>
                <span aria-hidden style={{
                  flex: '0 0 auto', width: 24, height: 24, borderRadius: 999, background: '#EFF2F7',
                  color: '#4F5F77', display: 'grid', placeItems: 'center', fontFamily: MONO, fontSize: 11, fontWeight: 700,
                }}>{i + 1}</span>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#14233B' }}>{title}</div>
                  <div style={{ fontSize: 12.5, color: '#6E7E96', marginTop: 2 }}>{note}</div>
                </div>
              </div>
            ))}
            {/* There is now something behind the button: the request goes to a
                platform queue (org_verification_requests) that a super admin
                approves, and approving is what sets the tick. The sentence this
                replaces - "contact play@sportagon.in" - was the honest thing to say
                while nothing routed such a request to anyone. */}
            {refused && request?.review_note && (
              <div className="mt-3 flex gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/50 dark:bg-rose-950/30">
                <XCircle size={16} className="mt-0.5 shrink-0 text-rose-500" />
                <div>
                  <div className="text-[13px] font-semibold text-rose-700 dark:text-rose-300">
                    Your last request was not approved
                  </div>
                  {/* The reason is shown rather than summarised. A refusal with no
                      reason on the screen is a support ticket by construction. */}
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-rose-700/90 dark:text-rose-300/90">
                    {request.review_note}
                  </p>
                </div>
              </div>
            )}

            <div className="mt-3.5 flex flex-wrap items-center gap-3">
              {pending ? (
                <>
                  <Badge tone="amber">Submitted {fmtDate(request!.created_at)}</Badge>
                  <span className="text-[13px] text-slate-500 dark:text-slate-400">
                    We will let your administrators know either way.
                  </span>
                  {canManage && (
                    <Button size="sm" variant="ghost" onClick={withdrawRequest}>Withdraw</Button>
                  )}
                </>
              ) : canManage ? (
                <>
                  <Button size="sm" onClick={() => setRequesting(true)}>
                    {refused ? 'Send a new request' : 'Request verification'}
                  </Button>
                  <span className="text-[13px] text-slate-500 dark:text-slate-400">
                    Reviewed by hand. Nothing changes about your workspace while you wait.
                  </span>
                </>
              ) : (
                <span className="text-[13px] text-slate-500 dark:text-slate-400">
                  An owner or administrator of this organisation can request verification.
                </span>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <h3 style={{ fontFamily: POP, fontWeight: 800, fontSize: 16, margin: 0 }}>What the tick gets you</h3>
            <Badge tone={verified ? 'green' : 'slate'}>{verified ? 'Active' : 'Not yet'}</Badge>
          </div>
          <ul style={{ margin: '12px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {BENEFITS.map((b) => (
              <li key={b} style={{ display: 'flex', gap: 9, fontSize: 13.5, color: '#4F5F77' }}>
                <Check size={15} style={{ flex: '0 0 auto', marginTop: 2, color: verified ? '#1E9E5A' : '#9BA9BE' }} />
                {b}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {canDelete && (
        <Card>
          <CardBody>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ minWidth: 240 }}>
                <h3 style={{ fontFamily: POP, fontWeight: 800, fontSize: 16, margin: 0, color: '#B02525' }}>Delete this organisation</h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6E7E96', lineHeight: 1.55 }}>
                  Its teams, rosters and entries go with it. Events with completed or
                  scored matches are refused — a locked result is somebody’s record,
                  and it does not disappear because an account was closed.
                </p>
              </div>
              <Button variant="danger" onClick={handleDelete} disabled={deleting}>Delete organisation</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {requesting && (
        <VerificationRequestModal
          orgId={orgId}
          orgName={org.name}
          onClose={() => setRequesting(false)}
          onDone={() => verification.refetch()}
        />
      )}

      {editing && (
        <InstitutionFormModal
          mode="edit"
          initial={asFormInitial(org)}
          onClose={() => setEditing(false)}
          onSubmit={async (body: InstitutionFormBody) => {
            const updated = await api('PATCH', `/organizations/${orgId}`, body);
            toast.success('Organization updated');
            await refetch();
            return updated;
          }}
        />
      )}
    </>
  );
}
