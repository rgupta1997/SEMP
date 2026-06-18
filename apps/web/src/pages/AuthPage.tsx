import { useState, type CSSProperties } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { BRAND } from '../lib/brand';
import { useTheme } from '../lib/theme';

// ─────────────────────────────────────────────────────────────────────────────
// Sportagon EOS — login / sign-up.
//
// Deliberately skinned to the public landing page (LandingPage.tsx), not the slate
// app chrome: same palette (#004AAD blue, teal, navy), the Poppins / Hanken Grotesk
// / JetBrains Mono type system, and the navy split-panel treatment from the "Book a
// demo" section. This is the bridge from marketing → app, so it should feel like the
// same brand. Form controls are styled locally (rather than the slate UI <Input> /
// <Button>) because those track the brand-ramp blue, which differs from the landing's
// #004AAD.
// ─────────────────────────────────────────────────────────────────────────────

// Landing-page palette (kept in sync with LandingPage.tsx `C`).
const C = {
  blue: '#004AAD', blue8: '#013C8B', blue50: '#F1F6FE', teal: '#5CE1E6',
  teal6: '#159FA6', navy: '#0A1A33', fg2: '#374459', fg3: '#6E7E96',
};
const POP = "'Inter',ui-sans-serif,system-ui,sans-serif";
const HANK = "'Inter',ui-sans-serif,system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";

// Seed accounts from `npm run reset:all` (password: demo123; admin: admin123).
// Temporary convenience panel — to be hidden before launch.
const DEMO_GROUPS: { group: string; accounts: { email: string; label: string; pw?: string }[] }[] = [
  { group: 'Platform', accounts: [
    { email: 'admin@semp.local', label: 'System Admin', pw: 'admin123' },
  ] },
  { group: 'Organisers & Officials', accounts: [
    { email: 'organiser1@semp.local', label: 'Organiser' },
    { email: 'official1@semp.local', label: 'Official' },
  ] },
  { group: 'Organization owners', accounts: [
    { email: 'owner@vjti.semp.local', label: 'Owner · VJTI (institution)' },
    { email: 'owner@infy.semp.local', label: 'Owner · Infosys (corporate)' },
    { email: 'owner@pufc.semp.local', label: 'Owner · Pune United FC (club)' },
  ] },
  { group: 'Players', accounts: [
    { email: 'player1@vjti.semp.local', label: 'Player · VJTI (also organises)' },
    { email: 'player2@infy.semp.local', label: 'Player · Infosys' },
    { email: 'player29@vjti.semp.local', label: 'Player · VJTI (reset on login)' },
  ] },
];

const RAIL_POINTS = [
  'Set up a multi-sport championship in minutes',
  'Auto-generate clash-free fixtures across venues',
  'Live scores, medal tallies — and zero spreadsheets',
];

const css = (dark: boolean) => `
.auth *{box-sizing:border-box}
.auth a{text-decoration:none;color:inherit}
.auth .field{transition:border-color .15s,box-shadow .15s}
.auth .field::placeholder{color:${dark ? '#5A6B85' : '#9BA9BE'}}
.auth .field:focus{border-color:${C.blue};box-shadow:0 0 0 3px ${dark ? 'rgba(0,74,173,.45)' : 'rgba(0,74,173,.14)'}}
.auth .cta{transition:background .15s,transform .1s,box-shadow .15s}
.auth .cta:hover{background:${C.blue8}}
.auth .cta:active{transform:translateY(1px)}
.auth .cta:disabled{cursor:default;opacity:.7}
.auth .switchlink{transition:color .15s}
.auth .switchlink:hover{color:${C.blue8}}
.auth .iconbtn{transition:background .15s,border-color .15s,color .15s}
.auth .iconbtn:hover{border-color:${C.blue};color:${C.blue}}
.auth .demoacct{transition:border-color .15s,background .15s,transform .1s}
.auth .demoacct:hover{border-color:${C.blue};background:${dark ? 'rgba(0,74,173,.14)' : C.blue50}}
.auth .demoacct:active{transform:translateY(1px)}
.auth .demoacct:disabled{opacity:.5;cursor:default}
@keyframes authpop{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.auth .pop{animation:authpop .5s cubic-bezier(.16,1,.3,1) both}
@media (prefers-reduced-motion:reduce){.auth .pop{animation:none}}
@media (max-width:880px){
  .auth .authGrid{grid-template-columns:1fr !important}
  .auth .brandRail{display:none !important}
  .auth .mobileBrand{display:flex !important}
}
`;

