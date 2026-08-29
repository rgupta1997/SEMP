import { useCallback, useState, type CSSProperties } from 'react';
import { useLocation } from 'react-router-dom';
import { BRAND } from '../lib/brand';
import { useTheme } from '../lib/theme';
import { SignInFlow } from '../features/auth/SignInFlow';
import { SignUpFlow } from '../features/auth/SignUpFlow';
import { ResetPasswordFlow } from '../features/auth/ResetPasswordFlow';

// Landing-page palette.
const C = {
  blue: 'var(--brand)', blue8: 'var(--brand-strong)', blue50: 'var(--brand-tint)', teal: 'var(--accent)',
  teal6: 'var(--accent-deep)', navy: 'var(--ink)', fg2: 'var(--ink-3)', fg3: 'var(--muted)',
};
const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";
const HANK = "'Hanken Grotesk',ui-sans-serif,system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";

const RAIL_POINTS = [
  'Set up a multi-sport championship in minutes',
  'Auto-generate clash-free fixtures across venues',
  'Live scores, medal tallies - and zero spreadsheets',
];

const css = (dark: boolean) => `
.auth *{box-sizing:border-box}
.auth a{text-decoration:none;color:inherit}
.auth .field{transition:border-color .15s,box-shadow .15s}
.auth .field::placeholder{color:${dark ? '#5A6B85' : 'var(--faint)'}}
.auth .field:focus{border-color:${C.blue};box-shadow:0 0 0 3px ${dark ? 'color-mix(in srgb, var(--brand) 45%, transparent)' : 'color-mix(in srgb, var(--brand) 14%, transparent)'}}
.auth .cta{transition:background .15s,transform .1s,box-shadow .15s}
.auth .cta:hover{background:${C.blue8}}
.auth .cta:active{transform:translateY(1px)}
.auth .cta:disabled{cursor:default;opacity:.7}
.auth .switchlink{transition:color .15s}
.auth .switchlink:hover{color:${C.blue8}}
.auth .iconbtn{transition:background .15s,border-color .15s,color .15s}
.auth .iconbtn:hover{border-color:${C.blue};color:${C.blue}}
@keyframes authpop{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.auth .pop{animation:authpop .5s cubic-bezier(.16,1,.3,1) both}
@media (prefers-reduced-motion:reduce){.auth .pop{animation:none}}
@media (max-width:880px){
  .auth .authGrid{grid-template-columns:1fr !important}
  /* The rail is a two-column device: a 44%-wide panel of pitch beside the form.
     It cannot narrow, so below 880px it is replaced rather than kept - but it was
     previously just DELETED, which left the product's first screen as a form
     floating in 60% empty space with nothing saying what the product is. The
     replacement is .mobilePitch below: the same three claims, laid out for one
     column, above the form rather than beside it. */
  .auth .brandRail{display:none !important}
  .auth .mobileBrand{display:flex !important}
  .auth .mobilePitch{display:block !important}
  /* Centred in the viewport rather than pinned to either edge. flex-end put the
     form under the thumb but left a third of the screen empty above the logo;
     centring keeps the fields in the lower half - still thumb-reachable - with the
     pitch immediately above them and no dead band. */
  .auth .authMain{justify-content:center !important;min-height:100dvh}
}
`;

