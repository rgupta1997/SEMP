import { Card, CardBody } from '../../../components/ui';

// Admin > Security (PG-28f).
//
// Read-only for now, and says so. The alternative - switches that flip and persist
// nothing - teaches people that controls in this product are decorative, which is
// expensive to unlearn.
//
// Billing used to share this component and no longer does: it has a real panel
// with a real checkout behind it (BillingPanel). What was left here was its old
// copy, still saying checkout was not wired - the kind of stale text that is read
// as current long after it stopped being true.

const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";

const CONTENT = {
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

export function PolicyPanel({ kind }: { kind: 'security'; orgId: string }) {
  const c = CONTENT[kind];
  return (
    <Card>
      <CardBody>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <h3 style={{ fontFamily: POP, fontWeight: 800, fontSize: 16, margin: 0 }}>{c.title}</h3>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--muted)' }}>{c.blurb}</p>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          {c.rows.map(([k, v], i) => (
            <div key={k} style={{
              display: 'flex', justifyContent: 'space-between', gap: 12,
              padding: '12px 0', borderTop: i ? '1px solid #EFF2F7' : '1px solid #EFF2F7',
            }}>
              <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{k}</span>
              <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>{v}</span>
            </div>
          ))}
        </div>

        <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>{c.note}</p>
      </CardBody>
    </Card>
  );
}
