import { useMemo, useState } from 'react';
import { useApi } from '../../lib/hooks';
import { Card, CardBody, CardHeader, EmptyState, Select, Spinner } from '../../components/ui';

// ============================================================================
// A person's record, by sport - and NOT as one undifferentiated number.
//
// Every sport shows the combined record first, then the tiers that make it up:
// INTER (against other institutions) and INTRA (between departments or campuses of
// one). Adding those together is the thing a career page must not do - a hundred
// against another university and a hundred in an inter-hostel game are not the same
// hundred, which is why cricket has kept first-class, List A and T20 apart for a
// century.
//
// The rollup is READ from the server, never summed here. It is stored alongside its
// parts in the same transaction, so a screen that recomputed it could only ever
// disagree with the source.
//
// Disciplines sit under their sport, collapsed. "How do I do in singles" is a real
// question and a different one from "how do I do at table tennis", but it is the
// second question, so it is one click away rather than in the way of the first.
// ============================================================================

interface Metric {
  key: string; label: string; short: string; value: number;
  /** Ready-made display text, where the number alone would mislead - "5/23". */
  text?: string;
  /** A cricket high score that was unbeaten: printed 84*, not 84. */
  notOut?: boolean;
  percent?: boolean; headline?: boolean; higherIsBetter?: boolean;
}
interface TierRecord {
  tier: 'all' | 'inter' | 'intra';
  label: string; hint?: string;
  played: number; won: number; lost: number; drawn: number;
  winPct: number | null;
  gold: number; silver: number; bronze: number; awards: number;
  firstOn: string | null; lastOn: string | null;
  metrics: Metric[];
}
interface DisciplineRecord {
  disciplineId: string; discipline: string;
  overall: TierRecord; tiers: TierRecord[];
}
interface SportRecord {
  sportId: string; sport: string;
  overall: TierRecord; tiers: TierRecord[];
  disciplines: DisciplineRecord[];
}
interface Payload {
  sports: SportRecord[];
  filters: Array<{ sportId: string; sport: string; disciplines: Array<{ id: string; name: string }> }>;
}

const fmt = (m: Metric) =>
  m.text ?? (m.percent ? `${m.value}%` : `${m.value}${m.notOut ? '*' : ''}`);

/** W-L-D, the way a record is written down. */
function Record({ r }: { r: TierRecord }) {
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      <b>{r.played}</b> played
      <span style={{ color: 'var(--ink-4)' }}>
        {'  ·  '}{r.won}W {r.lost}L{r.drawn > 0 ? ` ${r.drawn}D` : ''}
        {r.winPct != null ? `  ·  ${r.winPct}%` : ''}
      </span>
    </span>
  );
}