export function AuthPage() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const location = useLocation();
  // The landing page can deep-link here in signup mode (Sign up button); default is login.
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>(
    (location.state as { mode?: string } | null)?.mode === 'signup'
      || new URLSearchParams(location.search).get('mode') === 'signup'
      ? 'signup' : 'login',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Redirect after auth is handled centrally in AppRoutes (it stays mounted across
  // the unauthenticated -> authenticated switch, unlike this page).


  // Theme-aware tokens. Navy rail stays constant.
  const t = {
    formBg: dark ? '#070D18' : '#F7F9FC',
    fg: dark ? '#EAF0FA' : C.navy,
    fg2: dark ? '#C2CEDF' : C.fg2,
    fg3: dark ? '#8595AC' : C.fg3,
    body: dark ? '#AFBDD2' : 'var(--ink-4)',
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
    width: '100%', height: 46, border: `1px solid ${t.inputBorder}`, borderRadius: 4,
    padding: '0 14px', fontSize: 14.5, fontFamily: HANK, outline: 'none',
    background: t.inputBg, color: t.fg,
  };
  const iconBtnStyle: CSSProperties = {
    display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 4,
    border: `1px solid ${t.line}`, background: 'transparent', color: t.fg2,
    cursor: 'pointer', fontSize: 16,
  };

  // The sign-in flow owns its own copy per step, so the page takes the heading
  // from it rather than deciding from `mode` alone.
  const [flowHeading, setFlowHeading] = useState({ title: 'Welcome back', sub: '' });
  const onHeading = useCallback((h: { title: string; sub: string }) => setFlowHeading(h), []);
  // Every flow reports its own per-step copy, so the page just renders it.
  const heading = flowHeading.title;
  const sub = flowHeading.sub || `Sign in to your ${BRAND.name} ${BRAND.productBadge} workspace.`;

  return (
    <div className="auth" style={{ minHeight: '100vh', fontFamily: HANK, background: t.formBg, color: t.fg }}>
      <style>{css(dark)}</style>

      <div className="authGrid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.04fr) minmax(0,1fr)', minHeight: '100vh' }}>

        {/* ===== LEFT - navy brand rail ===== */}
        <aside className="brandRail" style={{ position: 'relative', overflow: 'hidden', background: C.navy, padding: '56px 56px 48px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <svg width="460" height="460" viewBox="0 0 100 100" aria-hidden style={{ position: 'absolute', right: -130, bottom: -120, opacity: 0.07 }}>
            <path d="M50 4 L89 27 V73 L50 96 L11 73 V27 Z" fill="none" stroke="#fff" strokeWidth="2" />
          </svg>

          {/* logo lockup */}
          <a href={import.meta.env.VITE_LANDING_URL ?? '/'} style={{ display: 'inline-flex', alignItems: 'center', gap: 11, position: 'relative', width: 'fit-content' }}>
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

          {/* live mini scoreboard - broadcast personality, echoes the landing hero card */}
          <div style={{ position: 'relative', background: '#11233E', border: '1px solid #1E3354', borderRadius: 6, padding: '14px 16px', maxWidth: 290 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: MONO, fontWeight: 700, fontSize: 9.5, letterSpacing: '.08em', color: C.teal, textTransform: 'uppercase' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#DE3A3A' }} />Live · Football SF
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 14.5, color: '#fff' }}>Riverside FC</span>
              <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20, color: C.teal }}>2</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--faint)' }}>Hilltop Utd</span>
              <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20, color: 'var(--faint)' }}>1</span>
            </div>
          </div>
        </aside>

        {/* ===== RIGHT - form ===== */}
        <main className="authMain" style={{ position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 'clamp(28px,5vh,64px) clamp(22px,5vw,56px)' }}>
          {/* top bar: brand on mobile + theme toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 28 }}>
            <a href={import.meta.env.VITE_LANDING_URL ?? '/'} className="mobileBrand" style={{ display: 'none', alignItems: 'center', gap: 10 }}>
              <img src={dark ? BRAND.logo.white : BRAND.logo.blue} alt={BRAND.name} style={{ height: 26, display: 'block' }} />
              <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: C.teal6, letterSpacing: '.16em', padding: '3px 7px', border: '1px solid #BFE7E9', borderRadius: 6 }}>{BRAND.productBadge}</span>
            </a>
            <span style={{ flex: 1 }} />
            <button onClick={toggle} className="iconbtn" style={iconBtnStyle}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
              {dark ? '☀' : '☾'}
            </button>
          </div>

          {/* WHAT THIS IS, ON A PHONE.
              Not the rail shrunk - one headline and three claims set for a single
              column, so somebody arriving from a shared link on a phone learns what
              they are signing into. Hidden at 880px+ where the rail says it better. */}
          <div className="mobilePitch" style={{ display: 'none', width: '100%', maxWidth: 432, margin: '0 auto 26px' }}>
            <div style={{
              fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '.18em',
              textTransform: 'uppercase', color: C.teal6, marginBottom: 10,
            }}>The event operating system</div>
            <h2 style={{
              fontFamily: POP, fontSize: 26, lineHeight: 1.12, fontWeight: 800, margin: 0,
              letterSpacing: '-.02em', textWrap: 'balance',
              color: dark ? '#F1F5F9' : C.navy,
            }}>Run the whole meet, from entry forms to medals.</h2>
            <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'grid', gap: 9 }}>
              {RAIL_POINTS.map((t) => (
                <li key={t} style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                  fontFamily: HANK, fontSize: 14.5, lineHeight: 1.45,
                  color: dark ? '#93A4BC' : C.fg3,
                }}>
                  <span aria-hidden style={{
                    flex: '0 0 auto', width: 18, height: 18, marginTop: 1, borderRadius: 999,
                    display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800,
                    background: dark ? 'rgba(92,225,230,.16)' : '#E4F7F8', color: C.teal6,
                  }}>✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="pop" style={{ width: '100%', maxWidth: 432, margin: '0 auto' }}>
            <h2 style={{ fontFamily: POP, fontWeight: 800, fontSize: 30, lineHeight: 1.12, letterSpacing: '-.02em', color: t.fg }}>{heading}</h2>
            <p style={{ fontSize: 15, color: t.body, margin: '8px 0 0' }}>{sub}</p>

            {mode === 'login' && (
              <SignInFlow
                dark={dark}
                inputStyle={inputStyle}
                labelStyle={labelStyle}
                t={{ fg: t.fg, body: t.body }}
                onHeading={onHeading}
                onWantSignup={() => { setMode('signup'); setError(null); }}
                onWantReset={() => { setMode('reset'); setError(null); }}
              />
            )}
            {mode === 'signup' && (
              <SignUpFlow
                dark={dark}
                inputStyle={inputStyle}
                labelStyle={labelStyle}
                t={{ fg: t.fg, body: t.body }}
                onHeading={onHeading}
              />
            )}
            {mode === 'reset' && (
              <ResetPasswordFlow
                dark={dark}
                inputStyle={inputStyle}
                labelStyle={labelStyle}
                t={{ fg: t.fg, body: t.body }}
                onHeading={onHeading}
                onDone={() => { setMode('login'); setError(null); }}
              />
            )}

            {mode !== 'reset' && (
            <p style={{ textAlign: 'center', fontSize: 14, color: t.body, marginTop: 18 }}>
              {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); }}
                className="switchlink" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: HANK, fontSize: 14, fontWeight: 700, color: C.blue }}>
                {mode === 'login' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
