import { useMemo, useState } from 'react';
import { isRankingSport } from '@semp/shared';
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
  /** Tie rubbers played inside a team discipline. */
  rubbers?: Array<{ label: string; played: number; won: number; lost: number }>;
}
interface PositionRecord {
  position: 'singles' | 'doubles';
  overall: TierRecord; tiers: TierRecord[];
}
interface SportRecord {
  sportId: string; sport: string;
  overall: TierRecord; tiers: TierRecord[];
  disciplines: DisciplineRecord[];
  /** Singles and doubles - racquet sports, once results say which. */
  positions?: PositionRecord[];
}
interface PersonRecord { userId: string; name: string; played: number; won: number; lost: number }
/** One opposing side: a player in singles, a pair in doubles. */
interface OpponentRecord {
  position: 'singles' | 'doubles'; userIds: string[]; names: string[];
  partnerId: string | null; partnerName: string | null;
  played: number; won: number; lost: number;
}
interface Relations { partners: PersonRecord[]; opponents: OpponentRecord[] }
interface Payload {
  sports: SportRecord[];
  filters: Array<{ sportId: string; sport: string; disciplines: Array<{ id: string; name: string }> }>;
}

const fmt = (m: Metric) =>
  m.text ?? (m.percent ? `${m.value}%` : `${m.value}${m.notOut ? '*' : ''}`);

// Null (not 0%) with nothing played yet - "always loses" and "hasn't
// competed" aren't the same fact. Capped at 100: `played` is per FIXTURE but
// medals are per RACE, so a multi-race meet can out-medal its fixture count.
const podiumPct = (r: TierRecord): number | null =>
  r.played > 0 ? Math.min(100, Math.round(((r.gold + r.silver + r.bronze) / r.played) * 1000) / 10) : null;

// A ranking event has no opponent to beat, so W-L-D doesn't describe it -
// podium rate (how often they medal) is the question it actually answers.
function Record({ r, ranking }: { r: TierRecord; ranking?: boolean }) {
  const pct = ranking ? podiumPct(r) : null;
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      <b>{r.played}</b> played
      <span style={{ color: 'var(--ink-4)' }}>
        {ranking
          ? (pct != null ? `  ·  ${pct}% podium` : '')
          : <>{'  ·  '}{r.won}W {r.lost}L{r.drawn > 0 ? ` ${r.drawn}D` : ''}{r.winPct != null ? `  ·  ${r.winPct}%` : ''}</>}
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
function TierRow({ r, ranking }: { r: TierRecord; ranking?: boolean }) {
  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 150 }}>{r.label}</span>
        <span style={{ fontSize: 13.5 }}><Record r={r} ranking={ranking} /></span>
      </div>
      {r.hint && <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 1 }}>{r.hint}</div>}
      <Medals r={r} />
      <Metrics metrics={r.metrics} dense />
    </div>
  );
}

interface InsightItem {
  key: string; tone: 'strength' | 'weakness' | 'up' | 'down'; text: string;
  /** The counts behind it and the rule that made it a strength, a weakness or a trend. */
  evidence?: { facts: Array<{ label: string; value: string }>; rule: string };
  /** Based on little data - shown, but marked as an early sign. */
  early?: boolean;
}