export function AuthPage() {
  const { login, signup } = useAuth();
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const location = useLocation();
  // The landing page can deep-link here in signup mode (Sign up button); default is login.
  const [mode, setMode] = useState<'login' | 'signup'>(
    (location.state as { mode?: string } | null)?.mode === 'signup' ? 'signup' : 'login',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Redirect after auth is handled centrally in AppRoutes (it stays mounted across
  // the unauthenticated -> authenticated switch, unlike this page).

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await signup({ name, email, password, phone: phone || undefined });
      }
      // AppRoutes redirects to the role's home once auth context updates.
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
    } finally { setBusy(false); }
  };

  const quick = async (em: string, pw: string) => {
    setError(null); setBusy(true);
    try {
      await login(em, pw);
      // AppRoutes redirects to the role's home once auth context updates.
    } catch (err: any) { setError(err.message ?? 'Login failed'); } finally { setBusy(false); }
  };

  // Theme-aware tokens (mirrors LandingPage's `t`). Navy rail stays constant.
  const t = {
    formBg: dark ? '#070D18' : '#F7F9FC',
    fg: dark ? '#EAF0FA' : C.navy,
    fg2: dark ? '#C2CEDF' : C.fg2,
    fg3: dark ? '#8595AC' : C.fg3,
    body: dark ? '#AFBDD2' : '#4F5F77',
    line: dark ? '#1E2C42' : '#E8ECF3',
    card: dark ? '#0E1828' : '#fff',
    inputBg: dark ? '#0E1828' : '#fff',
    inputBorder: dark ? '#2A3A52' : '#D4DAE6',
  };

  const labelStyle: CSSProperties = {
    fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '.1em',
    color: t.fg2, textTransform: 'uppercase', display: 'block', marginBottom: 7,
  };
  const inputStyle: CSSProperties = {
    width: '100%', height: 46, border: `1px solid ${t.inputBorder}`, borderRadius: 10,
    padding: '0 14px', fontSize: 14.5, fontFamily: HANK, outline: 'none',
    background: t.inputBg, color: t.fg,
  };
  const iconBtnStyle: CSSProperties = {
    display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10,
    border: `1px solid ${t.line}`, background: 'transparent', color: t.fg2,
    cursor: 'pointer', fontSize: 16,
  };

  const heading = mode === 'login' ? 'Welcome back' : 'Create your account';
  const sub = mode === 'login'
    ? `Sign in to your ${BRAND.name} ${BRAND.productBadge} workspace.`
    : 'Start hosting or join a championship in minutes.';

  return (
    <div className="auth" style={{ minHeight: '100vh', fontFamily: HANK, background: t.formBg, color: t.fg }}>
      <style>{css(dark)}</style>

      <div className="authGrid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.04fr) minmax(0,1fr)', minHeight: '100vh' }}>

        {/* ===== LEFT — navy brand rail ===== */}
        <aside className="brandRail" style={{ position: 'relative', overflow: 'hidden', background: C.navy, padding: '56px 56px 48px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <svg width="460" height="460" viewBox="0 0 100 100" aria-hidden style={{ position: 'absolute', right: -130, bottom: -120, opacity: 0.07 }}>
            <path d="M50 4 L89 27 V73 L50 96 L11 73 V27 Z" fill="none" stroke="#fff" strokeWidth="2" />
          </svg>

          {/* logo lockup */}
          <a href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 11, position: 'relative', width: 'fit-content' }}>
            <img src={BRAND.logo.white} alt={BRAND.name} style={{ height: 28, display: 'block' }} />
            <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: C.teal, letterSpacing: '.16em', padding: '3px 7px', border: `1px solid ${C.teal}66`, borderRadius: 6 }}>{BRAND.productBadge}</span>
          </a>

          {/* headline + value props */}
          <div style={{ position: 'relative', maxWidth: 420 }}>
            <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 700, letterSpacing: '.14em', color: C.teal, textTransform: 'uppercase' }}>The event operating system</span>
            <h1 style={{ fontFamily: POP, fontWeight: 800, fontSize: 34, lineHeight: 1.1, letterSpacing: '-.02em', color: '#fff', margin: '16px 0 0', textWrap: 'balance' as CSSProperties['textWrap'] }}>
              Run the whole meet, from entry forms to medals.
            </h1>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 30 }}>
              {RAIL_POINTS.map((p) => (
                <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ flexShrink: 0, color: C.teal }}>
                    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  </span>
                  <span style={{ fontSize: 14.5, color: '#D6DFEC', fontWeight: 500, lineHeight: 1.45 }}>{p}</span>
                </div>
              ))}
            </div>
          </div>

          {/* live mini scoreboard — broadcast personality, echoes the landing hero card */}
          <div style={{ position: 'relative', background: '#11233E', border: '1px solid #1E3354', borderRadius: 14, padding: '14px 16px', maxWidth: 290 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: MONO, fontWeight: 700, fontSize: 9.5, letterSpacing: '.08em', color: C.teal, textTransform: 'uppercase' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#DE3A3A' }} />Live · Football SF
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 14.5, color: '#fff' }}>Riverside FC</span>
              <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20, color: C.teal }}>2</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 14.5, color: '#9BA9BE' }}>Hilltop Utd</span>
              <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20, color: '#9BA9BE' }}>1</span>
            </div>
          </div>
        </aside>

        {/* ===== RIGHT — form ===== */}
        <main style={{ position: 'relative', display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: 'clamp(28px,5vh,64px) clamp(22px,5vw,56px)' }}>
          {/* top bar: brand on mobile + theme toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 28 }}>
            <a href="/" className="mobileBrand" style={{ display: 'none', alignItems: 'center', gap: 10 }}>
              <img src={dark ? BRAND.logo.white : BRAND.logo.blue} alt={BRAND.name} style={{ height: 26, display: 'block' }} />
              <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: C.teal6, letterSpacing: '.16em', padding: '3px 7px', border: '1px solid #BFE7E9', borderRadius: 6 }}>{BRAND.productBadge}</span>
            </a>
            <span style={{ flex: 1 }} />
            <button onClick={toggle} className="iconbtn" style={iconBtnStyle}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
              {dark ? '☀' : '☾'}
            </button>
          </div>

          <div className="pop" style={{ width: '100%', maxWidth: 432, margin: '0 auto' }}>
            <h2 style={{ fontFamily: POP, fontWeight: 800, fontSize: 30, lineHeight: 1.12, letterSpacing: '-.02em', color: t.fg }}>{heading}</h2>
            <p style={{ fontSize: 15, color: t.body, margin: '8px 0 0' }}>{sub}</p>

            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
              {mode === 'signup' && (
                <div>
                  <label htmlFor="auth-name" style={labelStyle}>Full name</label>
                  <input id="auth-name" className="field" style={inputStyle} value={name}
                    onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" required />
                </div>
              )}
              <div>
                <label htmlFor="auth-email" style={labelStyle}>Email</label>
                <input id="auth-email" className="field" style={inputStyle} type="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
              </div>
              {mode === 'signup' && (
                <div>
                  <label htmlFor="auth-phone" style={labelStyle}>Phone number</label>
                  <input id="auth-phone" className="field" style={inputStyle} type="tel" value={phone}
                    onChange={(e) => setPhone(e.target.value)} placeholder="+91 98000 00000" autoComplete="tel" required />
                </div>
              )}
              <div>
                <label htmlFor="auth-password" style={labelStyle}>Password</label>
                <input id="auth-password" className="field" style={inputStyle} type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
              </div>

              {error && (
                <p role="alert" style={{ borderRadius: 10, background: dark ? 'rgba(222,58,58,.12)' : '#FBE6E6', border: `1px solid ${dark ? 'rgba(222,58,58,.3)' : '#F3C9C9'}`, padding: '10px 13px', fontSize: 13.5, fontWeight: 600, color: dark ? '#F4A8A8' : '#B23636', margin: 0 }}>{error}</p>
              )}

              <button type="submit" disabled={busy} className="cta" style={{ height: 50, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, background: C.blue, color: '#fff', fontFamily: POP, fontWeight: 700, fontSize: 15.5, borderRadius: 12, border: 'none', boxShadow: '0 14px 30px -12px rgba(0,74,173,.55)' }}>
                {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
                {!busy && (
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                )}
              </button>
            </form>

            <p style={{ textAlign: 'center', fontSize: 14, color: t.body, marginTop: 18 }}>
              {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); }}
                className="switchlink" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: HANK, fontSize: 14, fontWeight: 700, color: C.blue }}>
                {mode === 'login' ? 'Sign up' : 'Sign in'}
              </button>
            </p>

            {/* ===== Demo logins (temporary) ===== */}
            <div style={{ marginTop: 34, paddingTop: 26, borderTop: `1px solid ${t.line}` }}>
              <div style={{ textAlign: 'center', fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: t.fg3 }}>Demo logins · all roles (temporary)</div>
              <div style={{ maxHeight: 264, overflow: 'auto', marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14, paddingRight: 2 }}>
                {DEMO_GROUPS.map((g) => (
                  <div key={g.group}>
                    <div style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: t.fg3, marginBottom: 7 }}>{g.group}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {g.accounts.map((d) => (
                        <button key={d.email} type="button" onClick={() => quick(d.email, d.pw ?? 'demo123')} disabled={busy}
                          className="demoacct" style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', border: `1px solid ${t.line}`, background: t.card, borderRadius: 10, padding: '9px 11px', cursor: 'pointer' }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: t.fg }}>{d.label}</span>
                          <span style={{ fontFamily: MONO, fontSize: 10.5, color: t.fg3, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.email}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ textAlign: 'center', fontFamily: MONO, fontSize: 10.5, color: t.fg3, marginTop: 14 }}>
                Password <span style={{ color: t.fg2, fontWeight: 700 }}>demo123</span> · admin <span style={{ color: t.fg2, fontWeight: 700 }}>admin123</span>
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
