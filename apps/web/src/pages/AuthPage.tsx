import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth, type CompletedAuth, type IdentifyResult, type VerificationPurpose } from '../lib/auth';
import { BRAND } from '../lib/brand';
import { useTheme } from '../lib/theme';

// Landing-page palette.
const C = {
  blue: '#004AAD', blue8: '#013C8B', blue50: '#F1F6FE', teal: '#5CE1E6',
  teal6: '#159FA6', navy: '#0A1A33', fg2: '#374459', fg3: '#6E7E96',
};
const POP = "'IBM Plex Sans',ui-sans-serif,system-ui,sans-serif";
const HANK = "'IBM Plex Sans',ui-sans-serif,system-ui,sans-serif";
const MONO = "'IBM Plex Mono',ui-monospace,monospace";

const RAIL_POINTS = [
  'Set up a multi-sport championship in minutes',
  'Auto-generate clash-free fixtures across venues',
  'Live scores, medal tallies - and zero spreadsheets',
];

const RESEND_SECONDS = 45;

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
@keyframes authpop{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.auth .pop{animation:authpop .5s cubic-bezier(.16,1,.3,1) both}
@media (prefers-reduced-motion:reduce){.auth .pop{animation:none}}
@media (max-width:880px){
  .auth .authGrid{grid-template-columns:1fr !important}
  .auth .brandRail{display:none !important}
  .auth .mobileBrand{display:flex !important}
}
`;

// One screen, one sequence, and the address decides which branch of it you get:
//
//   email     type an address -> identify says whether it is already registered
//     |
//     +-- registered ---> password ----------------------> in
//     |                     \ forgotten it? -> code -> newPassword -> in
//     +-- new address ---> code -> details -> matched? --> in
//
// A one-time code never signs anyone in by itself. It proves the address is theirs,
// and the step after it is where they choose a password.
type Step = 'email' | 'password' | 'code' | 'details' | 'newPassword' | 'matched';

export function AuthPage() {
  const { login, identify, requestOtp, verifyOtp, completeSignup, resetPassword } = useAuth();
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const location = useLocation();

  // The landing page can deep-link here in signup mode (Sign up button). There is no
  // separate signup form any more - the same email field starts both journeys - so
  // this only decides the opening copy.
  const deepLinkedSignup = (location.state as { mode?: string } | null)?.mode === 'signup'
    || new URLSearchParams(location.search).get('mode') === 'signup';

  const [step, setStep] = useState<Step>('email');
  // Copy-only toggle, per the wireframe: both tabs run the identical mechanism.
  const [audience, setAudience] = useState<'organisation' | 'individual'>('organisation');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');

  const [identified, setIdentified] = useState<IdentifyResult | null>(null);
  const [purpose, setPurpose] = useState<VerificationPurpose>('signup');
  const [ticket, setTicket] = useState<string | null>(null);
  const [completed, setCompleted] = useState<CompletedAuth | null>(null);
  // Whether the join request has been sent, so the screen can stop offering it.
  const [requested, setRequested] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Redirect after auth is handled centrally in AppRoutes (it stays mounted across
  // the unauthenticated -> authenticated switch, unlike this page).

  // Identify as they type, debounced. Pre-session and side-effect free, so both the
  // institution and which door they'll get are known before anything is submitted.
  useEffect(() => {
    if (step !== 'email') return;
    const addr = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) { setIdentified(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      identify(addr)
        .then((r) => { if (!cancelled) setIdentified(r); })
        .catch(() => { if (!cancelled) setIdentified(null); });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [email, step]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const org = identified?.organization ?? null;
  const registered = identified?.registered ?? false;

  const run = async (work: () => Promise<void>) => {
    setError(null); setBusy(true);
    try { await work(); }
    catch (err: any) { setError(err.message ?? 'Something went wrong'); }
    finally { setBusy(false); }
  };

  // The fork. A known address goes to its password; a new one starts verification.
  //
  // The debounced lookup usually has the answer already, but it may not have landed
  // (or may have failed), so this asks again rather than leaving someone stuck
  // behind a button that never enables.
  const continueFromEmail = (e?: React.FormEvent) => {
    e?.preventDefault();
    return run(async () => {
      const addr = email.trim();
      const who = identified ?? await identify(addr);
      setIdentified(who);
      if (who.registered) { setStep('password'); return; }
      await sendCodeFor(addr, 'signup');
    });
  };

  const sendCodeFor = async (addr: string, why: VerificationPurpose) => {
    const res = await requestOtp(addr, why);
    setPurpose(why);
    setDevCode(res.dev_code ?? null);
    setCode(res.dev_code ?? '');
    setResendIn(RESEND_SECONDS);
    setStep('code');
  };

  const sendCode = (why: VerificationPurpose) => run(() => sendCodeFor(email.trim(), why));

  const submitCode = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (code.length !== 6) { setError('Enter the 6-digit code'); return; }
    return run(async () => {
      const res = await verifyOtp(email.trim(), code, purpose);
      setTicket(res.verification_token);
      // Verifying grants nothing on its own - the next step is where they choose a
      // password, and that is what creates the account or the new credential.
      setStep(purpose === 'signup' ? 'details' : 'newPassword');
    });
  };

  const submitDetails = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const res = await completeSignup({ verification_token: ticket!, name, phone, password });
      // A domain match earns a screen offering to ask for access - it does not put
      // anyone inside the institution. Everyone else goes straight in. Applying the
      // session unmounts this page, so it has to come last either way.
      if (res.matched_organization) { setCompleted(res); setStep('matched'); }
      else res.apply();
    });
  };

  const submitNewPassword = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const res = await resetPassword(ticket!, password);
      res.apply();
    });
  };

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => { await login(email, password); });
  };

  const restart = () => {
    setStep('email'); setCode(''); setDevCode(null); setTicket(null);
    setPassword(''); setError(null);
  };

  // Theme-aware tokens. Navy rail stays constant.
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
    width: '100%', height: 46, border: `1px solid ${t.inputBorder}`, borderRadius: 4,
    padding: '0 14px', fontSize: 14.5, fontFamily: HANK, outline: 'none',
    background: t.inputBg, color: t.fg,
  };
  const iconBtnStyle: CSSProperties = {
    display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 4,
    border: `1px solid ${t.line}`, background: 'transparent', color: t.fg2,
    cursor: 'pointer', fontSize: 16,
  };
  const ctaStyle: CSSProperties = {
    height: 50, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 9, background: C.blue, color: '#fff', fontFamily: POP, fontWeight: 700,
    fontSize: 15.5, borderRadius: 6, border: 'none', width: '100%',
    boxShadow: '0 14px 30px -12px rgba(0,74,173,.55)', cursor: 'pointer',
  };
  const linkStyle: CSSProperties = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    fontFamily: HANK, fontSize: 14, fontWeight: 700, color: C.blue,
  };

  const HEADINGS: Record<Step, { title: string; sub: string }> = {
    email: audience === 'organisation'
      ? {
        title: deepLinkedSignup ? 'Join your institution' : 'Sign in to your institution',
        sub: "Use your official email address. We'll take it from there.",
      }
      : {
        title: deepLinkedSignup ? 'Create your account' : 'Sign in',
        sub: "Use your email address. We'll take it from there.",
      },
    password: { title: 'Welcome back', sub: `Enter the password for ${email}.` },
    code: purpose === 'signup'
      ? { title: 'Confirm your email', sub: `Six-digit code sent to ${email}` }
      : { title: 'Check your inbox', sub: `Six-digit code sent to ${email}` },
    details: { title: 'Set up your account', sub: 'Your email is confirmed. Finish up and choose a password.' },
    newPassword: { title: 'Choose a new password', sub: `You're setting a new password for ${email}.` },
    matched: {
      title: 'Your account is ready',
      sub: `${completed?.matched_organization?.name ?? 'An institution'} has claimed your email domain. Ask to join and one of their admins will review it.`,
    },
  };
  const { title, sub } = HEADINGS[step];

  const errorBox = error && (
    <p role="alert" style={{ borderRadius: 4, background: dark ? 'rgba(222,58,58,.12)' : '#FBE6E6', border: `1px solid ${dark ? 'rgba(222,58,58,.3)' : '#F3C9C9'}`, padding: '10px 13px', fontSize: 13.5, fontWeight: 600, color: dark ? '#F4A8A8' : '#B23636', margin: 0 }}>{error}</p>
  );

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
              <span style={{ fontWeight: 700, fontSize: 14.5, color: '#9BA9BE' }}>Hilltop Utd</span>
              <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20, color: '#9BA9BE' }}>1</span>
            </div>
          </div>
        </aside>

        {/* ===== RIGHT - form ===== */}
        <main style={{ position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 'clamp(28px,5vh,64px) clamp(22px,5vw,56px)' }}>
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

          <div className="pop" style={{ width: '100%', maxWidth: 432, margin: '0 auto' }}>

            {/* Audience toggle - copy only; the mechanism is identical either way. */}
            {step === 'email' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: 4, background: dark ? '#0E1828' : '#EDF1F7', borderRadius: 8, marginBottom: 22 }}>
                {(['organisation', 'individual'] as const).map((a) => (
                  <button key={a} type="button" onClick={() => setAudience(a)}
                    style={{
                      padding: '8px 7px', fontSize: 12.5, fontWeight: 700, borderRadius: 6, border: 'none', cursor: 'pointer',
                      textTransform: 'capitalize', fontFamily: HANK,
                      background: audience === a ? (dark ? '#16233A' : '#fff') : 'transparent',
                      color: audience === a ? t.fg : t.fg3,
                      boxShadow: audience === a ? '0 1px 2px rgba(10,26,51,.08)' : 'none',
                    }}>
                    {a === 'organisation' ? 'Organisation' : 'Individual'}
                  </button>
                ))}
              </div>
            )}

            <h2 style={{ fontFamily: POP, fontWeight: 800, fontSize: 30, lineHeight: 1.12, letterSpacing: '-.02em', color: t.fg }}>{title}</h2>
            <p style={{ fontSize: 15, color: t.body, margin: '8px 0 0' }}>{sub}</p>

            {/* ---------- STEP: email - one field, two journeys ---------- */}
            {step === 'email' && (
              <form onSubmit={continueFromEmail} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
                <div>
                  <label htmlFor="auth-email" style={labelStyle}>Email address</label>
                  <input id="auth-email" className="field" style={inputStyle} type="email" value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={audience === 'organisation' ? 'you@institution.ac.in' : 'you@example.com'}
                    autoComplete="email" autoFocus required />
                  {org ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 9, padding: '9px 11px', borderRadius: 6, background: dark ? 'rgba(0,74,173,.14)' : C.blue50, border: `1px solid ${dark ? '#1B355A' : '#D4E4F8'}`, fontSize: 13 }}>
                      {org.logo_url
                        ? <img src={org.logo_url} alt="" style={{ width: 26, height: 26, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                        : <span style={{ width: 26, height: 26, borderRadius: 6, background: C.blue, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10.5, fontWeight: 800, flexShrink: 0 }}>{initials(org.name)}</span>}
                      <span style={{ color: t.fg2, lineHeight: 1.35 }}>
                        {registered
                          ? <>Signing in to <b style={{ color: t.fg }}>{org.name}</b>.</>
                          : <>Recognised domain — you can ask to join <b style={{ color: t.fg }}>{org.name}</b> once your account is set up.</>}
                      </span>
                    </div>
                  ) : (
                    <p style={{ fontSize: 12.5, color: t.fg3, margin: '8px 0 0' }}>
                      {audience === 'organisation'
                        ? "If your institution has claimed its domain, we'll put you in the right workspace."
                        : "New here? We'll email you a code to confirm this address."}
                    </p>
                  )}
                </div>

                {errorBox}

                {/* Neutral until the address has actually been checked - promising to
                    create an account before we know whether one exists is a lie half
                    the time, and the button is disabled at that point anyway. */}
                <button type="submit" disabled={busy} className="cta" style={ctaStyle}>
                  {busy ? 'Please wait…' : !identified || registered ? 'Continue' : 'Create my account'}
                  {!busy && (
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                  )}
                </button>

                {identified && (
                  <p style={{ textAlign: 'center', fontSize: 13, color: t.fg3, margin: 0 }}>
                    {registered
                      ? 'This email already has an account.'
                      : "We'll send a code to confirm it's yours."}
                  </p>
                )}
              </form>
            )}

            {/* ---------- STEP: password - the everyday door ---------- */}
            {step === 'password' && (
              <form onSubmit={submitPassword} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
                <div>
                  <label htmlFor="auth-password" style={labelStyle}>Password</label>
                  <input id="auth-password" className="field" style={inputStyle} type="password" value={password}
                    onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                    autoComplete="current-password" autoFocus required />
                </div>

                {errorBox}

                <button type="submit" disabled={busy} className="cta" style={ctaStyle}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>

                <p style={{ textAlign: 'center', fontSize: 13.5, color: t.body, margin: 0 }}>
                  <button type="button" onClick={() => sendCode('password_reset')} className="switchlink" style={linkStyle}>
                    Forgotten your password?
                  </button>
                  {' · '}
                  <button type="button" onClick={restart} className="switchlink" style={linkStyle}>
                    Use another address
                  </button>
                </p>
              </form>
            )}

            {/* ---------- STEP: code - proof of ownership, not a way in ---------- */}
            {step === 'code' && (
              <form onSubmit={submitCode} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
                <CodeInput value={code} onChange={setCode} onComplete={() => submitCode()} dark={dark} tokens={t} />

                {devCode && (
                  <p style={{ margin: 0, padding: '9px 11px', borderRadius: 6, fontSize: 12.5, lineHeight: 1.45,
                    background: dark ? 'rgba(92,225,230,.10)' : '#EAFBFC', border: `1px solid ${dark ? '#1C4A4D' : '#BFE7E9'}`, color: t.fg2 }}>
                    <b style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.08em', color: C.teal6 }}>DEV MODE</b>{' '}
                    Email delivery isn't wired up yet, so the code is filled in for you. This never happens in production.
                  </p>
                )}

                {errorBox}

                <button type="submit" disabled={busy} className="cta" style={ctaStyle}>
                  {busy ? 'Checking…' : 'Confirm'}
                </button>

                <p style={{ textAlign: 'center', fontSize: 13.5, color: t.body, margin: 0 }}>
                  {resendIn > 0
                    ? <>Resend in 0:{String(resendIn).padStart(2, '0')}</>
                    : <button type="button" onClick={() => sendCode(purpose)} className="switchlink" style={linkStyle}>Send a new code</button>}
                  {' · '}
                  <button type="button" onClick={restart} className="switchlink" style={linkStyle}>
                    Use another address
                  </button>
                </p>
              </form>
            )}

            {/* ---------- STEP: details - the account is created here ---------- */}
            {step === 'details' && (
              <form onSubmit={submitDetails} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: t.fg3 }}>
                  <span style={{ width: 17, height: 17, borderRadius: 4, background: C.blue, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800 }}>✓</span>
                  {email} confirmed
                </div>
                <div>
                  <label htmlFor="auth-name" style={labelStyle}>Full name</label>
                  <input id="auth-name" className="field" style={inputStyle} value={name}
                    onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" autoFocus required />
                </div>
                <div>
                  <label htmlFor="auth-phone" style={labelStyle}>Phone number</label>
                  <input id="auth-phone" className="field" style={inputStyle} type="tel" value={phone}
                    onChange={(e) => setPhone(e.target.value)} placeholder="+91 98000 00000" autoComplete="tel" required />
                </div>
                <div>
                  <label htmlFor="auth-new-password" style={labelStyle}>Choose a password</label>
                  <input id="auth-new-password" className="field" style={inputStyle} type="password" value={password}
                    onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters"
                    autoComplete="new-password" minLength={6} required />
                  <p style={{ fontSize: 12, color: t.fg3, margin: '7px 0 0' }}>You'll use this to sign in from now on.</p>
                </div>

                {errorBox}

                <button type="submit" disabled={busy} className="cta" style={ctaStyle}>
                  {busy ? 'Creating your account…' : 'Create account'}
                </button>
              </form>
            )}

            {/* ---------- STEP: newPassword - after a forgotten one ---------- */}
            {step === 'newPassword' && (
              <form onSubmit={submitNewPassword} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
                <div>
                  <label htmlFor="auth-reset-password" style={labelStyle}>New password</label>
                  <input id="auth-reset-password" className="field" style={inputStyle} type="password" value={password}
                    onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters"
                    autoComplete="new-password" minLength={6} autoFocus required />
                </div>

                {errorBox}

                <button type="submit" disabled={busy} className="cta" style={ctaStyle}>
                  {busy ? 'Saving…' : 'Set password and sign in'}
                </button>
              </form>
            )}

            {/* ---------- STEP: matched - an offer, not a placement ---------- */}
            {step === 'matched' && completed?.matched_organization && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '13px 15px', borderRadius: 8, background: dark ? 'rgba(0,74,173,.14)' : C.blue50, border: `1px solid ${dark ? '#1B355A' : '#D4E4F8'}` }}>
                  {completed.matched_organization.logo_url
                    ? <img src={completed.matched_organization.logo_url} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                    : <span style={{ width: 34, height: 34, borderRadius: 8, background: C.blue, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 800, flexShrink: 0 }}>{initials(completed.matched_organization.name)}</span>}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: t.fg }}>
                      {completed.matched_organization.name}
                      {completed.matched_organization.verified && (
                        <span style={{ marginLeft: 7, fontFamily: MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '.1em', color: C.teal6, border: '1px solid #BFE7E9', borderRadius: 5, padding: '2px 5px', verticalAlign: 'middle' }}>VERIFIED</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: t.fg3, marginTop: 2 }}>Recognises <b style={{ color: t.fg2 }}>{email.split('@')[1] ?? ''}</b></div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <ChecklistRow done label="Email verified" tokens={t} />
                  <ChecklistRow done label="Account created" tokens={t} />
                  <ChecklistRow done={requested} label={requested ? 'Request sent — awaiting approval' : 'Join your institution'} tokens={t} />
                </div>

                {errorBox}

                {requested ? (
                  <>
                    <p style={{ fontSize: 13.5, color: t.body, margin: 0 }}>
                      An owner or admin at {completed.matched_organization.name} will review your request. You can use your account in the meantime.
                    </p>
                    <button type="button" className="cta" style={ctaStyle} onClick={() => completed.apply()}>
                      Continue
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="cta" style={ctaStyle} disabled={busy}
                      onClick={() => run(async () => { await completed.requestJoin(); setRequested(true); })}>
                      {busy ? 'Sending…' : `Request to join ${completed.matched_organization.name}`}
                    </button>
                    <p style={{ textAlign: 'center', fontSize: 13.5, color: t.body, margin: 0 }}>
                      <button type="button" onClick={() => completed.apply()} className="switchlink" style={linkStyle}>
                        Skip for now
                      </button>
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// "IIM Bangalore" -> "IB"
function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

function ChecklistRow({ done, label, tokens }: { done: boolean; label: string; tokens: { fg: string; fg3: string; line: string } }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
      <span style={{
        width: 17, height: 17, borderRadius: 4, flexShrink: 0, display: 'grid', placeItems: 'center',
        fontSize: 11, fontWeight: 800,
        background: done ? C.blue : 'transparent', color: done ? '#fff' : 'transparent',
        border: done ? `1px solid ${C.blue}` : `1px solid ${tokens.line}`,
      }}>✓</span>
      <span style={{ fontSize: 13.5, color: done ? tokens.fg : tokens.fg3 }}>{label}</span>
    </div>
  );
}

// Six boxes that behave like one field: typing advances, backspace retreats, and a
// pasted code fills the whole row.
function CodeInput({ value, onChange, onComplete, dark, tokens }: {
  value: string;
  onChange: (v: string) => void;
  onComplete: () => void;
  dark: boolean;
  tokens: { fg: string; inputBg: string; inputBorder: string };
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');

  const setAt = (i: number, ch: string) => {
    const next = (value.padEnd(6, ' ').slice(0, 6).split('').map((d, j) => (j === i ? ch : d)).join('')).trimEnd();
    onChange(next.replace(/\s/g, ''));
    if (ch && i < 5) refs.current[i + 1]?.focus();
    if (ch && i === 5 && next.replace(/\s/g, '').length === 6) onComplete();
  };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          className="field"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          autoFocus={i === 0}
          aria-label={`Digit ${i + 1}`}
          value={d.trim()}
          onChange={(e) => setAt(i, e.target.value.replace(/\D/g, '').slice(-1))}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d.trim() && i > 0) refs.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
            if (!pasted) return;
            e.preventDefault();
            onChange(pasted);
            if (pasted.length === 6) onComplete();
            else refs.current[pasted.length]?.focus();
          }}
          style={{
            width: 46, height: 54, textAlign: 'center', fontSize: 20, fontWeight: 700,
            fontFamily: MONO, borderRadius: 6, outline: 'none',
            border: `1px solid ${tokens.inputBorder}`, background: tokens.inputBg, color: tokens.fg,
          }}
        />
      ))}
    </div>
  );
}