/** A small tag on an insight built on little data, so it is read as a hint, not a verdict. */
const EarlySign = () => (
  <span title="Based on only a little data so far - it may change as more matches are played"
    style={{ marginLeft: 6, padding: '0 5px', borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-4)', border: '1px solid var(--line)', whiteSpace: 'nowrap' }}>
    early sign
  </span>
);
interface InsightReport {
  enoughData: boolean;
  strengths: InsightItem[]; weaknesses: InsightItem[]; trends: InsightItem[];
  form: Array<'W' | 'L' | 'D'>;
}

/**
 * Strengths, things to work on and trends, in plain words - what the numbers mean.
 * The card FLIPS to show how each one was worked out: the counts behind it and the
 * rule applied, so nobody has to take an insight on trust.
 */
function InsightsCard({ userId, sportId, view }: { userId?: string; sportId: string; view: PlayView }) {
  const base = userId ? `/people/${userId}/sport-insights` : '/me/sport-insights';
  // Follows the All / Singles / Doubles switch: a format's tab reads that format only.
  const { data } = useApi<InsightReport | null>(`${base}?sport=${sportId}${view === 'all' ? '' : `&position=${view}`}`);
  const [face, setFace] = useState<'front' | 'back'>('front');
  const [angle, setAngle] = useState(0);
  // A two-step turn - to edge-on, swap the face, back to flat - so the card takes the
  // height of whichever side is showing rather than the taller of the two.
  const flip = () => {
    const swap = () => setFace((f) => (f === 'front' ? 'back' : 'front'));
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { swap(); return; }
    setAngle(90);
    window.setTimeout(() => { swap(); setAngle(0); }, 180);
  };
  if (!data) return null;
  if (!data.enoughData) {
    return (
      <div style={{ fontSize: 12.5, color: 'var(--ink-4)', marginBottom: 12 }}>
        Insights appear after a few more {view === 'all' ? '' : `${view} `}results.
      </div>
    );
  }
  const block = (title: string, items: InsightItem[], mark: (i: InsightItem) => string, colour: (i: InsightItem) => string) =>
    items.length > 0 && (
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 4 }}>{title}</div>
        {items.map((i) => (
          <div key={i.key} style={{ display: 'flex', gap: 6, fontSize: 13, lineHeight: 1.45, marginBottom: 3 }}>
            <span style={{ color: colour(i), fontWeight: 700 }}>{mark(i)}</span>
            <span>{i.text}{i.early && <EarlySign />}</span>
          </div>
        ))}
      </div>
    );
  const good = 'var(--success, #059669)';
  const bad = 'var(--danger, #e11d48)';
  const markOf = (i: InsightItem) => (i.tone === 'strength' ? '✓' : i.tone === 'weakness' ? '!' : i.tone === 'up' ? '▲' : '▼');
  const colourOf = (i: InsightItem) => (i.tone === 'strength' || i.tone === 'up' ? good : bad);
  const flipButton = (label: string) => (
    <button
      type="button"
      onClick={flip}
      style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--brand)', whiteSpace: 'nowrap' }}
    >
      {label}
    </button>
  );

  const front = (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        {data.form.length > 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
            Last {data.form.length}:{' '}
            {data.form.map((r, n) => (
              <b key={n} style={{ color: r === 'W' ? good : r === 'L' ? bad : 'var(--ink-4)', marginRight: 4 }}>{r}</b>
            ))}
          </div>
        ) : <span />}
        {flipButton('How is this worked out? ↻')}
      </div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {block('Strengths', data.strengths, () => '✓', () => good)}
        {block('Work on', data.weaknesses, () => '!', () => bad)}
        {block('Trend', data.trends, (i) => (i.tone === 'up' ? '▲' : '▼'), (i) => (i.tone === 'up' ? good : bad))}
      </div>
    </>
  );

  // The back: each insight with its counts and its rule.
  const all = [...data.strengths, ...data.weaknesses, ...data.trends];
  const back = (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          How these are worked out
        </div>
        {flipButton('← Back to insights')}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5 }}>
        Counted from the points recorded by the scorer in locked matches. The figures are exact counts;
        whether one is called a strength or something to work on follows the rule shown under it.
        Where enough other players have played, you are compared with what is typical for them.
        Pressure figures come from singles when there is enough - in doubles they belong to the pair.
        An &ldquo;early sign&rdquo; is based on only a little data so far.
      </div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {all.map((i) => (
          <div key={`${i.tone}-${i.key}`} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6, fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>
              <span style={{ color: colourOf(i), fontWeight: 700 }}>{markOf(i)}</span>
              <span>{i.text}{i.early && <EarlySign />}</span>
            </div>
            {i.evidence && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10, rowGap: 2, fontSize: 12 }}>
                  {i.evidence.facts.map((f) => (
                    <div key={f.label} style={{ display: 'contents' }}>
                      <span style={{ color: 'var(--ink-4)' }}>{f.label}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ink-2, inherit)' }}>{f.value}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-4)', fontStyle: 'italic' }}>Rule: {i.evidence.rule}</div>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div style={{ perspective: 1200, marginBottom: 12 }}>
      <div
        style={{
          border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', display: 'grid', gap: 10,
          transform: `rotateY(${angle}deg)`, transition: 'transform 180ms ease-in-out',
        }}
      >
        {face === 'front' ? front : back}
      </div>
    </div>
  );
}

