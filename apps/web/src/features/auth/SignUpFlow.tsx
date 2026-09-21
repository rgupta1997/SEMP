import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useAuth } from '../../lib/auth';
import { checkCode, completeSignup, identify, sendCode } from '../../lib/signin';

// Screen 4: sign up.
//
// All four fields are required, and BOTH addresses are proved before the account
// row exists. The order is details, then EMAIL, then phone.
//
// Email first because it is the channel that actually delivers: an emailed code is
// sent for real, whereas SMS has no gateway wired and falls back to printing the code
// on screen. Leading with the phone made the first thing a new user ever saw a code
// the product had handed itself, which reads like a broken product rather than a
// deferred integration.
//
// The number still has a cap on how many accounts it may hold, and that is still
// checked at the DETAILS step - before any code is spent - so somebody at the cap is
// told immediately rather than after verifying an address for an account they cannot
// have.
//
// The API takes the verified address from each ticket and never from the form, so a
// caller cannot prove one address and register another. That means the fields are
// locked once their code is sent: letting someone edit the email after verifying it
// would put the form and the ticket out of step, and the server would silently use
// the ticket.

type Step = 'details' | 'email' | 'phone';

const C = { blue: 'var(--brand)', blue50: 'var(--brand-tint)', line: 'var(--line)', ok: '#1E9E5A', okSoft: '#E4F6EC' };
const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";

export interface SignUpFlowProps {
  dark: boolean;
  inputStyle: CSSProperties;
  labelStyle: CSSProperties;
  t: { fg: string; body: string };
  onHeading: (h: { title: string; sub: string }) => void;
}

