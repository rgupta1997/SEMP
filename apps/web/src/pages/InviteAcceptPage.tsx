import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth, type AuthContext } from '../lib/auth';
import { BrandMark } from '../components/BrandMark';
import { Button, Card, CardBody, EmptyState, Field, Input, Spinner, toast } from '../components/ui';

interface InvitationView {
  email: string;
  role: string;
  organization: { id: string; name: string; logo_url: string | null; verified: boolean };
  invited_by: string | null;
  expires_at: string | null;
  has_account: boolean;
}

// Accepting an invitation (J1-E3-S2). Reachable signed out - holding the link is the
// proof, because it was delivered to that mailbox - so this page sits outside the
// app shell and establishes its own session.
//
// Two paths, and the server decides which by looking the address up:
//   no account yet        -> name, phone and a password of their own
//   already has an account -> nothing to fill in; the membership is simply added
export function InviteAcceptPage({ token }: { token: string }) {
  const { applyInviteSession } = useAuth();
  const [invite, setInvite] = useState<InvitationView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<InvitationView>('GET', `/auth/invite/${token}`)
      .then((r) => { if (!cancelled) setInvite(r); })
      .catch((e) => { if (!cancelled) setLoadError(e.message ?? 'This invitation is no longer valid'); });
    return () => { cancelled = true; };
  }, [token]);

  if (loadError) {
    return (
      <Shell>
        <EmptyState icon="✉️" title="This invitation isn’t valid"
          description={`${loadError} Ask whoever invited you to send a new one.`} />
      </Shell>
    );
  }
  if (!invite) return <Shell><Spinner /></Shell>;

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const res = await api<{ token: string } & AuthContext & { joined_organization: { id: string } }>(
        'POST', '/auth/invite/accept',
        { token, ...(invite.has_account ? {} : { name, phone, password }) },
      );
      toast.success(`You’ve joined ${invite.organization.name}`);
      // Establishes the session and lands them in the organisation they just joined -
      // never on a participant profile (J1-E3-S2).
      applyInviteSession(res, `/organizations/${res.joined_organization.id}/overview`);
    } catch (err: any) {
      setError(err.message ?? 'Could not accept this invitation');
    } finally { setBusy(false); }
  };

  return (
    <Shell>
      <Card className="w-full max-w-md">
        <CardBody className="space-y-4">
          <div className="flex items-center gap-3">
            {invite.organization.logo_url
              ? <img src={invite.organization.logo_url} alt="" className="h-11 w-11 rounded-xl object-cover" />
              : <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-lg font-black text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                  {invite.organization.name.slice(0, 1)}
                </span>}
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold text-slate-900 dark:text-slate-100">{invite.organization.name}</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {invite.invited_by ? `${invite.invited_by} invited you` : 'You’ve been invited'} as <b>{invite.role}</b>
              </p>
            </div>
          </div>

          <p className="text-sm text-slate-600 dark:text-slate-300">
            {invite.has_account
              ? <>Accepting adds <b>{invite.email}</b> to this organisation. You keep the account you already have.</>
              : <>Set up your account for <b>{invite.email}</b> and you’re in. Your email is already confirmed by this link.</>}
          </p>

          <form onSubmit={accept} className="space-y-3">
            {!invite.has_account && (
              <>
                <Field label="Full name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus required />
                </Field>
                <Field label="Phone number">
                  <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98000 00000" required />
                </Field>
                <Field label="Choose a password" hint="You’ll use this to sign in from now on.">
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters" minLength={6} required />
                </Field>
              </>
            )}
            {error && <p role="alert" className="text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
            <Button type="submit" className="w-full justify-center" disabled={busy}>
              {busy ? 'Joining…' : invite.has_account ? `Join ${invite.organization.name}` : 'Create my account and join'}
            </Button>
          </form>
        </CardBody>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <BrandMark variant="white" />
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Invitation</span>
        </div>
      </header>
      <main className="grid place-items-center p-4 pt-10">{children}</main>
    </div>
  );
}
