import { useEffect, useState } from 'react';
import { BadgeCheck, ShieldOff, TrendingDown, TrendingUp } from 'lucide-react';
import { cn, toast } from '../../../components/ui';

// Shared plumbing for the four certificate screens.

export const API = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000') + '/api';
const bearer = () => ({ Authorization: `Bearer ${localStorage.getItem('semp_token') ?? ''}` });

export interface Cert {
  id: string; serial: string; recipient_name: string; issued_at: string;
  revoked_at: string | null; revoked_reason: string | null; superseded_at: string | null;
  token: string; sport: string | null; title: string | null; scans: number;
  status: 'issued' | 'verified' | 'withdrawn' | 'superseded';
  championships: { id: string; name: string } | null;
  certificate_templates: { id: string; name: string } | null;
}

export interface Template {
  id: string; name: string; code: string | null; is_default: boolean;
  used_count: number; design: Record<string, any>;
}

export interface Preset {
  id: string; name: string; category: string; blurb: string;
  design: Record<string, any>; in_use: boolean;
}

export interface Delta { value: number; delta_pct: number | null }

/**
 * An authenticated document, handed to the browser as a blob.
 *
 * The renders are HTML behind a bearer token, and neither an <iframe src> nor an
 * <a href> sends an Authorization header - so both would show a 401 page. Fetching
 * first and pointing at the blob is what makes a preview possible at all.
 */
export function useAuthedDoc(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) { setUrl(null); return; }
    let dead = false;
    let made: string | null = null;
    setError(null);
    fetch(`${API}${path}`, { headers: bearer() })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.text();
      })
      .then((html) => {
        if (dead) return;
        made = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        setUrl(made);
      })
      .catch((e) => { if (!dead) setError(e?.message ?? 'failed'); });

    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [path]);

  return { url, error };
}

/** Open a render in a new tab, or save it, with the session attached. */
export async function openDoc(path: string, opts: { download?: string } = {}) {
  try {
    const res = await fetch(`${API}${path}`, { headers: bearer() });
    if (!res.ok) throw new Error(`${res.status}`);
    const url = URL.createObjectURL(new Blob([await res.text()], {
      type: res.headers.get('content-type') ?? 'text/html',
    }));
    if (opts.download) {
      const a = document.createElement('a');
      a.href = url; a.download = opts.download; a.click();
    } else {
      window.open(url, '_blank', 'noopener');
    }
    // Revoked on a delay so the new tab has actually loaded it first.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e: any) { toast.error('Could not open the document', e?.message); }
}

/**
 * A live preview of a design, scaled down.
 *
 * The thumbnail is the template - the same renderer, the same CSS - rather than a
 * screenshot somebody has to remember to refresh. A design cannot look one way in the
 * gallery and another way on the printed page.
 */
// A4 landscape is 297×210mm; at 96dpi that is 1123×794 CSS pixels. The iframe is held
// at exactly that and scaled, so a preview is geometrically identical to the print
// rather than a reflowed approximation of it.
const SHEET_W = 1123, SHEET_H = 794;

export function SheetPreview({ path, width, className = '' }: { path: string | null; width: number; className?: string }) {
  const { url, error } = useAuthedDoc(path);
  const scale = width / SHEET_W;
  return (
    <div
      className={cn('relative overflow-hidden rounded-lg bg-white ring-1 ring-slate-200 dark:ring-slate-700', className)}
      style={{ width, height: Math.round(SHEET_H * scale) }}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ width: SHEET_W, height: SHEET_H, transform: `scale(${scale})` }}>
        {url ? (
          <iframe
            title="Certificate preview" src={url} tabIndex={-1} scrolling="no"
            className="pointer-events-none h-full w-full border-0"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-2xl text-slate-300">
            {error ? 'Preview unavailable' : 'Loading preview…'}
          </div>
        )}
      </div>
    </div>
  );
}

/** VERIFIED / ISSUED / WITHDRAWN - a state derived from what happened, not a flag. */
export function CertStatus({ status }: { status: Cert['status'] }) {
  const map = {
    verified: { label: 'Verified', icon: BadgeCheck, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
    issued: { label: 'Issued', icon: BadgeCheck, cls: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300' },
    withdrawn: { label: 'Withdrawn', icon: ShieldOff, cls: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' },
    superseded: { label: 'Superseded', icon: ShieldOff, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' },
  }[status] ?? { label: status, icon: BadgeCheck, cls: 'bg-slate-100 text-slate-700' };
  const Icon = map.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', map.cls)}>
      <Icon size={11} aria-hidden />{map.label}
    </span>
  );
}

/**
 * A KPI tile with its month-on-month movement.
 *
 * `delta_pct: null` means there is nothing to compare against, and the tile says so
 * rather than printing a confident "+0%" over a month that did not exist.
 */
export function KpiTile({ label, kpi, tone, note }: {
  label: string; kpi?: Delta; tone?: 'warning'; note?: string;
}) {
  const d = kpi?.delta_pct;
  const up = (d ?? 0) >= 0;
  const Arrow = up ? TrendingUp : TrendingDown;
  return (
    <div className={cn('rounded-xl border bg-white p-4 dark:bg-slate-900',
      tone === 'warning' && (kpi?.value ?? 0) > 0
        ? 'border-amber-300 dark:border-amber-800'
        : 'border-slate-200 dark:border-slate-800')}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{kpi?.value ?? '—'}</div>
      {tone === 'warning' && (kpi?.value ?? 0) > 0 ? (
        <div className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">⚠ Needs action</div>
      ) : d === null || d === undefined ? (
        <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">{note ?? 'No comparison yet'}</div>
      ) : (
        <div className={cn('mt-1 inline-flex items-center gap-1 text-xs font-medium',
          up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
          <Arrow size={12} aria-hidden />{up ? '+' : ''}{d}% vs last month
        </div>
      )}
    </div>
  );
}

export const shortDate = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export const whenish = (s: string) => {
  const mins = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  if (mins < 60 * 24 * 7) return `${Math.round(mins / 1440)}d ago`;
  return shortDate(s);
};
