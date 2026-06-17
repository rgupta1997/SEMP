import { useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEMO_REQUEST_ROLES } from '@semp/shared';
import { api } from '../lib/api';
import { useTheme } from '../lib/theme';

// ─────────────────────────────────────────────────────────────────────────────
// Sportagon EOS — public marketing landing page.
//
// Recreated from the "Sportagon EOS Landing" Claude Design handoff. Copy has been
// aligned to what SEMP actually ships (e.g. in-app notifications rather than the
// prototype's WhatsApp wording, and no fabricated usage metrics). The "Book a demo"
// form posts to the public POST /demo-requests endpoint; captured leads are only
// visible to platform super-admins (see PlatformDemoRequestsPage).
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  blue: '#004AAD', blue8: '#013C8B', blue50: '#F1F6FE', teal: '#5CE1E6',
  teal6: '#159FA6', navy: '#0A1A33', fg2: '#374459', fg3: '#6E7E96', line: '#E1E7F0',
};
const POP = "'Poppins',sans-serif";
const HANK = "'Hanken Grotesk',system-ui,sans-serif";
const MONO = "'JetBrains Mono',monospace";
// Width of the centered content column. Wider than the original prototype's 1180
// so the layout uses more of the viewport on large screens.
const MAXW = 1320;

// Small helper for the lucide-style stroked icons used throughout the design.
function Icon({ d, size = 23, fill = 'none' }: { d: string; size?: number; fill?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={fill} stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: d }} />
  );
}

const MARK = (
  <svg width="20" height="20" viewBox="0 0 100 100">
    <path d="M50 4 L89 27 V73 L50 96 L11 73 V27 Z" fill="#004AAD" />
    <path d="M61 38 q-11-7-20 0 q-7 6 0 12 q11 6 0 12 q-9 7-20 0" stroke="#5CE1E6" strokeWidth="7" strokeLinecap="round" fill="none" />
  </svg>
);

interface Feature {
  title: string; step: string; icon: string; teaser: string; detail: string;
  tags: string[]; crumb: string; preview: ReactNode;
}

const monoLabel = (text: string, color = C.fg3): CSSProperties => ({
  fontFamily: MONO, fontSize: 10, fontWeight: 700, color, letterSpacing: '.1em',
});

