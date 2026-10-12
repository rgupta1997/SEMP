import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Building2, Check, Mail } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { BrandMark } from '../components/BrandMark';
import { useAuth } from '../lib/auth';

// Landing page for an emailed invitation link (J1-E3).
//
// Rendered outside the app shell and ahead of the signed-out redirect, because the
// recipient may have no account at all - that is the normal case, not the edge one.
// Showing what the invitation is FOR before asking for a sign-in matters: an
// unexplained login wall reached from an email is exactly what a phishing page looks
// like, and the one defence a recipient has is being told who invited them to what.
//
// The token arrives as a PROP rather than from useParams: this renders outside the
// <Route> tree, so there is no route context and useParams would hand back undefined.

/** Survives the trip through /login, which would otherwise cost the visitor the URL. */
export const PENDING_INVITE_KEY = 'semp_pending_invite';

interface Invitation {
  organization_name: string;
  role: string;
  invited_by: string | null;
  expires_at: string | null;
}

const Field = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">{value}</dd>
  </div>
);

export function InviteAcceptPage({ token }: { token?: string }) {
  const { ctx } = useAuth();
  const navigate = useNavigate();

  const [invite, setInvite] = useState<Invitation | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'accepted'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setState('gone'); return; }
    let live = true;
    api<Invitation>('GET', `/public/invites/${encodeURIComponent(token)}`)
      .then((r) => { if (live) { setInvite(r); setState('ready'); } })
      // The API answers the same way for missing, spent and expired, so that a
      // guessed token cannot be used to confirm a real one. Say so plainly.
      .catch(() => { if (live) setState('gone'); });
    return () => { live = false; };
  }, [token]);

  async function accept() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/invites/${encodeURIComponent(token)}/accept`);
      sessionStorage.removeItem(PENDING_INVITE_KEY);
      setState('accepted');
      // Straight to the app - whatever the invitation granted is live now, and the
      // full reload lets the auth context pick up the new membership.
      setTimeout(() => { window.location.href = '/'; }, 1200);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not accept the invitation. Try again.');
      setBusy(false);
    }
  }

  function signInToAccept() {
    if (token) sessionStorage.setItem(PENDING_INVITE_KEY, token);
    navigate('/login');
  }

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-4 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><BrandMark /></div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {children}
        </div>
      </div>
    </div>
  );

  if (state === 'loading') {
    return <Shell><p className="text-center text-sm text-slate-500 dark:text-slate-400">Checking the invitation…</p></Shell>;
  }

  if (state === 'gone') {
    return (
      <Shell>
        <div className="flex flex-col items-center text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-amber-500" aria-hidden />
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">This invitation is no longer valid</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            It may have already been accepted, been withdrawn, or expired. Ask whoever invited you to send a new one.
          </p>
        </div>
      </Shell>
    );
  }

  if (state === 'accepted') {
    return (
      <Shell>
        <div className="flex flex-col items-center text-center">
          <Check className="mb-3 h-8 w-8 text-emerald-600" aria-hidden />
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">You're in</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Taking you to {invite?.organization_name}…</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-col items-center text-center">
        <Building2 className="mb-3 h-8 w-8 text-slate-400" aria-hidden />
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          You've been invited to join {invite!.organization_name}
        </h1>
        {invite!.invited_by && (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            <strong className="font-medium">{invite!.invited_by}</strong> invited you as {invite!.role}.
          </p>
        )}
      </div>

      <dl className="mt-5 grid gap-3 rounded-lg bg-slate-50 p-4 dark:bg-slate-800/50">
        <Field label="Organisation" value={invite!.organization_name} />
        <Field label="Role" value={invite!.role} />
        {invite!.invited_by && <Field label="Invited by" value={invite!.invited_by} />}
      </dl>

      {error && <p className="mt-4 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      {ctx ? (
        <button
          type="button" onClick={accept} disabled={busy}
          className="mt-5 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-slate-900"
        >
          {busy ? 'Accepting…' : 'Accept the invitation'}
        </button>
      ) : (
        <>
          <button
            type="button" onClick={signInToAccept}
            className="mt-5 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-slate-900"
          >
            Sign in to accept
          </button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Mail className="h-3.5 w-3.5" aria-hidden />
            No account yet? You can create one with this address.
          </p>
        </>
      )}

      {invite!.expires_at && (
        <p className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
          This invitation expires on {new Date(invite!.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.
        </p>
      )}
    </Shell>
  );
}
