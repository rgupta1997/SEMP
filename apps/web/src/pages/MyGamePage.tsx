import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Spinner } from '../components/ui';

// My Game - the personal context's landing screen (PG-10, F-040..F-044).
//
// Laid out as the prototype has it: a brand-filled next-fixture hero beside the
// activity strip, then live / pending / teams across, then recent results.
//
// The empty states carry weight here. This is the first screen after signing in, and
// a new account has no fixtures, no teams and no record - so "nothing yet" has to
// read as a beginning rather than as a broken page.

interface Match {
  id: string; round: string | null; status: string; scheduled_at: string | null;
  sport: string | null; discipline: string | null;
  championship: { id: string; name: string; slug: string } | null;
  my_team: { id: string; name: string } | null;
  opponent: { id: string; name: string; organization: string | null } | null;
  my_score: number | null; opp_score: number | null;
  result: 'won' | 'lost' | 'drawn' | 'bye' | null;
  reason?: string;
}

interface Home {
  next: Match | null;
  live: Match[];
  pending: Match[];
  recent: Match[];
  teams: Array<{ id: string; name: string | null; organization: string | null; sport: string | null; role: string }>;
  stats: { games: number; events: number; sports: number; wins: number };
}

const C = {
  blue: '#004AAD', blue50: '#F1F6FE', teal: '#5CE1E6', navy: '#0A1A33',
  line: '#E1E7F0', line2: '#C8D2E0', fg2: '#14233B', fg3: '#4F5F77', fg4: '#6E7E96',
  faint: '#9BA9BE', ground: '#F7F9FC', surface: '#EFF2F7',
  ok: '#1E9E5A', okSoft: '#E4F6EC', bad: '#DE3A3A', badSoft: '#FBE6E6',
  warn: '#E9920B', warnSoft: '#FCF0DB', brandSoft: '#DFEAFB',
};
const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";

const card: React.CSSProperties = {
  background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14,
  padding: 18, boxShadow: '0 1px 3px rgba(10,26,51,.08)',
};
const cardTitle: React.CSSProperties = { fontFamily: POP, fontWeight: 800, fontSize: 15, marginBottom: 12 };

