import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { Button, Input } from '../components/ui';

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

export function AuthPage() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
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

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-slate-900 p-12 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-500/30 blur-3xl" />
        <div className="absolute -bottom-24 -left-16 h-80 w-80 rounded-full bg-brand-700/30 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-500 text-2xl font-black">S</span>
          <span className="text-2xl font-bold">Sports Championship Management Platform</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-bold leading-tight">Run your entire sports fest from one screen.</h1>
          <p className="mt-4 text-lg text-slate-300">Championships, tournaments, rosters, approvals, fixtures and live standings — one platform that adapts to every role.</p>
          <div className="mt-8 flex flex-wrap gap-2 text-sm">
            {['Organisers', 'Organizations', 'Captains', 'Officials', 'Participants'].map((t) => (
              <span key={t} className="rounded-full bg-white/10 px-3 py-1 font-medium">{t}</span>
            ))}
          </div>
        </div>
        <div className="relative text-sm text-slate-400">Sports Championship Management Platform</div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-slate-50 dark:bg-slate-800/60 p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500 text-xl font-black text-white">S</span>
            <span className="text-xl font-bold">Sportagon</span>
          </div>

          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{mode === 'login' ? 'Sign in to your SEMP workspace.' : 'Start hosting or join an championship in minutes.'}</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Full name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
            </div>
            {mode === 'signup' && (
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Phone number</label>
                <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98000 00000" required />
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Password</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
            {error && <p className="rounded-lg bg-rose-50 dark:bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); }} className="font-semibold text-brand-600 dark:text-brand-300 hover:underline">
              {mode === 'login' ? 'Sign up' : 'Sign in'}
            </button>
          </p>

          <div className="mt-8">
            <div className="mb-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Demo logins · all roles (temporary)</div>
            <div className="max-h-72 space-y-3 overflow-auto pr-1">
              {DEMO_GROUPS.map((g) => (
                <div key={g.group}>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{g.group}</div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {g.accounts.map((d) => (
                      <button key={d.email} onClick={() => quick(d.email, d.pw ?? 'demo123')} disabled={busy}
                        className="flex flex-col rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-left hover:border-brand-300 dark:hover:border-brand-500/50 hover:bg-brand-50 dark:hover:bg-brand-500/10 disabled:opacity-50">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{d.label}</span>
                        <span className="truncate text-xs text-slate-500 dark:text-slate-400">{d.email}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-center text-[11px] text-slate-400 dark:text-slate-500">Password <span className="font-mono">demo123</span> · admin <span className="font-mono">admin123</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}
