import { useState } from 'react';
import { QrCode, ScanLine } from 'lucide-react';
import { Button, Input } from '../../components/ui';

// The QR verifier's front door (J4-E8).
//
// A phone scanning the QR lands straight on /verify/<token> and never sees this page.
// This is for the other half: somebody holding a printed certificate, or an email with
// a link in it, who wants to check it from a desktop. Public and unauthenticated, for
// the same reason the result page is - an employer checking a graduate's certificate
// has no account here and never will.

/** Accept whatever somebody pastes: a bare token, or the whole verification URL. */
export function tokenFrom(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const fromUrl = s.match(/\/verify\/([A-Za-z0-9_-]{8,})/);
  const token = fromUrl ? fromUrl[1] : s;
  return /^[A-Za-z0-9_-]{8,}$/.test(token) ? token : null;
}

export function VerifyLookupPage() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const token = tokenFrom(value);
    if (!token) {
      // Says what is wrong and what would be right, rather than just "invalid".
      setError('That does not look like a verification code. Paste the full link from the certificate, or the code after /verify/.');
      return;
    }
    window.location.assign(`/verify/${token}`);
  };

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-white">
            <ScanLine size={20} aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Verify a certificate</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Check that a certificate is genuine and still valid.</p>
          </div>
        </div>

        <form onSubmit={go} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">Verification link or code</span>
            <Input
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(null); }}
              placeholder="https://…/verify/abc123  or  abc123"
              autoFocus
              aria-invalid={!!error}
            />
          </label>
          {error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <Button type="submit" className="mt-4 w-full justify-center" disabled={!value.trim()}>
            <QrCode size={15} aria-hidden />Verify
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
          Every certificate carries a QR code. Scanning it with a phone camera opens the
          same check directly — no account needed, here or there.
        </p>
      </div>
    </div>
  );
}
