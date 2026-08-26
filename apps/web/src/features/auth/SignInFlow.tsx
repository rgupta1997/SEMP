import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useAuth } from '../../lib/auth';
import {
  asSubject, checkCode, identify, looksLikePhone, openAccount, sendCode,
  signInWithPassword, type AccountChoice, type Subject,
} from '../../lib/signin';

// Screens 1-3 of the sign-in flow, as one machine.
//
//   subject  -> who are you (a number or an address)
//   method   -> password, or send me a code
//   code     -> the six digits
//   choose   -> which of your accounts did you mean
//
// `choose` is the step Option B invented. A phone can reach several accounts, so
// BOTH the code path and the password path can land here - the password only tells
// two accounts apart when they differ, and reusing one across work and personal is
// exactly what a person who wanted them separate would do.

type Step = 'subject' | 'method' | 'code' | 'choose';

const C = {
  blue: '#004AAD', blue8: '#013C8B', blue50: '#F1F6FE', teal6: '#159FA6',
  navy: '#0A1A33', fg2: '#374459', fg3: '#6E7E96', line: '#E1E7F0',
};
const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";

export interface SignInFlowProps {
  dark: boolean;
  inputStyle: CSSProperties;
  labelStyle: CSSProperties;
  /** Theme-resolved text colours from the page shell. */
  t: { fg: string; body: string };
  onHeading: (h: { title: string; sub: string }) => void;
  onWantSignup: () => void;
  onWantReset: () => void;
}

