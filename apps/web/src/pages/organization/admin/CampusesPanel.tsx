import { useApi } from '../../../lib/hooks';
import { Badge, Card, CardBody, EmptyState, Spinner } from '../../../components/ui';

// Admin > Campuses & Units (PG-28b), gated on multi_campus.
//
// A caveat worth stating on the screen rather than hiding in a ticket: the tree is
// currently programmes and batches, not campuses. `org_units.type` allows
// 'programme' and 'batch'; the breakdown asks for primary_campus / campus / unit.
// Until that lands, a campus-scoped role scopes to a programme - the mechanism is
// right, the noun is not.

const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";

interface Unit {
  id: string; name: string; code: string | null; type: string;
  parent_id: string | null; display_order: number;
}

const initials = (s: string) => s.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function CampusesPanel({ orgId }: { orgId: string }) {
  const { data, isLoading } = useApi<Unit[]>(`/organizations/${orgId}/units`);
  if (isLoading) return <Spinner />;
  const units = data ?? [];
  const roots = units.filter((u) => !u.parent_id);
  const childrenOf = (id: string) => units.filter((u) => u.parent_id === id);

  return (
    <Card>
      <CardBody>
        <div style={{ marginBottom: 14 }}>
          <h3 style={{ fontFamily: POP, fontWeight: 800, fontSize: 16, margin: 0 }}>Campuses &amp; units</h3>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: '#6E7E96' }}>
            The structure a scoped role is granted against. A Sports Admin scoped here reaches this unit and nothing else.
          </p>
        </div>

        {units.length === 0 ? (
          <EmptyState title="No units yet"
            description="Add a programme or batch and it becomes available as a scope when granting roles." />
        ) : roots.map((u) => (
          <div key={u.id} style={{ borderTop: '1px solid #EFF2F7', padding: '12px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <span aria-hidden style={{
                width: 34, height: 34, borderRadius: 9, background: '#DFEAFB', color: '#004AAD',
                display: 'grid', placeItems: 'center', fontFamily: POP, fontWeight: 800, fontSize: 12,
              }}>{u.code ?? initials(u.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: POP, fontWeight: 700, fontSize: 14 }}>{u.name}</div>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: '#6E7E96', marginTop: 2 }}>
                  {u.type}
                </div>
              </div>
              <Badge tone="slate">{childrenOf(u.id).length} nested</Badge>
            </div>
            {childrenOf(u.id).map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0 0 45px' }}>
                <span style={{ fontSize: 13, color: '#4F5F77' }}>{c.name}</span>
                <span style={{ fontFamily: MONO, fontSize: 9.5, textTransform: 'uppercase', color: '#9BA9BE' }}>{c.type}</span>
              </div>
            ))}
          </div>
        ))}

        <p style={{
          margin: '16px 0 0', padding: '10px 12px', borderRadius: 8, background: '#FCF0DB',
          fontSize: 12.5, color: '#8A6410', lineHeight: 1.55,
        }}>
          These are programmes and batches. The breakdown asks for campuses with units nested beneath
          them, which is a change to <span style={{ fontFamily: MONO, fontSize: 11.5 }}>org_units.type</span> and
          is not made yet — so a campus-scoped role currently scopes to a programme.
        </p>
      </CardBody>
    </Card>
  );
}
