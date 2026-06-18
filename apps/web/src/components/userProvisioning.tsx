import { useMemo } from 'react';
import { useApi } from '../lib/hooks';
import { BRAND } from '../lib/brand';
import { Button, Spinner, toast } from './ui';

// Shared helpers for the "find an existing user by phone, or provision a new login"
// flow used across the add-user surfaces (org POC, members, organisers/officials).

export interface FoundUser { id: string; name: string; phone: string; email: string }
export interface Credentials { name: string; email: string; phone?: string | null; password: string }

// Look up an existing user by a *complete* phone number. Returns nothing until 10+
// digits are entered, so partial matches are never revealed; the result's phone and
// email come back masked from the server.
export function useUserLookup(phone: string) {
  const digits = phone.replace(/\D/g, '');
  const ready = digits.length >= 10;
  const { data, isFetching } = useApi<{ found: boolean; user?: FoundUser }>(
    ready ? `/users/lookup?phone=${encodeURIComponent(phone)}` : null,
  );
  return { ready, loading: ready && isFetching, found: (ready && data?.found && data.user) ? data.user : null };
}

// Status line shown under a phone field while adding a user.
export function PhoneLookupNotice({ phone }: { phone: string }) {
  const { ready, loading, found } = useUserLookup(phone);
  if (!ready) return null;
  if (loading) return <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500"><Spinner /> Checking…</div>;
  if (found) {
    return (
      <div className="mt-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
        ✓ Existing user <b>{found.name}</b> · {found.phone} — they'll be assigned. No new login is created.
      </div>
    );
  }
  return <div className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">No existing user with this number — a new login will be created.</div>;
}

// Shown once after provisioning a new login, with a copy button so the actor can
// send the details to the user for their first sign-in (they're forced to reset).
export function CredentialsPanel({ creds, onDone }: { creds: Credentials; onDone: () => void }) {
  const signInUrl = `${window.location.origin}/login`;
  const text = useMemo(() => [
    `Your ${BRAND.name} login`,
    `Name: ${creds.name}`,
    `Email: ${creds.email}`,
    creds.phone ? `Phone: ${creds.phone}` : null,
    `Temporary password: ${creds.password}`,
    `Sign in at: ${signInUrl}`,
    "You'll be asked to set your own password on first sign-in.",
  ].filter(Boolean).join('\n'), [creds, signInUrl]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.success('Login details copied'); }
    catch { toast.error('Could not copy — select the text and copy manually'); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
        <div className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">Login created for {creds.name}</div>
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-white/70 p-3 text-xs text-slate-700 dark:bg-slate-900/50 dark:text-slate-200">{text}</pre>
        <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">Send this to {creds.name} for their first sign-in.</div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={copy}>Copy details</Button>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}
