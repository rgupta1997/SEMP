import { Link, useNavigate, useParams } from 'react-router-dom';
import { Award, CalendarDays, ClipboardList, Radio, Shield, Users } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';
import { usePermissions } from '../../lib/permissions';
import { usePocOnboarding } from '../../lib/onboarding';
import { useWorkspace } from '../../lib/useWorkspace';
import { GettingStarted } from '../../components/onboarding/GettingStarted';
import { Badge, Spinner, StatusBadge } from '../../components/ui';
import { titleCase } from '../../lib/format';

// The organisation dashboard (PG-20): what needs attention, and what is happening.
//
// The queue only carries work an org administrator can settle from their own desk.
// Scorecard locking, achievement validation and certificate issuance belong to the
// event workspace, and putting them here would tell an administrator they own
// decisions they cannot actually make.

const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";
const C = {
  ink: 'var(--ink)', line: 'var(--line)', fg4: 'var(--muted)', brand: 'var(--brand)',
  // The dark hero band and the "live now" tile are BRAND SURFACES, not ink. They
  // were painted with the neutral ink so they stayed navy while the rest of the
  // workspace turned the institution's colour - which reads as the theme being
  // half-applied. `deep` is the ramp's darkest step and `onDeep` is what reads on
  // it, so both follow the tenant and their contrast holds by construction.
  deep: 'var(--brand-deep)', onDeep: 'var(--on-brand)',
  cyan: 'var(--accent)', amber: '#E9920B', amberSoft: '#FCF0DB', brandSoft: 'var(--brand-line)',
};

interface Dash {
  can_approve: boolean;
  kpis: {
    players: number; teams: number;
    ongoing_events: number; upcoming_events: number;
    awaiting_approval: number; certificates_pending: number; live_now: number;
  };
  queue: Array<{ key: string; text: string; sub: string; cta: string; to: string; tone: 'amber' | 'brand' }>;
  trend: Array<{ season: number; label: string; participants: number }>;
  yoy: number | null;
  upcoming: Array<{ id: string; name: string; status: string; start_date: string; end_date: string; venue: string | null }>;
  achievements: Array<{ id: string; name: string; title: string; tag: string; occurred_on: string }>;
}

const card: React.CSSProperties = {
  background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: 18,
};

function initials(name: string) {
  // Letters and digits only - a team called "Carrom (Mixed)" must not initialise to "C(".
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '—';
}

