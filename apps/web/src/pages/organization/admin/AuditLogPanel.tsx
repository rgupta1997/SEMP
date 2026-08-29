import { useState } from 'react';
import { useApi } from '../../../lib/hooks';
import { Card, CardBody, EmptyState, SearchInput, Spinner } from '../../../components/ui';

// Admin > Audit Logs (PG-28j).
//
// Reverse-chronological, grouped by day. Nothing here is editable and nothing is
// deletable - the table is append-only, enforced by a database trigger that refuses
// UPDATE and DELETE even for the table owner. A log somebody can quietly edit is
// not a log, so the screen offers no affordance that suggests otherwise.

const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";

interface Entry {
  id: string; at: string; action: string;
  actor_label: string | null; target_label: string | null;
  summary: string | null;
}

const dayOf = (iso: string) => {
  const d = new Date(iso), now = new Date();
  const yday = new Date(now); yday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === yday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

export function AuditLogPanel({ orgId }: { orgId: string }) {
  const [q, setQ] = useState('');
  const { data, isLoading } = useApi<{ rows: Entry[]; total: number }>(
    `/organizations/${orgId}/audit${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
  );

  if (isLoading) return <Spinner />;
  const rows = data?.rows ?? [];

  // Group into days as we go, so the order the server chose is preserved.
  const days: Array<{ day: string; items: Entry[] }> = [];
  for (const r of rows) {
    const day = dayOf(r.at);
    if (days[days.length - 1]?.day !== day) days.push({ day, items: [] });
    days[days.length - 1].items.push(r);
  }

  return (
    <Card>
      <CardBody>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div>
            <h3 style={{ fontFamily: POP, fontWeight: 800, fontSize: 16, margin: 0 }}>Audit trail</h3>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--muted)' }}>
              Append-only. {data?.total ?? 0} entries recorded.
            </p>
          </div>
          <SearchInput value={q} onChange={setQ} placeholder="Search who or what…" />
        </div>

        {rows.length === 0 ? (
          <EmptyState title="Nothing recorded yet"
            description="Locks, exports, role changes and member updates all leave an entry here." />
        ) : days.map((g) => (
          <div key={g.day} style={{ marginBottom: 18 }}>
            <div style={{
              fontFamily: MONO, fontSize: 9.5, letterSpacing: '.14em', textTransform: 'uppercase',
              color: 'var(--faint)', paddingBottom: 6,
            }}>{g.day}</div>
            {g.items.map((e) => (
              <div key={e.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderTop: '1px solid #EFF2F7' }}>
                <span style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--muted)', flex: '0 0 46px', paddingTop: 1 }}>
                  {new Date(e.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
                    {e.summary ?? `${e.actor_label ?? 'Someone'} · ${e.action}`}
                  </div>
                  {/* The action code is kept alongside the sentence: the sentence is
                      for a person, the code is what you grep for in an incident. */}
                  <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--faint)', marginTop: 3 }}>
                    {e.action}{e.target_label ? ` · ${e.target_label}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