function Medals({ r }: { r: TierRecord }) {
  const bits = [
    r.gold ? `${r.gold} gold` : null,
    r.silver ? `${r.silver} silver` : null,
    r.bronze ? `${r.bronze} bronze` : null,
    r.awards ? `${r.awards} award${r.awards === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  if (!bits.length) return null;
  return <div style={{ fontSize: 12.5, color: 'var(--ink-4)', marginTop: 2 }}>{bits.join(' · ')}</div>;
}

/** The sport's own measures. Empty is normal - not every result records them. */
function Metrics({ metrics, dense }: { metrics: Metric[]; dense?: boolean }) {
  if (!metrics.length) return null;
  const shown = dense ? metrics.filter((m) => m.headline).slice(0, 6) : metrics;
  if (!shown.length) return null;
  return (
    <div style={{
      display: 'grid', gap: 1, marginTop: 10,
      gridTemplateColumns: `repeat(auto-fit, minmax(${dense ? 104 : 128}px, 1fr))`,
      background: 'var(--line)', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden',
    }}>
      {shown.map((m) => (
        <div key={m.key} style={{ background: 'var(--bg-1, #fff)', padding: '8px 10px' }}>
          <div style={{
            fontSize: 17, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
            color: m.higherIsBetter === false ? 'var(--ink-3)' : 'var(--ink-1)',
          }}>{fmt(m)}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.3 }}>{m.label}</div>
        </div>
      ))}
    </div>
  );
}

/** One tier row under a sport. */
function TierRow({ r }: { r: TierRecord }) {
  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 150 }}>{r.label}</span>
        <span style={{ fontSize: 13.5 }}><Record r={r} /></span>
      </div>
      {r.hint && <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 1 }}>{r.hint}</div>}
      <Medals r={r} />
      <Metrics metrics={r.metrics} dense />
    </div>
  );
}

function SportCard({ s }: { s: SportRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader
        title={s.sport}
        subtitle={
          s.overall.lastOn
            ? `Last played ${s.overall.lastOn}${s.overall.firstOn && s.overall.firstOn !== s.overall.lastOn ? ` · since ${s.overall.firstOn}` : ''}`
            : undefined
        }
      />
      <CardBody>
        {/* The combined record leads, because it is the number somebody came for. */}
        <div style={{ fontSize: 15.5 }}><Record r={s.overall} /></div>
        <Medals r={s.overall} />
        <Metrics metrics={s.overall.metrics} />

        {/* The split. Shown only when there IS one - a person who has only played
            inter-institution has no intra record, and a zeroed row would read as
            something missing rather than something that never happened. */}
        {s.tiers.length > 1 && (
          <div style={{ marginTop: 12 }}>
            <div style={{
              fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em',
              textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 2,
            }}>By competition level</div>
            {s.tiers.map((t) => <TierRow key={t.tier} r={t} />)}
          </div>
        )}
        {s.tiers.length === 1 && (
          <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 8 }}>
            All {s.tiers[0].label.toLowerCase()}.
          </div>
        )}

        {s.disciplines.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => setOpen((v) => !v)}
              style={{
                cursor: 'pointer', background: 'none', border: 'none', padding: 0,
                fontSize: 12.5, fontWeight: 600, color: 'var(--brand)',
              }}
            >
              {open ? 'Hide' : 'Show'} {s.disciplines.length} discipline{s.disciplines.length === 1 ? '' : 's'}
            </button>
            {open && (
              <div style={{ marginTop: 8 }}>
                {s.disciplines.map((d) => (
                  <div key={d.disciplineId} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', alignItems: 'baseline' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, minWidth: 150 }}>{d.discipline}</span>
                      <span style={{ fontSize: 13.5 }}><Record r={d.overall} /></span>
                    </div>
                    {d.tiers.length > 1 && (
                      <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3 }}>
                        {d.tiers.map((t) => `${t.label}: ${t.played} played, ${t.won}W ${t.lost}L`).join('  ·  ')}
                      </div>
                    )}
                    <Metrics metrics={d.overall.metrics} dense />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function SportStatsPanel({ userId }: { userId?: string }) {
  const [sportId, setSportId] = useState('');
  const [disciplineId, setDisciplineId] = useState('');

  const qs = new URLSearchParams();
  if (sportId) qs.set('sport', sportId);
  if (disciplineId) qs.set('discipline', disciplineId);
  const base = userId ? `/people/${userId}/sport-stats` : '/me/sport-stats';
  const { data, isLoading } = useApi<Payload>(`${base}${qs.toString() ? `?${qs}` : ''}`);

  // The discipline list follows the chosen sport, because offering every discipline
  // on the platform under a sport filter is offering a dropdown nobody can use.
  const disciplines = useMemo(() => {
    if (!data) return [];
    if (sportId) {
      return (data.filters.find((f) => f.sportId === sportId)?.disciplines ?? [])
        .map((d) => ({ ...d, label: d.name }));
    }
    // With no sport chosen the list spans every sport, and half of them call their
    // discipline "Men's" - three identical options nobody can choose between. The
    // sport goes in front, so each one says what it is.
    return data.filters.flatMap((f) =>
      f.disciplines.map((d) => ({ ...d, label: `${f.sport} · ${d.name}` })));
  }, [data, sportId]);

  if (isLoading) return <Spinner />;
  if (!data || !data.sports.length) {
    return (
      <EmptyState
        icon="▦"
        title={sportId || disciplineId ? 'Nothing under that filter' : 'No statistics yet'}
        description={
          sportId || disciplineId
            ? 'You have no record in that sport or discipline. Clear the filter to see everything.'
            : 'Your record fills in as results are made official. Play a match and ask the organiser to lock the scorecard.'
        }
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'grid', gap: 3, minWidth: 180 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Sport</span>
          <Select value={sportId} onChange={(e) => { setSportId(e.target.value); setDisciplineId(''); }}>
            <option value="">All sports</option>
            {data.filters.map((f) => <option key={f.sportId} value={f.sportId}>{f.sport}</option>)}
          </Select>
        </label>
        <label style={{ display: 'grid', gap: 3, minWidth: 200 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Discipline</span>
          <Select value={disciplineId} onChange={(e) => setDisciplineId(e.target.value)} disabled={!disciplines.length}>
            <option value="">All disciplines</option>
            {disciplines.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </Select>
        </label>
        {(sportId || disciplineId) && (
          <button
            onClick={() => { setSportId(''); setDisciplineId(''); }}
            style={{ cursor: 'pointer', background: 'none', border: 'none', padding: '0 0 9px', fontSize: 12.5, fontWeight: 600, color: 'var(--brand)' }}
          >
            Clear
          </button>
        )}
      </div>

      {data.sports.map((s) => <SportCard key={s.sportId} s={s} />)}

      <p style={{ fontSize: 11.5, color: 'var(--ink-4)', margin: 0 }}>
        Only results from locked scorecards count. A result that is unlocked for a
        correction drops out until it is locked again — these figures are rebuilt from
        the record each time, never adjusted by hand.
      </p>
    </div>
  );
}
