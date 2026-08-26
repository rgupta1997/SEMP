import { useState } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../lib/hooks';
import { useAuth } from '../../../lib/auth';
import { usePermissions } from '../../../lib/permissions';
import { api } from '../../../lib/api';
import { InstitutionFormModal, type InstitutionFormBody } from '../../../components/InstitutionFormModal';
import { Badge, Button, Card, CardBody, Spinner, confirmDialog, toast } from '../../../components/ui';

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

export function OrgProfilePanel({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const perms = usePermissions();
  const canManage = perms.canManageOrg(orgId);
  const canDelete = perms.isOrgOwner(orgId);
  const { data: org, isLoading, refetch } = useApi<Org>(`/organizations/${orgId}`);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  if (isLoading) return <Spinner />;
  if (!org) return null;

  const verified = !!org.verified;

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
          }}>{verified ? <Check size={18} /> : <ShieldCheck size={18} />}</span>
          <div>
            <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 18 }}>
              {verified ? 'Verified organisation' : 'Not yet verified'}
            </div>
            <div style={{ fontSize: 13.5, color: '#4F5F77', marginTop: 2 }}>
              {verified
                ? 'Your organisation carries the tick wherever it appears.'
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
            {/* Deliberately not a "Request verification" button yet: nothing routes
                such a request to anyone, and a button that silently does nothing is
                worse than a sentence telling you who to talk to. */}
            <p style={{ margin: '14px 0 0', fontSize: 13, color: '#6E7E96' }}>
              Verification is carried out by Sportagon. Contact play@sportagon.in to start it.
            </p>
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