const FEATURES: Feature[] = [
  {
    title: 'Championship Builder', step: 'STEP 01', crumb: 'CHAMPIONSHIP SETUP',
    icon: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    teaser: 'One wizard to launch a full multi-sport meet.',
    detail: 'Pick your sports, set disciplines like Boys U14 or Girls U16, choose League, Knockout or Hybrid — and publish a draft in minutes.',
    tags: ['Multi-sport', 'Age categories', 'League / KO / Hybrid'],
    preview: (
      <>
        <div style={monoLabel('NEW CHAMPIONSHIP')}>NEW CHAMPIONSHIP</div>
        <div style={{ marginTop: 11, border: `1px solid #E8ECF3`, borderRadius: 11, padding: '13px 14px' }}>
          <div style={{ ...monoLabel('NAME', '#9BA9BE'), fontSize: 9 }}>NAME</div>
          <div style={{ fontFamily: POP, fontWeight: 700, fontSize: 16, marginTop: 3 }}>District School Games 2026</div>
        </div>
        <div style={{ ...monoLabel('SPORTS', '#9BA9BE'), fontSize: 9, marginTop: 15 }}>SPORTS</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: C.blue, padding: '6px 12px', borderRadius: 999 }}>Cricket ✓</span>
          {['Football', 'Athletics', 'Kabaddi'].map((s) => (
            <span key={s} style={{ fontSize: 12, fontWeight: 600, color: C.fg2, background: '#EFF2F7', padding: '6px 12px', borderRadius: 999 }}>{s}</span>
          ))}
        </div>
        <div style={{ ...monoLabel('DISCIPLINES', '#9BA9BE'), fontSize: 9, marginTop: 15 }}>DISCIPLINES</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 8 }}>
          {['Boys U14', 'Girls U16', 'Open'].map((d) => (
            <span key={d} style={{ fontSize: 12, fontWeight: 600, color: C.teal6, background: '#EAF7F8', border: '1px solid #BFE7E9', padding: '6px 12px', borderRadius: 8 }}>{d}</span>
          ))}
        </div>
        <div style={{ ...monoLabel('FORMAT', '#9BA9BE'), fontSize: 9, marginTop: 15 }}>FORMAT</div>
        <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
          <span style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 600, color: C.fg2, background: '#fff', border: `1px solid ${C.line}`, padding: 8, borderRadius: 8 }}>League</span>
          <span style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 700, color: C.blue, background: '#EAF1FD', border: '1px solid #BCD2F6', padding: 8, borderRadius: 8 }}>Knockout</span>
          <span style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 600, color: C.fg2, background: '#fff', border: `1px solid ${C.line}`, padding: 8, borderRadius: 8 }}>Hybrid</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 17 }}>
          <div style={{ background: C.blue, color: '#fff', fontFamily: POP, fontWeight: 700, fontSize: 13, padding: '10px 16px', borderRadius: 9 }}>Publish draft</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: '#9BA9BE' }}>Step 1 of 4</div>
        </div>
      </>
    ),
  },
  {
    title: 'Registrations & Rosters', step: 'STEP 02', crumb: 'REGISTRATIONS',
    icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    teaser: 'Onboard every school, team and athlete.',
    detail: 'Open or invite-only entries, bulk CSV import, captain assignment and roster review — approve registrations with one tap.',
    tags: ['Bulk CSV upload', 'Captain assignment', 'Roster review'],
    preview: (
      <>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={monoLabel('PARTICIPATING SCHOOLS')}>PARTICIPATING SCHOOLS</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: C.blue, background: '#EAF1FD', padding: '6px 11px', borderRadius: 8 }}>
            <Icon size={13} d='<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>' />Import CSV
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {[
            { i: 'SX', n: "St. Xavier's", t: 'CRICKET · FOOTBALL · CAPT. A. RAO', s: 'APPROVED', ok: true },
            { i: 'GH', n: 'Greenwood High', t: 'ATHLETICS · CAPT. PENDING', s: 'PENDING', ok: false },
            { i: 'OR', n: 'Oakridge Intl', t: 'KABADDI · CAPT. M. SHAIKH', s: 'APPROVED', ok: true },
          ].map((r) => (
            <div key={r.i} style={{ border: '1px solid #E8ECF3', borderRadius: 11, padding: '12px 13px', display: 'flex', alignItems: 'center', gap: 11 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: C.navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontWeight: 700, fontSize: 11 }}>{r.i}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{r.n}</div>
                <div style={{ fontFamily: MONO, fontSize: 9.5, color: '#9BA9BE', marginTop: 2 }}>{r.t}</div>
              </div>
              <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: r.ok ? '#1E9E5A' : '#b86a14', background: r.ok ? '#E4F6EC' : '#FCF0DB', padding: '5px 9px', borderRadius: 999 }}>{r.s}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontFamily: MONO, fontSize: 11, color: C.fg3 }}>
          <span style={{ color: C.blue, fontWeight: 700 }}>24 teams</span> · <span style={{ color: C.blue, fontWeight: 700 }}>312 athletes</span> registered
        </div>
      </>
    ),
  },
  {
    title: 'Auto Fixtures', step: 'STEP 03', crumb: 'FIXTURES',
    icon: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M16 2v4"/><path d="m9 16 2 2 4-4"/>',
    teaser: 'Clash-free schedules in one click.',
    detail: 'Generate full fixtures across venues and grounds, auto-detect team clashes, fine-tune by hand, then publish and notify everyone instantly.',
    tags: ['Auto-scheduling', 'Conflict detection', 'Publish & notify'],
    preview: (
      <>
        <div style={monoLabel('FIXTURES · CRICKET')}>FIXTURES · CRICKET</div>
        <div style={{ marginTop: 11, display: 'flex', alignItems: 'center', gap: 10, background: '#E4F6EC', border: '1px solid #BBE6CC', borderRadius: 11, padding: '11px 13px' }}>
          <Icon size={18} d='<path d="M20 6 9 17l-5-5"/>' /><div style={{ fontSize: 13, fontWeight: 600, color: '#14233B' }}>48 fixtures generated · <span style={{ color: '#1E9E5A', fontWeight: 700 }}>0 clashes</span></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {[
            { d: 'SAT', n: '12', m: "St. Xavier's vs Oakridge", at: '09:00 · GROUND A', tag: 'R1', live: false },
            { d: 'SAT', n: '12', m: 'Greenwood vs Hilltop', at: '11:30 · GROUND B', tag: 'LIVE', live: true },
            { d: 'SUN', n: '13', m: 'Oakridge vs Greenwood', at: '10:00 · GROUND A', tag: 'R2', live: false },
          ].map((r, idx) => (
            <div key={idx} style={{ border: `1px solid ${r.live ? '#BCD2F6' : '#E8ECF3'}`, borderRadius: 11, padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 13 }}>
              <div style={{ textAlign: 'center', width: 42 }}>
                <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: C.blue }}>{r.d}</div>
                <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 17, lineHeight: 1 }}>{r.n}</div>
              </div>
              <div style={{ width: 1, height: 30, background: '#EDEFF3' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.m}</div>
                <div style={{ fontFamily: MONO, fontSize: 9, color: '#9BA9BE', marginTop: 2 }}>{r.at}</div>
              </div>
              {r.live ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: MONO, fontSize: 9, fontWeight: 700, color: '#DE3A3A', background: '#FBE6E6', padding: '4px 8px', borderRadius: 999 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#DE3A3A' }} />LIVE
                </span>
              ) : (
                <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: C.fg3, background: '#EFF2F7', padding: '4px 8px', borderRadius: 999 }}>{r.tag}</span>
              )}
            </div>
          ))}
        </div>
      </>
    ),
  },
  {
    title: 'Match Centre', step: 'STEP 04', crumb: 'MATCH CENTRE',
    icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    teaser: 'Live scores, results and walkovers — verified.',
    detail: 'Run each match from scheduled to completed, enter live scores, handle walkovers, and have organisers approve results before they go public.',
    tags: ['Live score entry', 'Result approval', 'Walkovers'],
    preview: (
      <>
        <div style={monoLabel('MATCH CENTRE · FOOTBALL SF')}>MATCH CENTRE · FOOTBALL SF</div>
        <div style={{ marginTop: 11, background: C.navy, borderRadius: 13, padding: 16, color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontWeight: 700, fontSize: 9.5, letterSpacing: '.08em', color: C.teal }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#DE3A3A' }} />LIVE · 67'
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <span style={{ fontFamily: POP, fontWeight: 700, fontSize: 16 }}>Riverside FC</span>
            <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 26 }}>2</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <span style={{ fontFamily: POP, fontWeight: 700, fontSize: 16, color: '#9BA9BE' }}>Hilltop Utd</span>
            <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 26, color: '#9BA9BE' }}>1</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 13 }}>
          <span style={{ flex: 1, textAlign: 'center', fontFamily: MONO, fontSize: 9.5, fontWeight: 700, color: '#1E9E5A', background: '#E4F6EC', padding: 7, borderRadius: 8 }}>SCHEDULED ✓</span>
          <span style={{ color: '#C8D2E0' }}>→</span>
          <span style={{ flex: 1, textAlign: 'center', fontFamily: MONO, fontSize: 9.5, fontWeight: 700, color: C.blue, background: '#EAF1FD', padding: 7, borderRadius: 8, border: '1px solid #BCD2F6' }}>LIVE</span>
          <span style={{ color: '#C8D2E0' }}>→</span>
          <span style={{ flex: 1, textAlign: 'center', fontFamily: MONO, fontSize: 9.5, fontWeight: 700, color: '#9BA9BE', background: '#F2F4F7', padding: 7, borderRadius: 8 }}>COMPLETED</span>
        </div>
        <div style={{ marginTop: 13, display: 'flex', alignItems: 'center', gap: 10, background: '#FCF0DB', border: '1px solid #F2D9A8', borderRadius: 10, padding: '11px 13px' }}>
          <div style={{ flex: 1, fontSize: 12.5, color: '#7a5311', fontWeight: 600 }}>Result submitted — awaiting organiser approval</div>
          <div style={{ background: C.blue, color: '#fff', fontSize: 11, fontWeight: 700, padding: '7px 12px', borderRadius: 8 }}>Approve</div>
        </div>
      </>
    ),
  },
  {
    title: 'Standings & Medal Tally', step: 'STEP 05', crumb: 'STANDINGS',
    icon: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
    teaser: 'Points tables and medals update themselves.',
    detail: 'Every result rolls straight into configurable points tables and a championship-wide medal tally — no recalculating, no disputes.',
    tags: ['Auto points table', 'Medal tally', 'Multi-sport'],
    preview: (
      <>
        <div style={{ display: 'flex', gap: 7, marginBottom: 13 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#9BA9BE', background: '#F2F4F7', padding: '6px 13px', borderRadius: 999 }}>Points</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: C.blue, padding: '6px 13px', borderRadius: 999 }}>Medal tally</span>
        </div>
        <div style={{ border: '1px solid #E8ECF3', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 38px 38px 38px 44px', background: '#F7F9FC', padding: '9px 13px', fontFamily: MONO, fontSize: 9, fontWeight: 700, color: '#9BA9BE', letterSpacing: '.06em' }}>
            <span>SCHOOL</span><span style={{ textAlign: 'center' }}>G</span><span style={{ textAlign: 'center' }}>S</span><span style={{ textAlign: 'center' }}>B</span><span style={{ textAlign: 'center' }}>TOT</span>
          </div>
          {[
            { n: "St. Xavier's", g: 14, s: 9, b: 7, t: 30 },
            { n: 'Greenwood High', g: 11, s: 12, b: 6, t: 29 },
            { n: 'Oakridge Intl', g: 9, s: 8, b: 10, t: 27 },
          ].map((r) => (
            <div key={r.n} style={{ display: 'grid', gridTemplateColumns: '1fr 38px 38px 38px 44px', padding: '11px 13px', borderTop: '1px solid #EDEFF3', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>{r.n}</span>
              <span style={{ textAlign: 'center', fontFamily: MONO, fontWeight: 700, fontSize: 13, color: '#E9920B' }}>{r.g}</span>
              <span style={{ textAlign: 'center', fontFamily: MONO, fontWeight: 700, fontSize: 13, color: '#9BA9BE' }}>{r.s}</span>
              <span style={{ textAlign: 'center', fontFamily: MONO, fontWeight: 700, fontSize: 13, color: '#b6803f' }}>{r.b}</span>
              <span style={{ textAlign: 'center', fontFamily: MONO, fontWeight: 800, fontSize: 14, color: C.blue }}>{r.t}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 10, color: '#9BA9BE' }}>Updated live · last result 2 min ago</div>
      </>
    ),
  },
  {
    title: 'Notifications & Broadcasts', step: 'STEP 06', crumb: 'BROADCASTS',
    icon: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
    teaser: 'Reach every participant with in-app alerts.',
    detail: 'Fixture and result updates fire into each participant\'s notification feed, and organisers can broadcast a message to everyone — or just captains — in seconds.',
    tags: ['In-app feed', 'Audience targeting', 'Reactions'],
    preview: (
      <>
        <div style={monoLabel('BROADCAST')}>BROADCAST</div>
        <div style={{ marginTop: 11, border: '1px solid #E8ECF3', borderRadius: 12, padding: 13 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: '#14233B', lineHeight: 1.5 }}>Round 2 fixtures are published. Check your match time and venue in the app.</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#EAF1FD', color: C.blue, fontSize: 11, fontWeight: 700, padding: '7px 12px', borderRadius: 8 }}>
              <Icon size={13} d='<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>' />In-app
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#EAF7F8', color: C.teal6, fontSize: 11, fontWeight: 700, padding: '7px 12px', borderRadius: 8 }}>All participants</div>
            <span style={{ flex: 1 }} />
            <div style={{ background: C.blue, color: '#fff', fontSize: 11, fontWeight: 700, padding: '7px 13px', borderRadius: 8 }}>Send to 312</div>
          </div>
        </div>
        <div style={{ ...monoLabel('DELIVERED', '#9BA9BE'), fontSize: 9, marginTop: 15 }}>DELIVERED</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 9 }}>
          {[
            { dot: '#1E9E5A', t: 'Result published: Riverside 2–1 Hilltop', m: '2 MIN AGO · 312 RECIPIENTS' },
            { dot: C.blue, t: 'Fixture reminder: Cricket SF at 09:00', m: '1 HR AGO · 48 RECIPIENTS' },
          ].map((r) => (
            <div key={r.t} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.dot, marginTop: 5 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{r.t}</div>
                <div style={{ fontFamily: MONO, fontSize: 9, color: '#9BA9BE', marginTop: 2 }}>{r.m}</div>
              </div>
            </div>
          ))}
        </div>
      </>
    ),
  },
];

const PERSONAS = [
  { icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6"/><path d="M9 11h2"/>', title: 'Sports Secretaries', body: 'Launch championships, approve entries and keep every sport on schedule from one console.' },
  { icon: '<path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/><path d="m2 9 10-4 10 4-10 4z"/>', title: 'PE Teachers', body: 'Register your squads, assign captains and track every fixture and result for your school.' },
  { icon: '<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/>', title: 'Sports Authorities', body: 'Oversee district meets with live standings, medal tallies and shareable reports for committees.' },
];

const STEPS = [
  { no: '01', title: 'Create', body: 'Build the championship — sports, age categories and format.' },
  { no: '02', title: 'Register', body: 'Onboard schools, teams, athletes and captains. Bulk CSV ready.' },
  { no: '03', title: 'Schedule', body: 'Auto-generate clash-free fixtures, then publish to everyone.' },
  { no: '04', title: 'Play', body: 'Enter live scores and results; walkovers handled cleanly.' },
  { no: '05', title: 'Rank', body: 'Points tables and medal tally update the instant a result lands.' },
];

const BENEFITS = [
  { icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', title: 'Hours back every week', body: 'Auto-generated fixtures and standings replace nights of manual scheduling and tallying.' },
  { icon: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>', title: 'No more spreadsheets', body: 'One source of truth for every school, team, fixture and result — no version chaos.' },
  { icon: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>', title: 'Live transparency', body: 'Players, parents and authorities see results the moment they are entered and approved.' },
  { icon: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>', title: 'Fair & verified', body: 'Roster review and organiser result-approval keep every meet clean and disputes rare.' },
  { icon: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>', title: 'Multi-sport medal tally', body: 'District-level meets ranked automatically across every sport, all season long.' },
  { icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', title: 'Right view for every role', body: 'Organisers, officials, captains, POCs and players each get exactly the access they need — nothing more.' },
];

const FOOTER_COLS = [
  { head: 'Product', items: ['Championship Builder', 'Registrations', 'Auto Fixtures', 'Match Centre', 'Standings & Medals'] },
  { head: 'Built for', items: ['Sports Secretaries', 'PE Teachers', 'Associations', 'Clubs & Academies'] },
  { head: 'Company', items: ['About', 'Contact', 'Privacy', 'Terms'] },
];

// CSS depends on the active theme (nav-link ink + benefit-card hover border), so it
// is built per-render from the resolved tokens rather than being a static constant.
const cssFor = (navlink: string, benefitBorder: string) => `
.sg *{box-sizing:border-box}
.sg ::selection{background:#cdeff0}
.sg a{text-decoration:none;color:inherit}
.sg .navlink{font-size:14.5px;font-weight:600;color:${navlink};transition:color .15s}
.sg .navlink:hover{color:${C.blue}}
.sg .cta{transition:background .15s}
.sg .cta:hover{background:${C.blue8}}
.sg .ghostbtn{transition:border-color .15s,color .15s}
.sg .ghostbtn:hover{border-color:${C.blue};color:${C.blue}}
.sg .benefit{transition:transform .2s,box-shadow .2s,border-color .2s}
.sg .benefit:hover{transform:translateY(-3px);box-shadow:0 22px 44px -28px rgba(10,26,51,.5);border-color:${benefitBorder}}
.sg .footlink{color:#A9B7CC;transition:color .15s}
.sg .footlink:hover{color:#fff}
.sg .footmuted{color:#6E7E96;transition:color .15s}
.sg .footmuted:hover{color:#A9B7CC}
.sg input:focus,.sg select:focus{border-color:${C.blue}}
@keyframes sgpop{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}
.sg .pop{animation:sgpop .5s ease both}
@media (max-width:900px){
  .sg .heroGrid,.sg .featGrid,.sg .demoGrid{grid-template-columns:1fr !important}
  .sg .personaGrid,.sg .benefitGrid{grid-template-columns:1fr !important}
  .sg .flowGrid{grid-template-columns:1fr 1fr !important}
  .sg .footGrid{grid-template-columns:1fr 1fr !important}
  .sg .navlinks{display:none !important}
  .sg .heroTitle{font-size:40px !important}
  .sg .stickyPreview{position:static !important}
}
`;

const labelStyle: CSSProperties = {
  fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '.1em',
  color: C.fg3, textTransform: 'uppercase', display: 'block', marginBottom: 6,
};
const inputStyle: CSSProperties = {
  width: '100%', height: 46, border: '1px solid #D4DAE6', borderRadius: 10,
  padding: '0 14px', fontSize: 14, outline: 'none', background: '#fff', color: C.navy,
};

export function LandingPage() {
  const navigate = useNavigate();
  const [active, setActive] = useState(0);
  const [form, setForm] = useState({ name: '', organization: '', role: '', sport: '', email: '', phone: '' });
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const goLogin = () => navigate('/login');
  const goSignup = () => navigate('/login', { state: { mode: 'signup' } });
  const scrollTo = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  const submit = async () => {
    setError(null);
    if (!form.name.trim() || !form.email.trim()) { setError('Please enter your name and work email.'); return; }
    setBusy(true);
    try {
      await api('POST', '/demo-requests', {
        name: form.name.trim(),
        email: form.email.trim(),
        organization: form.organization.trim() || undefined,
        role: form.role || undefined,
        sport: form.sport.trim() || undefined,
        phone: form.phone.trim() || undefined,
      });
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  const cur = FEATURES[active];

  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  // Theme tokens. Brand accents (blue/teal) and the intentionally-dark navy panels
  // (flow strip, footer, the demo card's left rail, product-mock chrome) stay constant;
  // only the light "paper" surfaces and ink colours flip for dark mode. The product
  // mock cards in the hero and feature preview are left light on purpose — they read
  // as app screenshots framed on the dark page.
  const t = {
    bg: dark ? '#0B1220' : '#fff',
    bgAlt: dark ? '#070D18' : '#F7F9FC',
    card: dark ? '#111B2E' : '#fff',
    lineSoft: dark ? '#1E2C42' : '#E8ECF3',
    fg: dark ? '#EAF0FA' : C.navy,
    fg2: dark ? '#C2CEDF' : C.fg2,
    fg3: dark ? '#8595AC' : C.fg3,
    body: dark ? '#AFBDD2' : '#4F5F77',
    blue50: dark ? 'rgba(56,128,237,.16)' : C.blue50,
    ghostBg: dark ? '#111B2E' : '#fff',
    ghostBorder: dark ? '#2A3A52' : '#C8D2E0',
    navBg: dark ? 'rgba(11,18,32,.85)' : 'rgba(255,255,255,.88)',
    divider: dark ? '#24344B' : '#DCE3EE',
    heroBg: dark
      ? 'radial-gradient(1100px 620px at 90% -12%, rgba(0,74,173,.20), transparent 62%)'
      : 'radial-gradient(1100px 620px at 90% -12%, #EAF1FD, transparent 62%)',
  };

  return (
    <div className="sg" style={{ fontFamily: HANK, color: t.fg, background: t.bg }}>
      <style>{cssFor(t.fg2, dark ? '#33455F' : '#C8D2E0')}</style>

      {/* ===== NAV ===== */}
      <div style={{ position: 'sticky', top: 0, zIndex: 60, background: t.navBg, backdropFilter: 'saturate(160%) blur(12px)', borderBottom: `1px solid ${t.lineSoft}` }}>
        <div style={{ maxWidth: MAXW, margin: '0 auto', padding: '0 32px', height: 72, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <a href="#top" onClick={scrollTo('top')} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <img src={dark ? '/assets/sportagon-logo-white.png' : '/assets/sportagon-logo-blue.png'} alt="Sportagon" style={{ height: 27, display: 'block' }} />
            <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: C.teal6, letterSpacing: '.16em', padding: '3px 7px', border: '1px solid #BFE7E9', borderRadius: 6 }}>EOS</span>
          </a>
          <div className="navlinks" style={{ display: 'flex', gap: 30, alignItems: 'center' }}>
            <a href="#features" onClick={scrollTo('features')} className="navlink">Features</a>
            <a href="#flow" onClick={scrollTo('flow')} className="navlink">How it works</a>
            <a href="#personas" onClick={scrollTo('personas')} className="navlink">Built for</a>
            <a href="#benefits" onClick={scrollTo('benefits')} className="navlink">Why EOS</a>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <button onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'} style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, border: `1px solid ${t.lineSoft}`, background: 'transparent', color: t.fg2, cursor: 'pointer', fontSize: 16 }}>{dark ? '☀' : '☾'}</button>
            <button onClick={goLogin} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: POP, fontWeight: 700, fontSize: 14.5, color: t.fg2 }}>Log in</button>
            <button onClick={goSignup} className="cta" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.blue, color: '#fff', fontFamily: POP, fontWeight: 700, fontSize: 14.5, padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', boxShadow: '0 12px 26px -12px rgba(0,74,173,.6)' }}>Sign up</button>
          </div>
        </div>
      </div>

      {/* ===== HERO ===== */}
      <section id="top" style={{ position: 'relative', overflow: 'hidden', background: t.heroBg }}>
        <div className="heroGrid" style={{ maxWidth: MAXW, margin: '0 auto', padding: '64px 32px 84px', display: 'grid', gridTemplateColumns: '1.06fr .94fr', gap: 56, alignItems: 'center' }}>
          <div className="pop">
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, letterSpacing: '.14em', color: C.teal6, textTransform: 'uppercase' }}>One platform for every sports meet</span>
            <h1 className="heroTitle" style={{ fontFamily: POP, fontWeight: 900, fontSize: 60, lineHeight: 1, letterSpacing: '-.025em', margin: '18px 0 0', textTransform: 'uppercase' }}>
              Run the whole meet. From entry forms to{' '}
              <span style={{ whiteSpace: 'nowrap' }}>
                <span style={{ position: 'relative', display: 'inline-block' }}>
                  <span style={{ position: 'absolute', left: 0, bottom: 7, height: 11, width: '100%', background: C.teal, borderRadius: 3 }} />
                  <span style={{ position: 'relative', color: C.blue }}>medals</span>
                </span>.
              </span>
            </h1>
            <p style={{ fontSize: 19, lineHeight: 1.62, color: t.fg2, margin: '22px 0 0', maxWidth: 520 }}>
              Sportagon EOS gives sports secretaries, PE teachers and associations one place to set up championships, register schools, auto-generate fixtures and publish live results — without a single spreadsheet.
            </p>
            <div style={{ display: 'flex', gap: 14, marginTop: 32, flexWrap: 'wrap' }}>
              <a href="#demo" onClick={scrollTo('demo')} className="cta" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: C.blue, color: '#fff', fontFamily: POP, fontWeight: 700, fontSize: 15.5, padding: '14px 24px', borderRadius: 12, boxShadow: '0 14px 30px -12px rgba(0,74,173,.55)' }}>
                <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4" /></svg>Book a demo
              </a>
              <a href="#features" onClick={scrollTo('features')} className="ghostbtn" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: t.ghostBg, color: t.fg, fontFamily: POP, fontWeight: 700, fontSize: 15.5, padding: '14px 22px', borderRadius: 12, border: `1.5px solid ${t.ghostBorder}` }}>See how it works</a>
            </div>
            <div style={{ display: 'flex', gap: 34, marginTop: 44, flexWrap: 'wrap' }}>
              {[{ n: '6', l: 'core modules' }, { n: '1', l: 'console, every role' }, { n: '0', l: 'spreadsheets' }].map((s, i) => (
                <div key={s.l} style={{ display: 'flex', gap: 34 }}>
                  {i > 0 && <div style={{ width: 1, background: t.divider, alignSelf: 'stretch' }} />}
                  <div>
                    <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 26 }}>{s.n}</div>
                    <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: t.fg3, marginTop: 3 }}>{s.l}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* product mock */}
          <div style={{ position: 'relative' }}>
            <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 20, boxShadow: '0 36px 80px -42px rgba(10,26,51,.55)', overflow: 'hidden' }}>
              <div style={{ background: C.navy, padding: '13px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
                {MARK}
                <span style={{ fontFamily: POP, fontWeight: 800, fontSize: 12, color: '#fff', letterSpacing: '.04em' }}>SPORTAGON EOS</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.teal, letterSpacing: '.08em' }}>DISTRICT GAMES '26</span>
              </div>
              <div style={{ padding: 18 }}>
                <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: C.fg3, letterSpacing: '.1em' }}>MEDAL TALLY · LIVE</div>
                <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {[
                    { r: '1', n: "St. Xavier's", g: 14, s: 9, b: 7, hi: true },
                    { r: '2', n: 'Greenwood High', g: 11, s: 12, b: 6, hi: false },
                    { r: '3', n: 'Oakridge Intl', g: 9, s: 8, b: 10, hi: false },
                  ].map((row) => (
                    <div key={row.r} style={{ display: 'flex', alignItems: 'center', gap: 12, background: row.hi ? '#F1F6FE' : '#fff', border: `1px solid ${row.hi ? '#DCEAFB' : '#E8ECF3'}`, borderRadius: 10, padding: '11px 13px' }}>
                      <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 14, color: row.hi ? C.blue : C.fg3, width: 22 }}>{row.r}</div>
                      <div style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{row.n}</div>
                      <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13 }}>
                        <span style={{ color: '#E9920B' }}>{row.g}</span> · <span style={{ color: '#9BA9BE' }}>{row.s}</span> · <span style={{ color: '#b6803f' }}>{row.b}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ position: 'absolute', bottom: -26, left: -26, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, boxShadow: '0 22px 44px -22px rgba(10,26,51,.5)', padding: '13px 16px', width: 228 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontWeight: 700, fontSize: 10, letterSpacing: '.06em', color: C.blue, textTransform: 'uppercase' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#DE3A3A' }} />Live · Football SF
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 9 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>Riverside</span>
                <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20, color: C.blue }}>2</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#4F5F77' }}>Hilltop</span>
                <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20 }}>1</span>
              </div>
            </div>
            <div style={{ position: 'absolute', top: -22, right: -16, width: 84, height: 84, background: C.teal, clipPath: 'polygon(50% 0,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 28px -12px rgba(10,26,51,.4)' }}>
              <span style={{ color: C.navy }}><Icon size={34} d='<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>' /></span>
            </div>
          </div>
        </div>
      </section>

      {/* ===== PERSONAS ===== */}
      <section id="personas" style={{ background: t.bgAlt, borderTop: `1px solid ${t.lineSoft}`, borderBottom: `1px solid ${t.lineSoft}` }}>
        <div style={{ maxWidth: MAXW, margin: '0 auto', padding: '54px 32px' }}>
          <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '.12em', color: t.fg3, textTransform: 'uppercase', textAlign: 'center' }}>Built for the people who run sport</div>
          <div className="personaGrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18, marginTop: 24 }}>
            {PERSONAS.map((p) => (
              <div key={p.title} style={{ background: t.card, border: `1px solid ${t.lineSoft}`, borderRadius: 14, padding: 22 }}>
                <div style={{ width: 42, height: 42, borderRadius: 11, background: t.blue50, color: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={22} d={p.icon} /></div>
                <div style={{ fontFamily: POP, fontWeight: 700, fontSize: 17, marginTop: 14 }}>{p.title}</div>
                <div style={{ fontSize: 14, lineHeight: 1.6, color: t.body, marginTop: 6 }}>{p.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FEATURES ===== */}
      <section id="features" style={{ background: t.bg }}>
        <div style={{ maxWidth: MAXW, margin: '0 auto', padding: '80px 32px' }}>
          <div style={{ maxWidth: 680 }}>
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, letterSpacing: '.14em', color: C.teal6, textTransform: 'uppercase' }}>The platform</span>
            <h2 style={{ fontFamily: POP, fontWeight: 800, fontSize: 42, lineHeight: 1.05, letterSpacing: '-.02em', margin: '14px 0 0' }}>Everything it takes to run a championship.</h2>
            <p style={{ fontSize: 17, lineHeight: 1.6, color: t.body, margin: '14px 0 0' }}>Six modules, one continuous flow — pick one to see it in action.</p>
          </div>

          <div className="featGrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1.02fr', gap: 34, marginTop: 42, alignItems: 'start' }}>
            {/* list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {FEATURES.map((f, i) => {
                const on = i === active;
                return (
                  <div key={f.title} onClick={() => setActive(i)} style={{
                    cursor: 'pointer', borderRadius: 14, padding: '18px 20px', background: on ? t.card : 'transparent',
                    border: on ? '1px solid #BCD2F6' : '1px solid transparent',
                    borderLeft: on ? `4px solid ${C.teal}` : '4px solid transparent',
                    boxShadow: on ? '0 22px 46px -30px rgba(10,26,51,.5)' : 'none',
                  }}>
                    <div style={{ display: 'flex', gap: 15 }}>
                      <div style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 12, background: t.blue50, color: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={23} d={f.icon} /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ fontFamily: POP, fontWeight: 700, fontSize: 17 }}>{f.title}</div>
                          <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: '#9BA9BE', letterSpacing: '.1em' }}>{f.step}</span>
                        </div>
                        <div style={{ fontSize: 13.5, color: t.body, marginTop: 3 }}>{f.teaser}</div>
                        {on && (
                          <div style={{ marginTop: 11 }}>
                            <div style={{ fontSize: 14, lineHeight: 1.6, color: t.fg2 }}>{f.detail}</div>
                            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 11 }}>
                              {f.tags.map((t) => (
                                <span key={t} style={{ fontSize: 11, fontWeight: 600, color: C.blue, background: '#EAF1FD', padding: '5px 11px', borderRadius: 999 }}>{t}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* sticky preview */}
            <div className="stickyPreview" style={{ position: 'sticky', top: 96 }}>
              <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 18, boxShadow: '0 34px 74px -42px rgba(10,26,51,.5)', overflow: 'hidden' }}>
                <div style={{ background: C.navy, padding: '13px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {MARK}
                  <span style={{ fontFamily: POP, fontWeight: 800, fontSize: 11.5, color: '#fff', letterSpacing: '.04em' }}>SPORTAGON EOS</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: MONO, fontSize: 9, color: C.teal, letterSpacing: '.08em' }}>{cur.crumb}</span>
                </div>
                <div style={{ padding: 20, minHeight: 340 }}>{cur.preview}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FLOW ===== */}
      <section id="flow" style={{ background: C.navy, position: 'relative', overflow: 'hidden' }}>
        <svg width="420" height="420" viewBox="0 0 100 100" style={{ position: 'absolute', right: -90, top: -90, opacity: 0.06 }}><path d="M50 4 L89 27 V73 L50 96 L11 73 V27 Z" fill="none" stroke="#fff" strokeWidth="2" /></svg>
        <div style={{ maxWidth: MAXW, margin: '0 auto', padding: '78px 32px', position: 'relative' }}>
          <div style={{ maxWidth: 660 }}>
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, letterSpacing: '.14em', color: C.teal, textTransform: 'uppercase' }}>How it works</span>
            <h2 style={{ fontFamily: POP, fontWeight: 800, fontSize: 40, lineHeight: 1.05, letterSpacing: '-.02em', color: '#fff', margin: '14px 0 0' }}>From setup to standings in one flow.</h2>
          </div>
          <div className="flowGrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 16, marginTop: 42 }}>
            {STEPS.map((s) => (
              <div key={s.no} style={{ background: '#11233E', border: '1px solid #1E3354', borderRadius: 14, padding: 20 }}>
                <div style={{ width: 48, height: 54, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.blue, clipPath: 'polygon(50% 0,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%)', fontFamily: MONO, fontWeight: 700, fontSize: 16, color: '#fff' }}>{s.no}</div>
                <div style={{ fontFamily: POP, fontWeight: 700, fontSize: 16, color: '#fff', marginTop: 15 }}>{s.title}</div>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: '#9BB0D0', marginTop: 6 }}>{s.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== BENEFITS ===== */}
      <section id="benefits" style={{ background: t.bg }}>
        <div style={{ maxWidth: MAXW, margin: '0 auto', padding: '80px 32px' }}>
          <div style={{ maxWidth: 660 }}>
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, letterSpacing: '.14em', color: C.teal6, textTransform: 'uppercase' }}>Why EOS</span>
            <h2 style={{ fontFamily: POP, fontWeight: 800, fontSize: 40, lineHeight: 1.05, letterSpacing: '-.02em', margin: '14px 0 0' }}>Less admin. Cleaner events. Happier committees.</h2>
          </div>
          <div className="benefitGrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18, marginTop: 42 }}>
            {BENEFITS.map((b) => (
              <div key={b.title} className="benefit" style={{ background: t.card, border: `1px solid ${t.lineSoft}`, borderRadius: 14, padding: 24, boxShadow: '0 12px 30px -26px rgba(10,26,51,.5)' }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, background: t.blue50, color: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={23} d={b.icon} /></div>
                <div style={{ fontFamily: POP, fontWeight: 700, fontSize: 18, marginTop: 16 }}>{b.title}</div>
                <div style={{ fontSize: 14.5, lineHeight: 1.6, color: t.body, marginTop: 8 }}>{b.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== DEMO ===== */}
      <section id="demo" style={{ background: t.bgAlt, borderTop: `1px solid ${t.lineSoft}` }}>
        <div style={{ maxWidth: MAXW, margin: '0 auto', padding: '80px 32px' }}>
          <div className="demoGrid" style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 24, overflow: 'hidden', boxShadow: '0 40px 90px -56px rgba(10,26,51,.5)', display: 'grid', gridTemplateColumns: '.85fr 1.15fr' }}>
            {/* left navy */}
            <div style={{ background: C.navy, padding: '46px 40px', position: 'relative', overflow: 'hidden' }}>
              <svg width="320" height="320" viewBox="0 0 100 100" style={{ position: 'absolute', right: -110, bottom: -110, opacity: 0.08 }}><path d="M50 4 L89 27 V73 L50 96 L11 73 V27 Z" fill="none" stroke="#fff" strokeWidth="2" /></svg>
              <div style={{ position: 'relative' }}>
                <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, letterSpacing: '.14em', color: C.teal, textTransform: 'uppercase' }}>Book a demo</span>
                <h2 style={{ fontFamily: POP, fontWeight: 800, fontSize: 34, lineHeight: 1.08, letterSpacing: '-.02em', color: '#fff', margin: '14px 0 0' }}>See Sportagon EOS on your next meet.</h2>
                <p style={{ fontSize: 15.5, lineHeight: 1.65, color: '#9BB0D0', margin: '16px 0 0' }}>A 30-minute walkthrough, mapped to your sports and your format. No setup needed — just bring your committee.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 28 }}>
                  {['Tailored to your championship format', 'See fixtures auto-generate live', 'Free pilot for your first event'].map((t) => (
                    <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <span style={{ color: C.teal }}><Icon size={19} d='<path d="M20 6 9 17l-5-5"/>' /></span>
                      <span style={{ fontSize: 14.5, color: '#D6DFEC', fontWeight: 500 }}>{t}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* right form */}
            <div style={{ padding: '46px 40px' }}>
              {submitted ? (
                <div className="pop" style={{ height: '100%', minHeight: 340, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                  <div style={{ width: 72, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.teal, clipPath: 'polygon(50% 0,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%)' }}>
                    <span style={{ color: C.navy }}><Icon size={36} d='<path d="M20 6 9 17l-5-5"/>' /></span>
                  </div>
                  <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 26, marginTop: 22 }}>You're on the list.</div>
                  <div style={{ fontSize: 15, lineHeight: 1.6, color: '#4F5F77', marginTop: 10, maxWidth: 340 }}>Thanks — our team will reach out within one working day to schedule your Sportagon EOS walkthrough.</div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <label style={labelStyle}>Full name</label>
                      <input value={form.name} onChange={set('name')} placeholder="Akash Manglekar" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Organization / school</label>
                      <input value={form.organization} onChange={set('organization')} placeholder="District Sports Council" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Your role</label>
                      <select value={form.role} onChange={set('role')} style={inputStyle}>
                        <option value="">Select role</option>
                        {DEMO_REQUEST_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Primary sport</label>
                      <input value={form.sport} onChange={set('sport')} placeholder="Cricket, Football…" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Work email</label>
                      <input value={form.email} onChange={set('email')} placeholder="you@council.in" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Phone</label>
                      <input value={form.phone} onChange={set('phone')} placeholder="+91 98765 43210" style={inputStyle} />
                    </div>
                  </div>
                  {error && <div style={{ marginTop: 14, fontSize: 13, color: '#DE3A3A', fontWeight: 600 }}>{error}</div>}
                  <button onClick={submit} disabled={busy} className="cta" style={{ width: '100%', marginTop: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, background: C.blue, color: '#fff', fontFamily: POP, fontWeight: 700, fontSize: 15.5, padding: 15, borderRadius: 12, border: 'none', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1, boxShadow: '0 14px 30px -12px rgba(0,74,173,.55)' }}>
                    {busy ? 'Sending…' : 'Book a demo'}
                    {!busy && <Icon size={17} d='<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>' />}
                  </button>
                  <div style={{ textAlign: 'center', fontSize: 12.5, color: '#9BA9BE', marginTop: 13 }}>No spam. We'll only reach out about your demo.</div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer style={{ background: C.navy, padding: '64px 0 36px' }}>
        <div style={{ maxWidth: MAXW, margin: '0 auto', padding: '0 32px' }}>
          <div className="footGrid" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 32 }}>
            <div>
              <img src="/assets/sportagon-logo-white.png" alt="Sportagon" style={{ height: 28, display: 'block' }} />
              <p style={{ fontSize: 14.5, lineHeight: 1.6, color: '#8295B0', marginTop: 18, maxWidth: 280 }}>All sides of sport. One Sportagon. From grounds to glory — we power the game.</p>
            </div>
            {FOOTER_COLS.map((col) => (
              <div key={col.head}>
                <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.teal, marginBottom: 15 }}>{col.head}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {col.items.map((it) => <a key={it} href="#top" onClick={scrollTo('top')} className="footlink" style={{ fontSize: 14 }}>{it}</a>)}
                </div>
              </div>
            ))}
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,.10)', margin: '40px 0 22px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <span style={{ fontSize: 13, color: C.fg3 }}>© 2026 Sportagon. All rights reserved.</span>
            <div style={{ display: 'flex', gap: 22 }}>
              <a href="#top" onClick={scrollTo('top')} className="footmuted" style={{ fontSize: 13 }}>Privacy</a>
              <a href="#top" onClick={scrollTo('top')} className="footmuted" style={{ fontSize: 13 }}>Terms</a>
              <button onClick={goLogin} className="footmuted" style={{ fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Log in</button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
