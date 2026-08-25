import { Card, CardBody } from '../../../components/ui';

// Admin > Billing & Subscription, and Admin > Security (PG-28e, PG-28f).
//
// Both are read-only for now, and say so. The alternative - switches that flip and
// persist nothing, or a Change plan button with no checkout behind it - teaches
// people that controls in this product are decorative, which is expensive to unlearn.

const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";

const TIER_LABEL: Record<string, string> = { free: 'Free', pro: 'Pro', max: 'Enterprise' };

const CONTENT = {
  billing: {
    title: 'Billing & subscription',
    blurb: 'The plan governing this organisation, and what it grants.',
    rows: [
      ['Billing contact', 'Not set'],
      ['Payment method', 'Not set'],
      ['Renews', '—'],
    ],
    note: 'Checkout is not wired yet. To change plan, contact play@sportagon.in.',
  },
  security: {
    title: 'Security',
    blurb: 'Policy that applies to everyone in this organisation.',
    rows: [
      ['Two-factor enforcement', 'Off'],
      ['IP allowlist', 'Not set'],
      ['Session length', 'Default'],
    ],
    note: 'These policies are not enforced yet. Personal security settings live under your own account, and where both exist the stricter one wins.',
  },
} as const;

export function PolicyPanel({ kind, tier }: { kind: 'billing' | 'security'; orgId: string; tier: string }) {
  const c = CONTENT[kind];
  return (
    <Card>
      <CardBody>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <h3 style={{ fontFamily: POP, fontWeight: 800, fontSize: 16, margin: 0 }}>{c.title}</h3>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#6E7E96' }}>{c.blurb}</p>
          </div>
          {kind === 'billing' && (
            <span style={{
              fontFamily: MONO, fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase',
              padding: '5px 10px', borderRadius: 999, background: '#DFEAFB', color: '#004AAD',
            }}>{TIER_LABEL[tier] ?? tier}</span>
          )}
        </div>

        <div style={{ marginTop: 14 }}>
          {c.rows.map(([k, v], i) => (
            <div key={k} style={{
              display: 'flex', justifyContent: 'space-between', gap: 12,
              padding: '12px 0', borderTop: i ? '1px solid #EFF2F7' : '1px solid #EFF2F7',
            }}>
              <span style={{ fontSize: 13.5, color: '#14233B' }}>{k}</span>
              <span style={{ fontSize: 13.5, color: '#6E7E96' }}>{v}</span>
            </div>
          ))}
        </div>

        <p style={{ margin: '14px 0 0', fontSize: 12.5, color: '#6E7E96', lineHeight: 1.55 }}>{c.note}</p>
      </CardBody>
    </Card>
  );
}
