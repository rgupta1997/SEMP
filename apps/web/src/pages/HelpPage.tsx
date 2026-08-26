import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useWorkspace } from '../lib/useWorkspace';
import { PageHeader } from '../components/ui';

// Help & Guides (PG-05, F-034..F-036).
//
// The four rules are the centrepiece, not filler. The breakdown calls them the
// clearest statement of the architecture anywhere in the product, and they are what
// makes the rest of it legible: why the sidebar changed when you switched, why a
// page is there but locked, why your colleague sees something you do not.
//
// The tracks are role-aware because a guide library that opens on "how to run a
// championship" for someone who only plays is a library nobody reads.

const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";

const RULES = [
  ['Login', 'Identifies the human. One account, every side of sport — player, official, admin.'],
  ['Context', 'Decides what you see. Switching to an organisation or an event changes the whole workspace.'],
  ['Role', 'Decides what you can do, and at which scope — the whole organisation, one campus, one event.'],
  ['Subscription', 'Decides what is available at all. A locked page names the capability it needs, never a price.'],
] as const;

interface Track { key: string; title: string; blurb: string; guides: Array<[string, string]> }

const TRACKS: Track[] = [
  {
    key: 'playing', title: 'Playing',
    blurb: 'Finding events, joining squads, and what happens to your record.',
    guides: [
      ['Finding something to play', '3 min'],
      ['What a verified record means', '4 min'],
      ['Your Sportagon ID, and why it follows you', '2 min'],
      ['Making your profile public', '2 min'],
    ],
  },
  {
    key: 'team', title: 'Running a team',
    blurb: 'Squads, entries and the season.',
    guides: [
      ['Building a squad', '4 min'],
      ['Entering a team into an event', '3 min'],
      ['Captains, coaches and managers', '2 min'],
    ],
  },
  {
    key: 'officiating', title: 'Officiating',
    blurb: 'The console, submitting, and what locking does.',
    guides: [
      ['Scoring a match', '5 min'],
      ['Submitting a scorecard', '2 min'],
      ['Why a locked result cannot be edited', '3 min'],
    ],
  },
  {
    key: 'organising', title: 'Organising',
    blurb: 'Setting up an event and running it to a result.',
    guides: [
      ['Creating and publishing an event', '6 min'],
      ['Approving participants', '3 min'],
      ['Generating fixtures', '4 min'],
      ['Standings, tie-breaks and medals', '5 min'],
    ],
  },
  {
    key: 'admin', title: 'Administering',
    blurb: 'People, roles and what your plan includes.',
    guides: [
      ['Roles, scope, and who sees what', '5 min'],
      ['Inviting and verifying people', '3 min'],
      ['Reading the audit trail', '2 min'],
    ],
  },
];

/** Services worth telling somebody about when they are not working. */
const SERVICES = [
  ['Live scoring', 'operational'],
  ['Certificates and QR verification', 'operational'],
  ['Reports and exports', 'operational'],
  ['Email delivery', 'degraded'],
  ['SMS delivery', 'degraded'],
] as const;

const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #E1E7F0', borderRadius: 14, padding: 20,
};

export function HelpPage() {
  const { ctx } = useAuth();
  const ws = useWorkspace();

  // Which tracks matter to this person, derived from what they actually hold rather
  // than from a stored preference - somebody who is made an official on Tuesday
  // should find the officiating guides on Tuesday.
  const roles = new Set(ws.contexts.flatMap((c) => c.roleCodes));
  const officiates = !!(ctx as any)?.user?.officiates || (ctx?.official_championship_ids ?? []).length > 0;
  const organises = roles.has('organiser') || roles.has('poc');
  const admins = ['owner', 'org_admin', 'sports_admin', 'billing_admin', 'reporting_admin'].some((r) => roles.has(r));
  const captains = roles.has('captain');

  const relevant = TRACKS.filter((t) =>
    t.key === 'playing'
    || (t.key === 'team' && (captains || admins))
    || (t.key === 'officiating' && officiates)
    || (t.key === 'organising' && organises)
    || (t.key === 'admin' && admins));

  const headline = admins ? 'Running sport here'
    : organises ? 'Organising events'
      : officiates ? 'Officiating and playing'
        : 'Playing sport here';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: 60 }}>
      <PageHeader title="Help & guides" subtitle={headline} />

      {/* ---- the four rules ---- */}
      <div style={{ ...card, background: '#0A1A33', border: 'none', color: '#fff' }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#5CE1E6' }}>
          How this product thinks
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 18, marginTop: 16 }}>
          {RULES.map(([k, v]) => (
            <div key={k}>
              <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 15, color: '#5CE1E6' }}>{k}</div>
              <p style={{ margin: '5px 0 0', fontSize: 13.5, color: '#C2CEDF', lineHeight: 1.6 }}>{v}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ---- tracks ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
        {relevant.map((t) => (
          <div key={t.key} style={card}>
            <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 16 }}>{t.title}</div>
            <p style={{ margin: '3px 0 10px', fontSize: 13, color: '#6E7E96' }}>{t.blurb}</p>
            {t.guides.map(([title, mins]) => (
              <div key={title} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid #EFF2F7',
              }}>
                <span style={{ flex: 1, fontSize: 13.5, color: '#14233B' }}>{title}</span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: '#9BA9BE' }}>{mins}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ---- status ---- */}
      <div style={card}>
        <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Service status</div>
        <p style={{ margin: '0 0 8px', fontSize: 13, color: '#6E7E96' }}>
          What is working, and what is not wired yet.
        </p>
        {SERVICES.map(([name, state]) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid #EFF2F7' }}>
            <span aria-hidden style={{
              width: 9, height: 9, borderRadius: '50%',
              background: state === 'operational' ? '#1E9E5A' : '#E9920B',
            }} />
            <span style={{ flex: 1, fontSize: 13.5, color: '#14233B' }}>{name}</span>
            <span style={{
              fontFamily: MONO, fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase',
              color: state === 'operational' ? '#1E9E5A' : '#E9920B',
            }}>{state}</span>
          </div>
        ))}
        {/* Honest rather than green: both delivery services are bypassed, and a fake
            green light is worse than no light at all. */}
        <p style={{ margin: '12px 0 0', fontSize: 12.5, color: '#6E7E96', lineHeight: 1.55 }}>
          Email and SMS are in bypass: codes are shown on screen instead of being sent. Everything else
          runs normally.
        </p>
      </div>

      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 15 }}>Still stuck?</div>
          <p style={{ margin: '2px 0 0', fontSize: 13.5, color: '#6E7E96' }}>
            play@sportagon.in · +91 72760 88888 — WhatsApp on the same number.
          </p>
        </div>
        <Link to="/profile" style={{ fontFamily: POP, fontWeight: 700, fontSize: 13.5, color: '#004AAD', textDecoration: 'none' }}>
          Your profile settings →
        </Link>
      </div>
    </div>
  );
}