export function SignUpFlow({ dark, inputStyle, labelStyle, t, onHeading }: SignUpFlowProps) {
  const { adoptSession } = useAuth();

  const [step, setStep] = useState<Step>('details');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [phoneToken, setPhoneToken] = useState('');
  const [emailToken, setEmailToken] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const H: Record<Step, { title: string; sub: string }> = {
      details: { title: 'Create your account', sub: 'We verify both your email and your phone, so this takes two codes.' },
      email: { title: 'Verify your email', sub: `Enter the 6-digit code we sent to ${email}.` },
      phone: { title: 'Verify your phone', sub: `Enter the 6-digit code we sent to ${phone}.` },
    };
    onHeading(H[step]);
  }, [step, phone, email, onHeading]);

  useEffect(() => { if (step !== 'details') codeRef.current?.focus(); }, [step]);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');

  async function startSignup(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      // The phone cap is still checked HERE, before a single code is spent, even
      // though the number is now verified last. Someone at the cap should be told
      // before they go and find a code, not after.
      const info = await identify({ phone });
      if (!info.can_sign_up) { setError('This number already has the maximum number of accounts.'); return; }

      const r = await sendCode({ email }, 'verify_email');
      setDevCode(r.dev_code ?? null); setCode(''); setStep('email');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function confirmEmail(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const r = await checkCode({ email }, code, 'verify_email');
      setEmailToken(r.verification_token);
      const sent = await sendCode({ phone }, 'verify_phone');
      setDevCode(sent.dev_code ?? null); setCode(''); setStep('phone');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function confirmPhone(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const r = await checkCode({ phone }, code, 'verify_phone');
      setPhoneToken(r.verification_token);
      // r.verification_token rather than the state we just set: setState is async,
      // and phoneToken is still the previous render's value on this line.
      const session = await completeSignup({
        phone_token: r.verification_token, email_token: emailToken, name, password,
      });
      await adoptSession(session.token);
    } catch (e) { fail(e); setBusy(false); }
  }

  async function resend() {
    setError(null); setBusy(true);
    try {
      const r = step === 'email'
        ? await sendCode({ email }, 'verify_email')
        : await sendCode({ phone }, 'verify_phone');
      setDevCode(r.dev_code ?? null);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  const Err = () => error ? (
    <p role="alert" style={{
      borderRadius: 4, background: dark ? 'rgba(222,58,58,.12)' : '#FBE6E6',
      border: `1px solid ${dark ? 'rgba(222,58,58,.3)' : '#F3C9C9'}`,
      padding: '10px 13px', fontSize: 13.5, fontWeight: 600,
      color: dark ? '#F4A8A8' : '#B23636', margin: 0,
    }}>{error}</p>
  ) : null;

  const cta: CSSProperties = {
    height: 50, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 9, background: C.blue, color: '#fff', fontFamily: POP, fontWeight: 700, fontSize: 15.5,
    borderRadius: 6, border: 'none', boxShadow: '0 14px 30px -12px color-mix(in srgb, var(--brand) 55%, transparent)',
  };
  const ghost: CSSProperties = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    fontSize: 14, fontWeight: 700, color: C.blue,
  };

  const DevCode = () => devCode ? (
    <p style={{
      margin: 0, borderRadius: 6, border: `1px dashed ${C.line}`,
      background: dark ? 'color-mix(in srgb, var(--brand) 10%, transparent)' : C.blue50, padding: '9px 12px', fontSize: 13, color: t.body,
    }}>
      No SMS gateway is wired yet, so here is the code: <b style={{ fontFamily: MONO, color: C.blue }}>{devCode}</b>
    </p>
  ) : null;

  // Two ticks, so it is obvious which half is done and which is still owed.
  const Progress = () => (
    <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
      {([['Email', !!emailToken], ['Phone', !!phoneToken]] as const).map(([label, done]) => (
        <span key={label} style={{
          fontFamily: MONO, fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase',
          padding: '4px 9px', borderRadius: 999, fontWeight: 700,
          background: done ? C.okSoft : (dark ? '#16233A' : '#EFF2F7'),
          color: done ? C.ok : 'var(--muted)',
        }}>
          {done ? '✓ ' : ''}{label}
        </span>
      ))}
    </div>
  );

  const codeField = (
    <div>
      <label htmlFor="su-code" style={labelStyle}>6-digit code</label>
      <input id="su-code" ref={codeRef} className="field" inputMode="numeric" autoComplete="one-time-code"
        style={{ ...inputStyle, fontFamily: MONO, fontSize: 22, letterSpacing: '.32em', textAlign: 'center' }}
        value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder="······" required />
    </div>
  );

  if (step === 'details') return (
    <form onSubmit={startSignup} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
      <div>
        <label htmlFor="su-name" style={labelStyle}>Full name</label>
        <input id="su-name" className="field" style={inputStyle} value={name} autoFocus
          onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" required />
      </div>
      <div>
        <label htmlFor="su-email" style={labelStyle}>Email</label>
        <input id="su-email" className="field" style={inputStyle} type="email" value={email}
          onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
      </div>
      <div>
        <label htmlFor="su-phone" style={labelStyle}>Phone number</label>
        <input id="su-phone" className="field" style={inputStyle} type="tel" value={phone}
          onChange={(e) => setPhone(e.target.value)} placeholder="+91 98000 00000" autoComplete="tel" required />
      </div>
      <div>
        <label htmlFor="su-password" style={labelStyle}>Password</label>
        <input id="su-password" className="field" style={inputStyle} type="password" value={password}
          onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters"
          autoComplete="new-password" minLength={6} required />
      </div>
      <Err />
      <button type="submit" disabled={busy} className="cta" style={cta}>
        {busy ? 'Please wait…' : 'Continue'}
      </button>
    </form>
  );

  if (step === 'email') return (
    <form onSubmit={confirmEmail} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
      <Progress />
      {codeField}
      {/* Real mail takes a few seconds to arrive, so say so rather than letting an
          empty inbox read as a failure. */}
      <p style={{ margin: 0, fontSize: 13, color: t.body }}>
        The code can take a few seconds to arrive. Check your spam folder if it doesn’t.
      </p>
      <DevCode />
      <Err />
      <button type="submit" disabled={busy || code.length !== 6} className="cta" style={cta}>
        {busy ? 'Checking…' : 'Verify email'}
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button type="button" onClick={() => { setStep('details'); setError(null); }} style={{ ...ghost, fontWeight: 600, color: t.body }}>← Back</button>
        <button type="button" onClick={resend} disabled={busy} style={ghost}>Resend code</button>
      </div>
    </form>
  );

  return (
    <form onSubmit={confirmPhone} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
      <Progress />
      {codeField}
      <DevCode />
      <Err />
      <button type="submit" disabled={busy || code.length !== 6} className="cta" style={cta}>
        {busy ? 'Creating your account…' : 'Verify phone and finish'}
      </button>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" onClick={resend} disabled={busy} style={ghost}>Resend code</button>
      </div>
    </form>
  );
}
