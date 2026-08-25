import { useEffect, useState } from 'react';
import { AlertTriangle, BadgeCheck, Check, HelpCircle, ShieldOff } from 'lucide-react';
import { api } from '../../lib/api';
import { BrandMark } from '../../components/BrandMark';

// Public certificate verification (J4-E8).
//
// Outside the app shell and outside auth on purpose: the entire value of a certificate
// is that somebody with no relationship to the institution - an employer, a selector -
// can check it. If this page needed an account it would verify nothing for the people
// who most need to verify it.
//
// It states a verdict plainly and never hedges. "Probably fine" is not an answer
// anybody can act on.

type Verdict = 'authentic' | 'revoked' | 'superseded' | 'tampered' | 'unknown';

interface Result {
  verdict: Verdict;
  message: string;
  signature_valid?: boolean;
  verified_at?: string;
  withdrawn_on?: string;
  reason?: string;
  certificate?: {
    serial: string; recipient: string; event: string | null; sport: string | null;
    title: string | null; issued_on: string; issued_by: string | null; issuer_verified: boolean;
  };
}

const LOOK: Record<Verdict, { icon: typeof Check; ring: string; tone: string; heading: string }> = {
  authentic: { icon: Check, ring: 'border-emerald-500', tone: 'text-emerald-700 dark:text-emerald-400', heading: 'Certificate is authentic' },
  revoked: { icon: ShieldOff, ring: 'border-rose-500', tone: 'text-rose-700 dark:text-rose-400', heading: 'Certificate withdrawn' },
  superseded: { icon: AlertTriangle, ring: 'border-amber-500', tone: 'text-amber-700 dark:text-amber-400', heading: 'Result later corrected' },
  tampered: { icon: AlertTriangle, ring: 'border-rose-500', tone: 'text-rose-700 dark:text-rose-400', heading: 'Details do not match' },
  unknown: { icon: HelpCircle, ring: 'border-slate-400', tone: 'text-slate-600 dark:text-slate-300', heading: 'Not a certificate we issued' },
};

const Field = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">{value}</dd>
  </div>
);

// The token arrives as a PROP, not from useParams: this page is rendered outside the
// <Route> tree (ahead of every auth check, like the share link), so there is no route
// context to read params from - useParams would silently hand back undefined.
export function VerifyCertificatePage({ token }: { token?: string }) {
  const [result, setResult] = useState<Result | null>(null);
  const [failed, setFailed] = useState(false);
  // Reached without a code - somebody opened the verifier from inside the product,
  // or typed the address off a printed certificate. They need somewhere to put the
  // code, not an error about not having supplied one.
  const [code, setCode] = useState('');

  useEffect(() => {
    if (!token) { setResult(null); setFailed(false); return; }
    let live = true;
    api<Result>('GET', `/public/certificates/${token}`)
      .then((r) => { if (live) setResult(r); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [token]);

  if (!token) {
    return (
      <main className="mx-auto max-w-lg px-6 py-20">
        <BrandMark />
        <h1 className="mt-8 text-xl font-bold text-slate-900 dark:text-slate-100">Check a certificate</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Scan the QR code on the certificate, or type the code printed beneath it.
          You do not need an account.
        </p>
        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const c = code.trim();
            if (c) window.location.assign(`/verify/${encodeURIComponent(c)}`);
          }}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Certificate code"
            aria-label="Certificate code"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!code.trim()}
          >
            Check
          </button>
        </form>
      </main>
    );
  }

  if (failed) {
    return (
      <main className="mx-auto max-w-lg px-6 py-20 text-center">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          We could not reach the verification service. That is a problem at our end, not with the certificate — please try again shortly.
        </p>
      </main>
    );
  }
  if (!result) {
    return <main className="mx-auto max-w-lg px-6 py-20 text-center text-sm text-slate-500">Checking…</main>;
  }

  const look = LOOK[result.verdict] ?? LOOK.unknown;
  const Icon = look.icon;
  const c = result.certificate;

  return (
    <div className="min-h-screen bg-[var(--canvas)] dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-6 py-3.5 dark:border-slate-800 dark:bg-slate-900">
        <BrandMark height={22} />
      </header>

      <main className="mx-auto grid max-w-4xl gap-5 px-6 py-10 md:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <div className={`mx-auto grid h-16 w-16 place-items-center rounded-2xl border-2 ${look.ring}`}>
            <Icon size={28} className={look.tone} aria-hidden />
          </div>
          <h1 className={`mt-4 text-xl font-semibold ${look.tone}`}>{look.heading}</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm text-slate-600 dark:text-slate-400">{result.message}</p>

          {c && (
            <dl className="mt-6 grid gap-3 border-t border-slate-200 pt-5 text-left dark:border-slate-800">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Certificate ID</dt>
                <dd className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{c.serial}</dd>
              </div>
              {result.verified_at && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Checked</dt>
                  <dd className="text-sm text-slate-700 dark:text-slate-300">{new Date(result.verified_at).toLocaleString()}</dd>
                </div>
              )}
              {result.withdrawn_on && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Withdrawn</dt>
                  <dd className="text-sm text-slate-700 dark:text-slate-300">{new Date(result.withdrawn_on).toLocaleDateString()}</dd>
                </div>
              )}
            </dl>
          )}
        </section>

        {c && (
          <div className="grid gap-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Certificate summary</h2>
              <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-200 pt-4 dark:border-slate-800">
                <Field label="Recipient" value={c.recipient} />
                <Field label="Event" value={c.event ?? '—'} />
                <Field label="Sport" value={c.sport ?? '—'} />
                <Field label="Issue date" value={new Date(c.issued_on).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} />
                <div className="col-span-2"><Field label="Issued by" value={c.issued_by ?? '—'} /></div>
              </dl>
              <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
                <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Digital signature</span>
                {/* Says exactly what was checked. A green tick next to a signature that
                    was never validated would be the one lie this page cannot afford. */}
                {result.signature_valid
                  ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"><BadgeCheck size={13} aria-hidden />Verified</span>
                  : <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"><ShieldOff size={13} aria-hidden />Does not match</span>}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
              <p className="font-medium text-slate-800 dark:text-slate-200">How this was checked</p>
              <p className="mt-1">
                The details above were signed when the certificate was issued and re-checked just now against that signature.
                Every check is recorded, and that record cannot be edited or removed.
              </p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
