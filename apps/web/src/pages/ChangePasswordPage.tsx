import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { Button, Input, toast } from '../components/ui';

// Shown full-screen when a provisioned login signs in for the first time
// (must_change_password). Blocks the app until they set their own password.
export function ChangePasswordPage() {
  const { ctx, changePassword, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setBusy(true);
    try {
      await changePassword(password);
      toast.success('Password updated');
    } catch (err: any) {
      setError(err?.message ?? 'Could not update password');
    } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Set your password</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Welcome{ctx?.user?.name ? `, ${ctx.user.name}` : ''}. Your account was set up with a temporary password - choose your own to continue.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">New password</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" autoFocus />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Confirm password</label>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" />
          </div>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Set password & continue'}</Button>
        </form>
        <button onClick={logout} className="mt-4 w-full text-center text-sm font-medium text-slate-500 hover:underline dark:text-slate-400">
          Sign out
        </button>
      </div>
    </div>
  );
}