export function OrgDashboardPage() {
  const { ctx } = useAuth();
  const navigate = useNavigate();
  const { orgId: routeOrgId } = useParams();
  const orgId = routeOrgId ?? ctx?.organization?.id ?? ctx?.user.organization_id ?? '';
  const canManage = usePermissions().canManageOrg(orgId);
  const ws = useWorkspace();
  const onboarding = usePocOnboarding(orgId, canManage);
  const { data, isLoading } = useApi<Dash>(orgId ? `/organizations/${orgId}/dashboard` : null);

  const canCreateEvent = ws.granted.has('create_event');
  const first = (ctx?.user?.name ?? '').split(' ')[0];
  const waiting = data?.kpis.awaiting_approval ?? 0;

  const KPIS: Array<[string, number, React.ReactNode, boolean]> = data ? [
    ['Players', data.kpis.players, <Users size={19} />, false],
    ['Teams', data.kpis.teams, <Shield size={19} />, false],
    // Running and not-yet-started are separate cards. They used to share one, so an
    // institution with three championships in progress was told it had three
    // "upcoming" - the opposite of the thing it most needed to see.
    ['Championships running', data.kpis.ongoing_events ?? 0, <Radio size={19} />, false],
    ['Upcoming events', data.kpis.upcoming_events, <CalendarDays size={19} />, false],
    ['Awaiting approval', data.kpis.awaiting_approval, <ClipboardList size={19} />, false],
    ['Certificates pending', data.kpis.certificates_pending, <Award size={19} />, false],
    // The one card that means "look now" rather than "look sometime".
    // Matches in progress, not championships - a different question, and the only
    // card on this row that means "look at this right now".
    ['Matches live now', data.kpis.live_now, <Radio size={19} />, true],
  ] : [];

  const peak = Math.max(1, ...(data?.trend ?? []).map((t) => t.participants));

  if (isLoading) return <Spinner />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 60 }}>

      {/* ---- hero ---- */}
      <div style={{
        background: C.deep, borderRadius: 14, padding: 22, color: '#fff',
        display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ minWidth: 240 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: C.onDeep }}>
            System of record · live
          </div>
          <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 19, marginTop: 7 }}>
            {first ? `Welcome back, ${first}. ` : ''}
            {waiting > 0
              ? `${waiting} ${waiting === 1 ? 'thing needs' : 'things need'} your attention today.`
              : 'Nothing is waiting on you today.'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => canCreateEvent && navigate('/championships/new')}
          disabled={!canCreateEvent}
          title={canCreateEvent ? undefined : 'Creating events needs the Create event capability on your plan'}
          style={{
            flex: 'none', padding: '11px 18px', border: 'none', borderRadius: 10,
            fontFamily: POP, fontWeight: 700, fontSize: 13.5,
            ...(canCreateEvent
              ? { background: C.onDeep, color: C.deep, cursor: 'pointer' }
              : { background: 'rgba(255,255,255,.12)', color: 'var(--faint)', cursor: 'not-allowed' }),
          }}
        >
          {canCreateEvent ? '+ Create Event' : 'Create Event · locked'}
        </button>
      </div>

      {/* ---- kpis ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
        {KPIS.map(([label, value, icon, brand]) => (
          <div key={label} style={{
            ...card, padding: 16,
            ...(brand && value > 0 ? { background: C.deep, border: 'none' } : {}),
          }}>
            <span style={{
              display: 'flex', width: 19, height: 19,
              color: brand && value > 0 ? C.onDeep : C.brand,
            }}>{icon}</span>
            <div style={{
              fontFamily: MONO, fontWeight: 700, fontSize: 26, marginTop: 11, letterSpacing: '-.02em',
              color: brand && value > 0 ? '#fff' : C.ink,
            }}>{value}</div>
            <div style={{
              fontSize: 12, marginTop: 2,
              color: brand && value > 0 ? '#C2CEDF' : C.fg4,
            }}>{label}</div>
          </div>
        ))}
      </div>

      {/* ---- getting started, only while it is still unfinished ---- */}
      {canManage && !onboarding.complete && (
        <GettingStarted
          title="Get your organization match-ready"
          subtitle="A few steps to go from sign-up to a locked roster."
          state={onboarding}
          storageKey={`onboarding-poc-${orgId}`}
          completeNote="That covered one team. If your organization fields multiple teams, repeat these steps for each - create another team, enter it into a championship, then build and lock its roster."
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))', gap: 16 }}>
        {/* ---- queue ---- */}
        <div style={card}>
          <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 16 }}>Needs attention</div>
          <p style={{ margin: '3px 0 12px', fontSize: 12.5, color: C.fg4, lineHeight: 1.55 }}>
            Approvals only. Scorecard locking, achievement validation and certificate issuance
            belong to the event workspace, not to organisation admin.
          </p>
          {(data?.queue ?? []).length === 0 ? (
            <p style={{ margin: 0, fontSize: 13.5, color: C.fg4 }}>Nothing is waiting. Everything raised so far has been dealt with.</p>
          ) : data!.queue.map((q) => (
            <div key={q.key} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: '1px solid #EFF2F7',
            }}>
              <span aria-hidden style={{
                width: 30, height: 30, flex: 'none', borderRadius: 9, display: 'grid', placeItems: 'center',
                background: q.tone === 'amber' ? C.amberSoft : C.brandSoft,
                color: q.tone === 'amber' ? C.amber : C.brand,
              }}>
                {q.key === 'people' ? <Users size={15} /> : q.key === 'certificates' ? <Award size={15} /> : <ClipboardList size={15} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)' }}>{q.text}</div>
                <div style={{ fontSize: 12, color: C.fg4 }}>{q.sub}</div>
              </div>
              <Link to={q.to} style={{ fontFamily: POP, fontWeight: 700, fontSize: 13, color: C.brand, textDecoration: 'none' }}>
                {q.cta} →
              </Link>
            </div>
          ))}
        </div>

        {/* ---- participation trend ---- */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 16 }}>Participation trend</div>
            {/* No fabricated comparison: the first season has no predecessor. */}
            {data?.yoy != null && (
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: data.yoy >= 0 ? '#1E9E5A' : '#DE3A3A' }}>
                {data.yoy >= 0 ? '▲' : '▼'} {Math.abs(data.yoy)}% YoY
              </span>
            )}
          </div>
          <p style={{ margin: '3px 0 14px', fontSize: 12.5, color: C.fg4 }}>Unique participants per season.</p>
          {(data?.trend ?? []).length === 0 ? (
            <p style={{ margin: 0, fontSize: 13.5, color: C.fg4 }}>No seasons with participation yet.</p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 130 }}>
              {data!.trend.map((t) => (
                <div key={t.season} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: C.ink, marginBottom: 5 }}>{t.participants}</div>
                  <div style={{
                    height: Math.max(4, Math.round((t.participants / peak) * 92)),
                    background: C.brand, borderRadius: '5px 5px 0 0', opacity: 0.85,
                  }} />
                  <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.fg4, marginTop: 6 }}>{t.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))', gap: 16 }}>
        {/* ---- upcoming & live ---- */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 16 }}>Upcoming &amp; live events</div>
            <Link to={`/organizations/${orgId}/events`} style={{ fontSize: 12.5, fontWeight: 700, color: C.brand, textDecoration: 'none' }}>
              All events →
            </Link>
          </div>
          {(data?.upcoming ?? []).length === 0 ? (
            <p style={{ margin: '10px 0 0', fontSize: 13.5, color: C.fg4 }}>Nothing scheduled. Applications you make show up here once approved.</p>
          ) : data!.upcoming.map((e) => {
            const d = new Date(e.start_date);
            return (
              <Link key={e.id} to={`/championships/${e.id}`} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0',
                borderTop: '1px solid #EFF2F7', textDecoration: 'none',
              }}>
                <span aria-hidden style={{
                  width: 42, flex: 'none', textAlign: 'center', borderRadius: 9,
                  background: '#F4F7FB', padding: '5px 0',
                }}>
                  <span style={{ display: 'block', fontFamily: MONO, fontWeight: 700, fontSize: 15, color: C.ink }}>
                    {d.getDate()}
                  </span>
                  <span style={{ display: 'block', fontFamily: MONO, fontSize: 9, color: C.fg4, textTransform: 'uppercase' }}>
                    {d.toLocaleString('en-GB', { month: 'short' })}
                  </span>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)' }}>{e.name}</div>
                  <div style={{ fontSize: 12, color: C.fg4 }}>{e.venue || 'Venue TBD'}</div>
                </div>
                <StatusBadge status={e.status} />
              </Link>
            );
          })}
        </div>

        {/* ---- recent achievements ---- */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 16 }}>Recent achievements</div>
            <Link to={`/organizations/${orgId}/achievements`} style={{ fontSize: 12.5, fontWeight: 700, color: C.brand, textDecoration: 'none' }}>
              All →
            </Link>
          </div>
          {(data?.achievements ?? []).length === 0 ? (
            <p style={{ margin: '10px 0 0', fontSize: 13.5, color: C.fg4 }}>
              Nothing yet. Achievements are written when a scorecard locks — they are not entered by hand.
            </p>
          ) : data!.achievements.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: '1px solid #EFF2F7' }}>
              <span aria-hidden style={{
                width: 32, height: 32, flex: 'none', borderRadius: '50%', display: 'grid', placeItems: 'center',
                background: C.brandSoft, color: C.brand, fontFamily: POP, fontWeight: 800, fontSize: 11.5,
              }}>{initials(a.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)' }}>{a.name}</div>
                <div style={{ fontSize: 12, color: C.fg4 }}>{a.title}</div>
              </div>
              <Badge tone={a.tag === 'GOLD' ? 'amber' : a.tag === 'TEAM' ? 'slate' : 'brand'}>{titleCase(a.tag)}</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
