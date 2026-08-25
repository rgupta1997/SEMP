import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';
import { Avatar, BackButton, Badge, EmptyState, Spinner } from '../../components/ui';

// One player, as their institution sees them (PG-21b).
//
// The page is built around a line the product cannot afford to blur: what the
// player says about themselves, and what locked scorecards said about them. The
// first is editable and belongs to them. The second is not editable by anybody -
// not the player, not the institution, not an administrator who would rather it
// read differently - and the page says so in as many words.

const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";
const C = { ink: '#0A1A33', line: '#E1E7F0', fg4: '#6E7E96', brand: '#004AAD', green: '#1E9E5A' };

interface Profile {
  person: {
    id: string; name: string; email: string | null; phone: string | null;
    sportagon_id: string | null; handle: string | null; tagline: string | null;
    preferred_sports: string[]; avatar_url: string | null;
  };
  totals?: {
    medals?: { gold: number; silver: number; bronze: number };
    awards?: number;
    outcomes?: { won: number; lost: number; drew: number };
    entries?: number;
  };
  entries?: Array<{ id: string; date: string; title: string; kind: string; verified: boolean }>;
  achievements?: Array<{ id: string; title: string; medal: string | null; date?: string; occurred_on?: string }>;
}

const card: React.CSSProperties = {
  background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: 18,
};

function Section({ title, chip, chipTone, children, note }: {
  title: string; chip: string; chipTone: 'editable' | 'locked'; children: React.ReactNode; note?: string;
}) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 16, flex: 1 }}>{title}</div>
        <span style={{
          fontFamily: MONO, fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase',
          padding: '3px 8px', borderRadius: 6,
          ...(chipTone === 'editable'
            ? { background: '#DFEAFB', color: C.brand }
            : { background: '#EFF2F7', color: '#4F5F77' }),
        }}>{chip}</span>
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
      {note && (
        <p style={{ margin: '12px 0 0', fontSize: 12.5, color: C.fg4, lineHeight: 1.55 }}>{note}</p>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '9px 0', borderTop: '1px solid #EFF2F7' }}>
      <span style={{ flex: '0 0 40%', fontSize: 13, color: C.fg4 }}>{k}</span>
      <span style={{ flex: 1, fontSize: 13.5, color: '#14233B', minWidth: 0 }}>{v}</span>
    </div>
  );
}