/** Who they play with and against. Fetched only when opened - most visits never ask. */
function PeopleSection({ userId, sportId, view }: { userId?: string; sportId: string; view: PlayView }) {
  const [open, setOpen] = useState(false);
  const base = userId ? `/people/${userId}/sport-relations` : '/me/sport-relations';
  const { data, isLoading } = useApi<Relations>(open ? `${base}?sport=${sportId}` : null);
  const heading = (title: string) => (
    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink-4)', marginTop: 10 }}>{title}</div>
  );
  const row = (key: string, who: React.ReactNode, r: { won: number; lost: number; played: number }) => (
    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderTop: '1px solid var(--line)', fontSize: 13 }}>
      <span>{who}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ink-3)' }}>
        {r.won}W {r.lost}L<span style={{ color: 'var(--ink-4)' }}>{'  ·  '}{r.played} played</span>
      </span>
    </div>
  );
  // Each match is one row, so the rows add up to the matches played. A doubles row
  // names both pairs: "with Aman knights vs Aman devils / Aman Player 1".
  const opponents = (position: 'singles' | 'doubles') => {
    const rows = data?.opponents.filter((o) => o.position === position) ?? [];
    if (!rows.length) return null;
    return (
      <div>
        {heading(position === 'singles' ? 'Singles' : 'Doubles')}
        {rows.map((o) => row(
          `${o.partnerId ?? ''}|${o.userIds.join('|')}`,
          <>
            {o.partnerName && <>with <b>{o.partnerName}</b>{' '}</>}
            vs <b>{o.names.join(' / ')}</b>
          </>,
          o,
        ))}
      </div>
    );
  };
  // Follows the All / Singles / Doubles tab above.
  const shown = view === 'all' ? ['singles', 'doubles'] as const : [view] as const;
  const any = !!data?.opponents.some((o) => (shown as readonly string[]).includes(o.position));
  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--brand)' }}
      >
        {open ? 'Hide' : 'Show'} {view === 'singles' ? 'head-to-head' : 'partners & head-to-head'}
      </button>
      {open && (isLoading ? <Spinner /> : !any ? (
        <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 6 }}>
          No named opponents{view === 'all' ? '' : ` in ${view}`} yet - they appear once matches record who played.
        </div>
      ) : (
        <>{shown.map((p) => <div key={p}>{opponents(p)}</div>)}</>
      ))}
    </div>
  );
}

type PlayView = 'all' | 'singles' | 'doubles';