const initials = (s: string | null) => (s ?? '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function when(iso: string | null) {
  if (!iso) return 'Time to be confirmed';
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const prefix = sameDay ? 'Today' : d.toDateString() === tomorrow.toDateString() ? 'Tomorrow'
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${prefix} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/** The empty hero. A first-time account should be invited somewhere, not shown a blank. */
function NoNextGame() {
  return (
    <div style={{ ...card, padding: '30px 26px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: C.fg4 }}>
        Next game
      </div>
      <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 22, color: C.navy }}>Nothing scheduled yet</div>
      <p style={{ margin: 0, fontSize: 13.5, color: C.fg4, lineHeight: 1.6, maxWidth: '46ch' }}>
        Once you are in a squad and the fixtures are out, your next match shows up here with the time and the venue.
      </p>
      <Link to="/discover" style={{ marginTop: 6, fontFamily: POP, fontWeight: 700, fontSize: 13, color: C.blue, textDecoration: 'none' }}>
        Find something to play →
      </Link>
    </div>
  );
}

function NextGameHero({ m }: { m: Match }) {
  const nav = useNavigate();
  const meta = [
    [m.sport, m.discipline].filter(Boolean).join(' · '),
    when(m.scheduled_at),
    m.championship?.name,
  ].filter(Boolean) as string[];

  return (
    <div style={{
      background: C.blue, borderRadius: 14, padding: '24px 26px', color: '#fff',
      position: 'relative', overflow: 'hidden', boxShadow: '0 12px 28px rgba(0,74,173,.28)',
    }}>
      {/* The hexagon bleed from the prototype - decoration, so hidden from readers. */}
      <div aria-hidden style={{
        position: 'absolute', right: -70, bottom: -90, width: 'min(280px, calc(100vw - 40px))', height: 280,
        opacity: 0.18, border: `2px solid ${C.teal}`,
        clipPath: 'polygon(25% 5%,75% 5%,100% 50%,75% 95%,25% 95%,0% 50%)',
      }} />
      <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: C.teal }}>
        Next game
      </div>
      <div style={{
        fontFamily: POP, fontWeight: 900, fontSize: 'clamp(25px,4.4vw,38px)', letterSpacing: '-.02em',
        textTransform: 'uppercase', lineHeight: 1, marginTop: 16, position: 'relative',
      }}>
        {initials(m.my_team?.name ?? null)} <span style={{ color: '#8FB2EE' }}>vs</span> {initials(m.opponent?.name ?? null)}
      </div>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 16, fontSize: 13.5, color: C.brandSoft, position: 'relative' }}>
        {meta.map((t) => <span key={t}>{t}</span>)}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 22, position: 'relative' }}>
        <button
          onClick={() => nav(`/profile/matches/${m.id}`)}
          style={{ padding: '11px 18px', border: 'none', borderRadius: 10, background: '#fff', color: C.blue, fontFamily: POP, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
          Open match
        </button>
        {m.championship && (
          <button
            onClick={() => nav(`/championships/${m.championship!.id}`)}
            style={{ padding: '11px 18px', border: '1px solid rgba(255,255,255,.35)', borderRadius: 10, background: 'transparent', color: '#fff', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>
            {m.championship.name}
          </button>
        )}
      </div>
    </div>
  );
}

export function MyGamePage() {
  const { ctx } = useAuth();
  const { data, isLoading } = useApi<Home>('/me/home');
  const nav = useNavigate();

  if (isLoading) return <Spinner />;
  const d = data ?? { next: null, live: [], pending: [], recent: [], teams: [], stats: { games: 0, events: 0, sports: 0, wins: 0 } };

  const first = ctx?.user?.name?.split(' ')[0];
  const stats: Array<[string, number]> = [
    ['Games', d.stats.games], ['Events', d.stats.events],
    ['Sports', d.stats.sports], ['Wins', d.stats.wins],
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontFamily: POP, fontWeight: 900, fontSize: 26, letterSpacing: '-.02em', color: C.navy, margin: 0 }}>
          {first ? `${first}'s game` : 'My game'}
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: C.fg4 }}>Everything you are playing, officiating and owed.</p>
      </div>

      {/* hero + activity */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', gap: 16 }} className="mg-top">
        {d.next ? <NextGameHero m={d.next} /> : <NoNextGame />}

        <div style={card}>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: C.fg4 }}>
            My activity
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
            {stats.map(([k, v]) => (
              <div key={k} style={{ padding: '12px 14px', background: C.ground, borderRadius: 10 }}>
                <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 24, color: C.navy, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.fg4, marginTop: 3 }}>{k}</div>
              </div>
            ))}
          </div>
          {/* Said plainly, because a counter that quietly excludes half your matches
              is worse than one that explains itself. */}
          <p style={{ margin: '14px 0 0', fontSize: 11.5, color: C.faint, lineHeight: 1.5 }}>
            Counted from completed matches only.
          </p>
        </div>
      </div>

      {/* live / pending / teams */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(225px,1fr))', gap: 16 }}>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: C.bad }} />
            <span style={{ fontFamily: POP, fontWeight: 800, fontSize: 15 }}>Live now</span>
          </div>
          {d.live.length === 0
            ? <p style={{ margin: 0, fontSize: 13, color: C.faint }}>Nothing of yours is being played right now.</p>
            : d.live.map((g) => (
              <div key={g.id} onClick={() => nav(`/profile/matches/${g.id}`)} role="button" tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && nav(`/profile/matches/${g.id}`)}
                style={{ cursor: 'pointer', padding: '11px 12px', borderRadius: 10, background: C.blue50, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: POP, fontWeight: 700, fontSize: 13.5 }}>
                  <span>{g.my_team?.name ?? 'My team'}</span>
                  <span style={{ fontFamily: MONO, color: C.blue }}>{g.my_score ?? '–'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: POP, fontWeight: 700, fontSize: 13.5, color: C.fg3, marginTop: 4 }}>
                  <span>{g.opponent?.name ?? 'TBC'}</span>
                  <span style={{ fontFamily: MONO }}>{g.opp_score ?? '–'}</span>
                </div>
                <div style={{ fontSize: 11.5, color: C.fg4, marginTop: 6 }}>{[g.sport, g.championship?.name].filter(Boolean).join(' · ')}</div>
              </div>
            ))}
        </div>

        <div style={card}>
          <div style={cardTitle}>Pending actions</div>
          {d.pending.length === 0
            ? <p style={{ margin: 0, fontSize: 13, color: C.faint }}>Nothing needs you right now.</p>
            : d.pending.map((p) => (
              <div key={p.id} onClick={() => nav(`/score/${p.id}`)} role="button" tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && nav(`/score/${p.id}`)}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: `1px solid ${C.surface}` }}>
                <span aria-hidden style={{
                  width: 26, height: 26, borderRadius: 8, background: C.warnSoft, color: C.warn,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 11, fontWeight: 700,
                }}>!</span>
                <span style={{ flex: 1, fontSize: 13.5, color: C.fg2 }}>
                  {p.reason} — {[p.sport, p.championship?.name].filter(Boolean).join(' · ')}
                </span>
                <span aria-hidden style={{ color: C.faint }}>›</span>
              </div>
            ))}
        </div>

        <div style={card}>
          <div style={cardTitle}>My teams</div>
          {d.teams.length === 0 ? (
            <div style={{ border: `1px dashed ${C.line2}`, borderRadius: 12, padding: '22px 18px', textAlign: 'center' }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.fg3 }}>You are not in a squad yet</div>
              <div style={{ fontSize: 12.5, color: C.faint, marginTop: 6, lineHeight: 1.55 }}>
                Join an organisation or enter an event, and the teams you play for appear here.
              </div>
              <Link to="/discover" style={{ display: 'inline-block', marginTop: 12, fontFamily: POP, fontWeight: 700, fontSize: 12.5, color: C.blue, textDecoration: 'none' }}>
                Find something to play →
              </Link>
            </div>
          ) : d.teams.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: `1px solid ${C.surface}` }}>
              <span aria-hidden style={{
                width: 28, height: 28, borderRadius: 8, background: C.brandSoft, color: C.blue,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: POP, fontWeight: 700, fontSize: 11,
              }}>{initials(t.organization ?? t.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: C.fg2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                <div style={{ fontSize: 11.5, color: C.fg4, marginTop: 2 }}>{[t.organization, t.sport].filter(Boolean).join(' · ')}</div>
              </div>
              <span style={{
                fontFamily: MONO, fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase',
                padding: '3px 7px', borderRadius: 999, background: C.surface, color: C.fg3,
              }}>{t.role}</span>
            </div>
          ))}
        </div>
      </div>

      {/* recent results */}
      <div style={{ ...card, padding: 20 }}>
        <div style={cardTitle}>Recent results</div>
        {d.recent.length === 0
          ? <p style={{ margin: 0, fontSize: 13, color: C.faint }}>Your results will appear here once you have played.</p>
          : d.recent.map((r) => {
            const won = r.result === 'won', lost = r.result === 'lost';
            return (
              <div key={r.id} onClick={() => nav(`/profile/matches/${r.id}`)} role="button" tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && nav(`/profile/matches/${r.id}`)}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: `1px solid ${C.surface}` }}>
                <span style={{
                  fontFamily: MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em', padding: '4px 8px', borderRadius: 999,
                  background: won ? C.okSoft : lost ? C.badSoft : C.surface,
                  color: won ? C.ok : lost ? C.bad : C.fg3,
                }}>{(r.result ?? 'played').toUpperCase()}</span>
                <span style={{ fontFamily: MONO, fontSize: 13, color: C.navy, minWidth: 62 }}>
                  {r.my_score ?? '–'} · {r.opp_score ?? '–'}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: C.fg2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.my_team?.name} vs {r.opponent?.name ?? 'TBC'}
                </span>
                <span style={{ fontSize: 12, color: C.fg4, whiteSpace: 'nowrap' }}>{r.championship?.name}</span>
              </div>
            );
          })}
      </div>

      <style>{`@media (max-width: 860px){ .mg-top{ grid-template-columns: 1fr !important } }`}</style>
    </div>
  );
}
