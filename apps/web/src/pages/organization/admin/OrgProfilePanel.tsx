import { Check, ShieldCheck } from 'lucide-react';
import { useApi } from '../../../lib/hooks';
import { Badge, Card, CardBody, Spinner } from '../../../components/ui';

// Admin > Organization Profile (PG-28a).
//
// Verification is a TRUST SIGNAL, not an access gate. An unverified organisation
// runs events, enters championships and issues certificates exactly as a verified
// one does - what it does not carry is the tick. Saying so on this screen matters,
// because the alternative reading (that you are locked out until Sportagon replies)
// is the one people assume.

const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";

interface Org { id: string; name: string; kind: string; verified: boolean; city: string | null; code: string | null }

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
  const { data: org, isLoading } = useApi<Org>(`/organizations/${orgId}`);
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
          <h3 style={{ fontFamily: POP, fontWeight: 800, fontSize: 16, margin: '0 0 4px' }}>Organisation</h3>
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
    </>
  );
}
