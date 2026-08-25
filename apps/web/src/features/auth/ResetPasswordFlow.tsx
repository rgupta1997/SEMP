import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { asSubject, checkCode, resetPassword, sendCode, type AccountChoice, type Subject } from '../../lib/signin';

// Screen 5: forgotten password.
//
// Same shape as sign-in, and for the same reason: a phone reaches several accounts,
// so "reset the password" is not a well-formed request until one is chosen. The
// chooser therefore appears here too - and it matters more here than at sign-in,
// because resetting the wrong account's password is a change the person did not
// ask for and will not notice until they try to sign in to the other one.
//
// Note what the flow never does: say whether an account exists. Asking for a code
// on an unknown subject gets the same "we've sent it" as a known one, so this form
// cannot be used to test whether a number is registered.

type Step = 'subject' | 'code' | 'choose' | 'password' | 'done';

const C = { blue: '#004AAD', blue50: '#F1F6FE', line: '#E1E7F0', ok: '#1E9E5A', okSoft: '#E4F6EC' };
const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";

export interface ResetPasswordFlowProps {
  dark: boolean;
  inputStyle: CSSProperties;
  labelStyle: CSSProperties;
  t: { fg: string; body: string };
  onHeading: (h: { title: string; sub: string }) => void;
  onDone: () => void;
}

export function ResetPasswordFlow({ dark, inputStyle, labelStyle, t, onHeading, onDone }: ResetPasswordFlowProps) {
  const [step, setStep] = useState<Step>('subject');
  const [raw, setRaw] = useState('');
  const [subject, setSubject] = useState<Subject | null>(null);
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [ticket, setTicket] = useState('');
  const [accounts, setAccounts] = useState<AccountChoice[]>([]);
  const [accountId, setAccountId] = useState<string | undefined>();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const H: Record<Step, { title: string; sub: string }> = {
      subject: { title: 'Reset your password', sub: 'Tell us the phone number or email on the account.' },
      code: { title: 'Check your messages', sub: `If that account exists, a 6-digit code is on its way to ${raw}.` },
      choose: { title: 'Which account?', sub: 'Choose the account whose password you want to change.' },
      password: { title: 'Choose a new password', sub: 'At least 6 characters.' },
      done: { title: 'Password changed', sub: 'You can sign in with your new password.' },
    };
    onHeading(H[step]);
  }, [step, raw, onHeading]);

  useEffect(() => { if (step === 'code') codeRef.current?.focus(); }, [step]);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');

  async function submitSubject(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const s = asSubject(raw);
      setSubject(s);
      const r = await sendCode(s, 'password_reset');
      setDevCode(r.dev_code ?? null); setCode(''); setStep('code');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const r = await checkCode(subject!, code, 'password_reset');
      setTicket(r.verification_token);
      setStep('password');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const r = await resetPassword({ verification_token: ticket, account_id: accountId, password });
      if (r.choose) {
        // The server will not guess which account on a shared number was meant.
        setAccounts(r.accounts); setStep('choose'); return;
      }
      setStep('done');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function pick(a: AccountChoice) {
    setAccountId(a.id); setError(null); setBusy(true);
    try {
      await resetPassword({ verification_token: ticket, account_id: a.id, password });
      setStep('done');
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
    borderRadius: 6, border: 'none', boxShadow: '0 14px 30px -12px rgba(0,74,173,.55)',
  };
  const ghost: CSSProperties = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    fontSize: 14, fontWeight: 700, color: C.blue,
  };

  if (step === 'subject') return (
    <form onSubmit={submitSubject} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
      <div>
        <label htmlFor="rp-subject" style={labelStyle}>Phone number or email</label>
        <input id="rp-subject" className="field" style={inputStyle} value={raw} autoFocus
          onChange={(e) => setRaw(e.target.value)} placeholder="+91 98000 00000" autoComplete="username" required />
      </div>
      <Err />
      <button type="submit" disabled={busy || !raw.trim()} className="cta" style={cta}>
        {busy ? 'Sending…' : 'Send code'}
      </button>
      <button type="button" onClick={onDone} style={{ ...ghost, fontWeight: 600, color: t.body }}>← Back to sign in</button>
    </form>
  );

  if (step === 'code') return (
    <form onSubmit={submitCode} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
      <div>
        <label htmlFor="rp-code" style={labelStyle}>6-digit code</label>
        <input id="rp-code" ref={codeRef} className="field" inputMode="numeric" autoComplete="one-time-code"
          style={{ ...inputStyle, fontFamily: MONO, fontSize: 22, letterSpacing: '.32em', textAlign: 'center' }}
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="······" required />
      </div>
      {devCode && (
        <p style={{
          margin: 0, borderRadius: 6, border: `1px dashed ${C.line}`,
          background: dark ? 'rgba(0,74,173,.10)' : C.blue50, padding: '9px 12px', fontSize: 13, color: t.body,
        }}>
          Delivery isn't wired yet, so here is the code: <b style={{ fontFamily: MONO, color: C.blue }}>{devCode}</b>
        </p>
      )}
      <Err />
      <button type="submit" disabled={busy || code.length !== 6} className="cta" style={cta}>
        {busy ? 'Checking…' : 'Continue'}
      </button>
      <button type="button" onClick={() => { setStep('subject'); setError(null); }} style={{ ...ghost, fontWeight: 600, color: t.body }}>← Back</button>
    </form>
  );

  if (step === 'password') return (
    <form onSubmit={submitPassword} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
      <div>
        <label htmlFor="rp-password" style={labelStyle}>New password</label>
        <input id="rp-password" className="field" style={inputStyle} type="password" value={password} autoFocus
          onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters"
          autoComplete="new-password" minLength={6} required />
      </div>
      <Err />
      <button type="submit" disabled={busy || password.length < 6} className="cta" style={cta}>
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );

  if (step === 'choose') return (
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
            background: a.organization ? C.blue : '#0A1A33', color: '#fff', fontFamily: POP, fontWeight: 800, fontSize: 15,
          }}>{(a.organization?.name ?? a.name).slice(0, 2).toUpperCase()}</span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontFamily: POP, fontWeight: 700, fontSize: 15, color: t.fg }}>{a.name}</span>
            <span style={{ display: 'block', fontSize: 13.5, color: t.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.email}</span>
            <span style={{ display: 'block', fontFamily: MONO, fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#6E7E96', marginTop: 3 }}>
              {a.organization ? a.organization.name : 'Personal'}{a.sportagon_id ? ` · ${a.sportagon_id}` : ''}
            </span>
          </span>
        </button>
      ))}
      <Err />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 28 }}>
      <p style={{
        margin: 0, borderRadius: 6, background: dark ? 'rgba(30,158,90,.12)' : C.okSoft,
        border: `1px solid ${dark ? 'rgba(30,158,90,.3)' : '#C7E9D5'}`,
        padding: '12px 14px', fontSize: 14, fontWeight: 600, color: dark ? '#8FD9AE' : '#1E6E45',
      }}>
        Your password has been changed. Any other account on this number is untouched.
      </p>
      <button type="button" onClick={onDone} className="cta" style={cta}>Back to sign in</button>
    </div>
  );
}