export function SignInFlow({ dark, inputStyle, labelStyle, t, onHeading, onWantSignup, onWantReset }: SignInFlowProps) {
  const { adoptSession } = useAuth();

  const [step, setStep] = useState<Step>('subject');
  const [raw, setRaw] = useState('');
  const [subject, setSubject] = useState<Subject | null>(null);
  const [methods, setMethods] = useState<Array<'otp' | 'password'>>([]);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountChoice[]>([]);
  const [ticket, setTicket] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const isPhone = subject != null && 'phone' in subject;

  useEffect(() => {
    const H: Record<Step, { title: string; sub: string }> = {
      subject: { title: 'Welcome back', sub: 'Enter your phone number or email to continue.' },
      method: { title: 'Welcome back', sub: isPhone ? 'Sign in with your password, or we can send a code.' : 'Enter your password to continue.' },
      code: { title: 'Check your messages', sub: `We sent a 6-digit code to ${raw}.` },
      choose: { title: 'Which account?', sub: 'This number is used by more than one account.' },
    };
    onHeading(H[step]);
  }, [step, raw, isPhone, onHeading]);

  useEffect(() => { if (step === 'code') codeRef.current?.focus(); }, [step]);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');

  /** One account -> in. Several -> choose. Used by both paths. */
  const land = async (r: { kind: 'session' | 'choose' } & Record<string, any>) => {
    if (r.kind === 'choose') {
      setAccounts(r.accounts); setTicket(r.verification_token); setStep('choose');
      return;
    }
    await adoptSession(r.session.token);
  };

  async function submitSubject(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const s = asSubject(raw);
      const info = await identify(s);
      setSubject(s);
      if (!info.registered) {
        // No account. Don't say so in an error - offer the door that is actually open.
        setError(null); onWantSignup(); return;
      }
      setMethods(info.methods);
      setStep('method');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try { await land(await signInWithPassword(subject!, password)); }
    catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function requestCode() {
    setError(null); setBusy(true);
    try {
      const r = await sendCode(subject!, 'sign_in');
      setDevCode(r.dev_code ?? null);
      setCode(''); setStep('code');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const r = await checkCode(subject!, code, 'sign_in');
      await land(r.choose
        ? { kind: 'choose', accounts: r.accounts, verification_token: r.verification_token }
        : { kind: 'session', session: r });
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function pick(a: AccountChoice) {
    setError(null); setBusy(true);
    try { await adoptSession((await openAccount(ticket, a.id)).token); }
    catch (e) { fail(e); setBusy(false); }
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
    borderRadius: 6, border: 'none', boxShadow: '0 14px 30px -12px rgba(0,74,173,.55)',
  };
  const ghost: CSSProperties = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    fontSize: 14, fontWeight: 700, color: C.blue,
  };

  const back = (to: Step) => (
    <button type="button" onClick={() => { setStep(to); setError(null); }} style={{ ...ghost, fontWeight: 600, color: t.body }}>
      ← Back
    </button>
  );

  // ---- step: subject ------------------------------------------------------
  if (step === 'subject') return (
    <form onSubmit={submitSubject} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
      <div>
        <label htmlFor="si-subject" style={labelStyle}>Phone number or email</label>
        <input id="si-subject" className="field" style={inputStyle} value={raw} autoFocus
          onChange={(e) => setRaw(e.target.value)} placeholder="+91 98000 00000" autoComplete="username" required />
      </div>
      <Err />
      <button type="submit" disabled={busy || !raw.trim()} className="cta" style={cta}>
        {busy ? 'Checking…' : 'Continue'}
      </button>
    </form>
  );

  // ---- step: method -------------------------------------------------------
  if (step === 'method') return (
    <form onSubmit={submitPassword} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: t.body, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 13, color: t.fg }}>{raw}</span>
        <button type="button" onClick={() => { setStep('subject'); setPassword(''); setError(null); }} style={ghost}>Change</button>
      </div>
      <div>
        <label htmlFor="si-password" style={labelStyle}>Password</label>
        <input id="si-password" className="field" style={inputStyle} type="password" value={password} autoFocus
          onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
      </div>
      <Err />
      <button type="submit" disabled={busy || !password} className="cta" style={cta}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
        {methods.includes('otp') ? (
          <button type="button" onClick={requestCode} disabled={busy} style={ghost}>Send me a code instead</button>
        ) : <span />}
        <button type="button" onClick={onWantReset} style={{ ...ghost, fontWeight: 600, color: t.body }}>Forgotten it?</button>
      </div>
    </form>
  );

  // ---- step: code ---------------------------------------------------------
  if (step === 'code') return (
    <form onSubmit={submitCode} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
      <div>
        <label htmlFor="si-code" style={labelStyle}>6-digit code</label>
        <input id="si-code" ref={codeRef} className="field" inputMode="numeric" autoComplete="one-time-code"
          style={{ ...inputStyle, fontFamily: MONO, fontSize: 22, letterSpacing: '.32em', textAlign: 'center' }}
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="······" required />
      </div>
      {devCode && (
        // Only ever rendered while the delivery bypass is on - the API refuses to
        // start in production with it, so this cannot reach a real user.
        <p style={{
          margin: 0, borderRadius: 6, border: `1px dashed ${C.line}`, background: dark ? 'rgba(0,74,173,.10)' : C.blue50,
          padding: '9px 12px', fontSize: 13, color: t.body,
        }}>
          No SMS provider is wired yet, so here is the code: <b style={{ fontFamily: MONO, color: C.blue }}>{devCode}</b>
        </p>
      )}
      <Err />
      <button type="submit" disabled={busy || code.length !== 6} className="cta" style={cta}>
        {busy ? 'Checking…' : 'Sign in'}
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {back('method')}
        <button type="button" onClick={requestCode} disabled={busy} style={ghost}>Resend code</button>
      </div>
    </form>
  );

  // ---- step: choose -------------------------------------------------------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 28 }}>
      {accounts.map((a) => (
        <button key={a.id} type="button" onClick={() => pick(a)} disabled={busy}
          style={{
            display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left', cursor: 'pointer',
            padding: '14px 16px', borderRadius: 10, border: `1px solid ${dark ? '#22344F' : C.line}`,
            background: dark ? '#0D1829' : '#fff', width: '100%',
          }}>
          <span style={{
            flex: '0 0 auto', width: 42, height: 42, borderRadius: 10, display: 'grid', placeItems: 'center',
            background: a.organization ? C.blue : '#0A1A33', color: '#fff',
            fontFamily: POP, fontWeight: 800, fontSize: 15,
          }}>
            {(a.organization?.name ?? a.name).slice(0, 2).toUpperCase()}
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontFamily: POP, fontWeight: 700, fontSize: 15, color: t.fg }}>{a.name}</span>
            <span style={{ display: 'block', fontSize: 13.5, color: t.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.email}
            </span>
            {/* The cue that makes work-vs-personal legible at a glance. */}
            <span style={{ display: 'block', fontFamily: MONO, fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: C.fg3, marginTop: 3 }}>
              {a.organization ? a.organization.name : 'Personal'}
              {a.sportagon_id ? ` · ${a.sportagon_id}` : ''}
            </span>
          </span>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke={C.fg3} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      ))}
      <Err />
      {back(methods.includes('password') ? 'method' : 'subject')}
    </div>
  );
}