function SportCard({ s, userId }: { s: SportRecord; userId?: string }) {
  const [open, setOpen] = useState(false);
  // Singles and doubles are different games; the split is one tap away when known.
  const [view, setView] = useState<PlayView>('all');
  const positions = s.positions ?? [];
  const picked = view === 'all' ? null : positions.find((p) => p.position === view) ?? null;
  const shown = picked ? { overall: picked.overall, tiers: picked.tiers } : { overall: s.overall, tiers: s.tiers };
  // A ranking event has no opponent, so "won/lost" doesn't describe it.
  const ranking = isRankingSport(s.sport);
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
        {positions.length > 0 && (
          <div style={{ display: 'inline-flex', gap: 2, padding: 2, marginBottom: 10, borderRadius: 8, background: 'var(--line)' }}>
            {(['all', ...positions.map((p) => p.position)] as PlayView[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  cursor: 'pointer', border: 'none', borderRadius: 6, padding: '4px 12px',
                  fontSize: 12.5, fontWeight: 600,
                  background: view === v ? 'var(--bg-1, #fff)' : 'transparent',
                  color: view === v ? 'var(--ink-1)' : 'var(--ink-4)',
                }}
              >
                {v === 'all' ? 'All' : v === 'singles' ? 'Singles' : 'Doubles'}
              </button>
            ))}
          </div>
        )}

        {/* What the numbers mean, before the numbers - under the switch, which it follows.
            Racquet sports only (the API says). */}
        {!ranking && <InsightsCard userId={userId} sportId={s.sportId} view={view} />}

        {/* The combined record leads, because it is the number somebody came for. */}
        <div style={{ fontSize: 15.5 }}><Record r={shown.overall} ranking={ranking} /></div>
        <Medals r={shown.overall} />
        <Metrics metrics={shown.overall.metrics} />
        {/* Doubles has both: pair tiles for the side, the rest personal. */}
        {view !== 'singles' && positions.some((p) => p.position === 'doubles')
          && shown.overall.metrics.some((m) => m.key === 'service_points_played') && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 6 }}>
            Doubles: "Points your pair served / received" count the whole pair. The other serve and receive tiles count only your own serves and returns.
          </div>
        )}

        {/* The split. Shown only when there IS one - a person who has only played
            inter-institution has no intra record, and a zeroed row would read as
            something missing rather than something that never happened. */}
        {shown.tiers.length > 1 && (
          <div style={{ marginTop: 12 }}>
            <div style={{
              fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em',
              textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 2,
            }}>By competition level</div>
            {shown.tiers.map((t) => <TierRow key={t.tier} r={t} ranking={ranking} />)}
          </div>
        )}
        {shown.tiers.length === 1 && (
          <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 8 }}>
            All {shown.tiers[0].label.toLowerCase()}.
          </div>
        )}

        {!ranking && <PeopleSection userId={userId} sportId={s.sportId} view={view} />}

        {view === 'all' && s.disciplines.length > 0 && (
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
                      <span style={{ fontSize: 13.5 }}><Record r={d.overall} ranking={ranking} /></span>
                    </div>
                    {/* A team discipline names the rubbers inside it: "Mixed · Men's Singles rubber · 0W 1L". */}
                    {d.rubbers?.map((r) => (
                      <div key={r.label} style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                        {d.discipline} · {r.label} rubber · {r.won}W {r.lost}L
                        {r.played > r.won + r.lost && <span style={{ color: 'var(--ink-4)' }}> · {r.played} played</span>}
                      </div>
                    ))}
                    {d.tiers.length > 1 && (
                      <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3 }}>
                        {d.tiers.map((t) => ranking
                          ? `${t.label}: ${t.played} played${podiumPct(t) != null ? `, ${podiumPct(t)}% podium` : ''}`
                          : `${t.label}: ${t.played} played, ${t.won}W ${t.lost}L`).join('  ·  ')}
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
          <Select className="w-full" value={sportId} onChange={(e) => { setSportId(e.target.value); setDisciplineId(''); }}>
            <option value="">All sports</option>
            {[...data.filters].sort((a, b) => a.sport.localeCompare(b.sport)).map((f) => <option key={f.sportId} value={f.sportId}>{f.sport}</option>)}
          </Select>
        </label>
        <label style={{ display: 'grid', gap: 3, minWidth: 200 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Discipline</span>
          <Select className="w-full" value={disciplineId} onChange={(e) => setDisciplineId(e.target.value)} disabled={!disciplines.length}>
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

      {data.sports.map((s) => <SportCard key={s.sportId} s={s} userId={userId} />)}

      <p style={{ fontSize: 11.5, color: 'var(--ink-4)', margin: 0 }}>
        Only results from locked scorecards count. A result that is unlocked for a
        correction drops out until it is locked again — these figures are rebuilt from
        the record each time, never adjusted by hand.
      </p>
    </div>
  );
}