export function PlayerDetailPage() {
  const navigate = useNavigate();
  const { orgId = '', userId = '' } = useParams();
  const { ctx } = useAuth();
  const { data, isLoading, error } = useApi<Profile>(userId ? `/people/${userId}/profile` : null);
  // The membership row carries what the INSTITUTION knows: roll number, programme,
  // whether they have been verified. That is org-scoped and does not belong on the
  // person's own record.
  const { data: people = [] } = useApi<any[]>(orgId ? `/organizations/${orgId}/people` : null);
  const member = people.find((p) => p.user_id === userId);

  if (isLoading) return <Spinner />;
  if (error) {
    return (
      <div>
        <BackButton onClick={() => navigate(`/organizations/${orgId}/students`)}>Back to players</BackButton>
        <EmptyState
          icon="🔒"
          title="You cannot open this record"
          description={(error as any).message ?? 'You can only open the record of someone in an institution you belong to.'}
        />
      </div>
    );
  }
  if (!data) return null;

  const p = data.person;
  const medals = data.totals?.medals ?? { gold: 0, silver: 0, bronze: 0 };
  const outcomes = data.totals?.outcomes ?? { won: 0, lost: 0, drew: 0 };
  const played = outcomes.won + outcomes.lost + outcomes.drew;
  const isSelf = ctx?.user?.id === userId;

  const STATS: Array<[string, string | number]> = [
    ['Events played', data.entries?.length ?? 0],
    ['Matches', played],
    ['Won', outcomes.won],
    ['Medals', medals.gold + medals.silver + medals.bronze],
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 60 }}>
      <BackButton onClick={() => navigate(`/organizations/${orgId}/students`)}>Back to players</BackButton>

      {/* ---- identity ---- */}
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <Avatar name={p.name} size={56} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 21 }}>{p.name}</div>
          <div style={{ fontSize: 13, color: C.fg4 }}>
            {[member?.member_code, member?.org_unit_name, p.email].filter(Boolean).join(' · ') || 'No details on file'}
          </div>
          {p.sportagon_id && (
            <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.brand, marginTop: 4 }}>{p.sportagon_id}</div>
          )}
        </div>
        {member && (
          <Badge tone={member.verification === 'verified' ? 'green' : member.verification === 'rejected' ? 'rose' : 'amber'}>
            {member.verification}
          </Badge>
        )}
      </div>

      {/* ---- headline numbers ----
           Every one of these comes from locked results, which is why they can read
           lower than the directory: the directory counts what somebody has been
           ENTERED into, and being entered is not the same as having played. Said on
           screen, because two numbers under the same word is how people stop
           trusting both. */}
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12 }}>
          {STATS.map(([k, v]) => (
            <div key={k} style={{ ...card, padding: 16 }}>
              <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 24, color: C.ink }}>{v}</div>
              <div style={{ fontSize: 12, color: C.fg4, marginTop: 2 }}>{k}</div>
            </div>
          ))}
        </div>
        <p style={{ margin: '8px 2px 0', fontSize: 12, color: C.fg4 }}>
          From locked results only. Being entered into an event is not the same as
          having played one, so these can read lower than the directory.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
        <Section
          title="Player controlled"
          chip="Editable"
          chipTone="editable"
          note={isSelf
            ? 'Yours to change, from your sports profile.'
            : 'Theirs to change. An institution can see these, and cannot edit them.'}
        >
          <Row k="Tagline" v={p.tagline || <span style={{ color: '#9BA9BE' }}>Not set</span>} />
          <Row k="Preferred sports" v={p.preferred_sports?.length
            ? p.preferred_sports.join(', ')
            : <span style={{ color: '#9BA9BE' }}>Not set</span>} />
          <Row k="Public handle" v={p.handle
            ? <span style={{ fontFamily: MONO, fontSize: 12.5 }}>/p/{p.handle}</span>
            : <span style={{ color: '#9BA9BE' }}>Not published</span>} />
          <Row k="Contact" v={[p.email, p.phone].filter(Boolean).join(' · ') || '—'} />
        </Section>

        <Section
          title="Verified records"
          chip="Locked"
          chipTone="locked"
          note="Written by locked scorecards and issuing organizations. Not editable by the player or the institution."
        >
          <Row k="Gold" v={<span style={{ fontFamily: MONO }}>{medals.gold}</span>} />
          <Row k="Silver" v={<span style={{ fontFamily: MONO }}>{medals.silver}</span>} />
          <Row k="Bronze" v={<span style={{ fontFamily: MONO }}>{medals.bronze}</span>} />
          <Row k="Awards" v={<span style={{ fontFamily: MONO }}>{data.totals?.awards ?? 0}</span>} />
          <Row k="Record" v={<span style={{ fontFamily: MONO }}>{outcomes.won}W · {outcomes.lost}L · {outcomes.drew}D</span>} />
        </Section>
      </div>

      {/* ---- the entries themselves ---- */}
      <div style={card}>
        <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 16 }}>Lifetime entries</div>
        <p style={{ margin: '3px 0 8px', fontSize: 12.5, color: C.fg4 }}>
          Written to their record when a scorecard locked. Newest first.
        </p>
        {(data.entries ?? []).length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: C.fg4 }}>Nothing yet. Entries appear when a scorecard locks.</p>
        ) : data.entries!.slice(0, 25).map((e) => (
          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid #EFF2F7' }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.fg4, flex: 'none', width: 84 }}>
              {new Date(e.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
            </span>
            <span style={{ flex: 1, fontSize: 13.5, color: '#14233B', minWidth: 0 }}>{e.title}</span>
            {/* Provisional rows sit on the same list, badged - hiding them would make
                the page disagree with what the player saw on their own profile. */}
            <span style={{
              fontFamily: MONO, fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase',
              color: e.verified ? C.green : '#E9920B',
            }}>{e.verified ? 'Verified' : 'Provisional'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
