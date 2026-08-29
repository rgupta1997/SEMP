import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type {
  ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode,
  SelectHTMLAttributes, TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, ChevronLeft, CircleDashed, Info, Search, X } from 'lucide-react';
import { titleCase } from '../lib/format';
import { useDialog } from '../lib/useDialog';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ----------------------------- Button ----------------------------- */
type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg';

export function Button({
  className = '', variant = 'primary', size = 'md', ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  const variants: Record<ButtonVariant, string> = {
    // brand-600, not brand-500. index.css calls 600 "the 234-use primary" and it is
    // the step the seed colour IS; 500 is a lighter tint two stops up the ladder.
    // With a fixed blue ramp the difference was cosmetic. With a derived one it is a
    // contrast bug: a maroon seed makes 500 a pale pink, and every primary button in
    // the product puts white text on it.
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
    ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
    outline: 'border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm',
    subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300 dark:hover:bg-brand-500/25',
  };
  // MINIMUM HEIGHTS, not just padding. `py-1.5 text-xs` is a 28px button, which is
  // 16px short of the 44px a thumb needs, and the audit found these used for real
  // actions - Verify, Lock, Remove - on rows people tap on a phone. The height
  // floors relax at sm+ where a pointer is precise and 28px is the right density.
  const sizes: Record<ButtonSize, string> = {
    sm: 'min-h-[36px] sm:min-h-0 px-2.5 py-1.5 text-xs rounded gap-1.5',
    md: 'min-h-[44px] sm:min-h-0 px-3.5 py-2 text-sm rounded gap-2',
    lg: 'min-h-[48px] px-5 py-2.5 text-base rounded-md gap-2',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-semibold whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150',
        'active:translate-y-px active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:transform-none',
        variants[variant], sizes[size], className,
      )}
      {...p}
    />
  );
}

/* ----------------------------- Inputs ----------------------------- */
const fieldBase =
  'rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 transition-[border-color,box-shadow] focus:outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/20 disabled:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-900';

export const Input = ({ className = '', ...p }: InputHTMLAttributes<HTMLInputElement>) =>
  <input className={cn('w-full', fieldBase, className)} {...p} />;

export function Select({ className = '', ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  const full = /\bw-full\b/.test(className);
  return (
    <div className={cn('relative shrink-0', full ? 'w-full' : 'inline-block')}>
      <select
        className={cn(fieldBase, 'appearance-none pr-8', full ? 'w-full' : 'w-auto min-w-[9.5rem]', className)}
        {...p}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" aria-hidden><ChevronDown size={14} /></span>
    </div>
  );
}

export const Textarea = ({ className = '', ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) =>
  <textarea className={cn(fieldBase, className)} {...p} />;

export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="block mb-4">
    <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">{label}</span>
    {children}
    {hint && <span className="block text-xs text-slate-400 dark:text-slate-500 mt-1">{hint}</span>}
  </label>
);

/* ----------------------------- Card ----------------------------- */
/**
 * ONE bordered surface, and one edge inside it.
 *
 * Every panel that sits on the page background is `SURFACE`; every block that
 * sits on a panel is `INSET`. They had drifted into four radii and two dark
 * palettes - a table at rounded-md beside a card at rounded-2xl, a slate-700
 * edge on a slate-800 ground beside a slate-800 edge on a slate-900 one - which
 * is legible on any single screen and obvious the moment you move between two.
 *
 * The edge is `eos-line` (var(--line)) and the radius is `--radius-card` (14px),
 * which is what the EOS prototype draws and what the profile screens already
 * hard-code inline. The Tailwind half of the app now says the same thing rather
 * than something a shade off it.
 *
 * FORM CONTROLS ARE NOT SURFACES. An input keeps its lighter dark edge
 * (slate-700 on a slate-800 ground) because it sits ON a panel and has to read
 * as inset - see `fieldBase`. Only panels use these two.
 *
 * Reach for these rather than retyping the classes: a fifth radius enters the
 * product the first time somebody guesses.
 */
export const SURFACE = 'rounded-card border border-eos-line bg-white dark:border-slate-800 dark:bg-slate-900';
export const INSET = 'rounded-xl border border-eos-line dark:border-slate-800';

export function Card({ className = '', children, interactive, ...p }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        SURFACE,
        'shadow-[var(--card-shadow)] transition-[box-shadow,transform,border-color] duration-200 dark:shadow-none',
        interactive && 'cursor-pointer hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:hover:border-brand-500/40',
        className,
      )}
      {...p}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    // `[&+div]:pt-0` takes the top padding off the body that follows, so the header
    // owns the gap between them. It is here rather than on the body because only
    // the header knows it is there: a CardBody used on its own - the identity
    // panel on the profile, and a dozen like it - had no top padding at all, and
    // its content sat on the card's own border.
    <div className="flex flex-col gap-3 px-5 pt-5 pb-3 [&+div]:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export const CardBody = ({ className = '', children }: { className?: string; children: ReactNode }) =>
  // Longhand, not `p-5`: several callers pass `p-0`/`p-2` for a flush table, and
  // the shorthand would fight them on which utility Tailwind happens to emit last.
  <div className={cn('px-5 pt-5 pb-5', className)}>{children}</div>;

/* ----------------------------- Badge ----------------------------- */
type BadgeTone = 'brand' | 'green' | 'teal' | 'amber' | 'rose' | 'slate' | 'violet' | 'info' | 'live';
export function Badge({ tone = 'slate', className = '', children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  const tones: Record<BadgeTone, string> = {
    brand: 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/30',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
    teal: 'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/30',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30',
    slate: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600/40',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
    info: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
    // Broadcast LIVE: solid red with a pulsing ring + blinking dot.
    live: 'bg-[var(--live)] text-white ring-transparent animate-live',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset', tones[tone], className)}>
      {tone === 'live' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}
      {children}
    </span>
  );
}

// Maps a status string to a sensible badge tone. `label` overrides the shown
// text while keeping the tone derived from the real status (e.g. show a fixture's
// 'scheduled' status as "matched" without changing the stored value).
export function StatusBadge({ status, label }: { status?: string | null; label?: ReactNode }) {
  const s = (status ?? '').toLowerCase();
  // Live matches get the broadcast pulse treatment.
  if (s === 'live') return <Badge tone="live">{label ?? 'LIVE'}</Badge>;
  const tone: BadgeTone =
    s === 'completed' ? 'teal'
      // A locked scorecard is the verified, official result - it reads as a
      // confirmation, not as a neutral state, and sits beside roster_locked.
      : ['approved', 'active', 'ongoing', 'roster_locked', 'locked'].includes(s) ? 'green'
      : ['pending', 'forming', 'upcoming', 'submitted', 'scheduled', 'draft'].includes(s) ? 'amber'
        : ['rejected', 'cancelled'].includes(s) ? 'rose'
          : ['registration_open'].includes(s) ? 'brand'
            : 'slate';
  return <Badge tone={tone}>{label ?? (status ? titleCase(status) : '-')}</Badge>;
}

// "Updated HH:MM:SS · ↻ Refresh now" control for auto-refreshing tables (e.g.
// standings). The caller owns the data + interval; this just renders the timestamp
// and a manual refresh button.
export function RefreshBar({ updatedAt, isFetching, onRefresh, cooldownMs = 10000, className = '' }: { updatedAt?: number; isFetching?: boolean; onRefresh: () => void; cooldownMs?: number; className?: string }) {
  const label = updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  // After a manual refresh, lock the button for `cooldownMs` (tick down the remaining
  // seconds) so spectators can't hammer it - the table still auto-refreshes on its own.
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);
  const handleRefresh = () => {
    if (isFetching || cooldown > 0) return;
    onRefresh();
    setCooldown(Math.ceil(cooldownMs / 1000));
  };
  return (
    <div className={cn('flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500', className)}>
      <span>Updated {label}</span>
      <Button size="sm" variant="ghost" disabled={isFetching || cooldown > 0} onClick={handleRefresh}>
        {isFetching ? 'Refreshing…' : cooldown > 0 ? `↻ Wait ${cooldown}s` : '↻ Refresh now'}
      </Button>
    </div>
  );
}

// Color legend for match statuses - reuses StatusBadge so the colors always match
// the badges shown on the schedule, results, timeline and overview. Pass `onSelect`
// to make each badge a toggle filter (clicking the active one clears it).
const MATCH_LEGEND_STATUSES = ['scheduled', 'live', 'completed', 'walkover', 'postponed', 'cancelled'];
export function StatusLegend({ statuses = MATCH_LEGEND_STATUSES, value, onSelect, className = '' }:
  { statuses?: string[]; value?: string; onSelect?: (status: string) => void; className?: string }) {
  const interactive = !!onSelect;
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400', className)}>
      <span className="font-semibold uppercase tracking-wide">{interactive ? 'Filter' : 'Legend'}</span>
      {statuses.map((s) => {
        if (!interactive) return <StatusBadge key={s} status={s} />;
        const active = value === s;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect!(active ? '' : s)}
            className={cn(
              'rounded-full transition focus:outline-none focus:ring-2 focus:ring-brand-400',
              active && 'ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-slate-900',
              value && !active && 'opacity-40 hover:opacity-100',
            )}
          >
            <StatusBadge status={s} />
          </button>
        );
      })}
      {interactive && value && (
        <button type="button" onClick={() => onSelect!('')} className="ml-0.5 underline hover:text-slate-700 dark:hover:text-slate-200">Clear</button>
      )}
    </div>
  );
}

/* ----------------------------- Modal ----------------------------- */
// The modal is capped to the viewport height: the header (and optional `footer`)
// stay pinned while only the body scrolls. Put action buttons in `footer` so they
// never scroll out of view. `size` overrides the default/`wide` width.
// Widths apply from sm up. Below that a modal is a full-width sheet, so a
// `max-w-lg` here would leave a 78px gutter on a 390px phone for no reason.
const MODAL_WIDTHS = { lg: 'sm:max-w-lg', xl: 'sm:max-w-xl', '2xl': 'sm:max-w-2xl', '3xl': 'sm:max-w-3xl', '4xl': 'sm:max-w-4xl' } as const;
export function Modal({ title, onClose, children, footer, wide, size, dismissible = true }:
  { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; size?: keyof typeof MODAL_WIDTHS; dismissible?: boolean }) {
  const maxW = size ? MODAL_WIDTHS[size] : wide ? 'sm:max-w-2xl' : 'sm:max-w-lg';

  // A BOTTOM SHEET ON A PHONE, A DIALOG ON A DESKTOP.
  //
  // This used to centre a `max-w-lg` card at every width with `p-4` around it, so on
  // a 390px screen every dialog in the product was a floating box with ~24px of
  // wasted gutter and its confirm button wherever the body happened to end. Roughly
  // twenty modals inherit from here, so they all changed shape at once rather than
  // twenty times by hand.
  //
  // Three things make it a sheet rather than a narrow dialog: it is anchored to the
  // bottom edge where a thumb is, it is rounded only at the top because the bottom
  // edge IS the screen edge, and `max-h-[92dvh]` uses the dynamic viewport so the
  // browser chrome cannot cover its footer.
  //
  // `useDialog` adds what every overlay here was missing: a focus trap, Escape,
  // focus restoration on close, and a body that cannot scroll behind it.
  //
  // `dismissible={false}` keeps a backdrop click from closing the modal - used for
  // long/batched flows (imports) so a stray outside-click can't discard an in-flight
  // run or its result. The × button still closes it explicitly.
  const ref = useDialog(true, onClose);

  return createPortal(
    <div
      className="animate-backdrop fixed inset-0 z-modal flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'animate-sheet flex max-h-[92dvh] w-full flex-col overflow-hidden bg-white shadow-2xl outline-none dark:bg-slate-900',
          'rounded-t-[22px] sm:rounded-[20px] sm:border sm:border-slate-200 dark:sm:border-slate-800',
          maxW,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden>
          <span className="h-1 w-9 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3 sm:border-b sm:border-slate-200 sm:py-4 dark:sm:border-slate-800">
          <h3 className="t-section min-w-0 dark:text-slate-100">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="tap -m-1 shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {/* Pinned, and clear of the home indicator. A footer that scrolls with the
            body is the reason people could not find Save on a phone. */}
        {footer && (
          <div className="shrink-0 border-t border-slate-200 px-5 py-3.5 pb-safe dark:border-slate-800">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ----------------------------- FilterChips ----------------------------- */
/**
 * The filter row above a list - "Everyone / Awaiting verification / Verified",
 * each with its count.
 *
 * Five screens had grown their own copy of this: the same control with three
 * radii and two ways of drawing an edge (`ring-1` here, `border` there), which
 * is why the same row of filters looked like a different control on each page.
 */
export function FilterChips<T extends string>({ value, onChange, options, className = '' }: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ key: T; label: ReactNode; count?: number }>;
  className?: string;
}) {
  return (
    // A SCROLLING ROW BELOW sm, NOT A WRAPPING GRID.
    // Four chips with counts wrap to two or three rows on a 390px screen, and the
    // wrap moves as the counts change - so the control the reader is aiming at
    // jumps between renders. One row that scrolls keeps the geometry stable and
    // costs nothing: the chips are ordered, so the ones past the edge are the ones
    // least often wanted.
    <div className={cn('snap-row bleed-x mb-4 px-4 pb-1 sm:mx-0 sm:flex sm:flex-wrap sm:gap-2 sm:overflow-visible sm:px-0 sm:pb-0', className)}>
      {options.map((o, i) => {
        const active = o.key === value;
        return (
          <button
            key={o.key || `#${i}`}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            className={cn(
              'flex min-h-[38px] items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors',
              active
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-eos-line bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={cn('font-mono text-[11px]', active ? 'text-white/75' : 'text-slate-400')}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------- Pills ----------------------------- */
// Inline single-select chip group - a friendlier alternative to a <select> when
// the choices are few and worth showing at a glance (e.g. picking a discipline).
export function Pills({ value, onChange, options, ariaLabel }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: ReactNode }[];
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
              active
                ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:bg-brand-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/10',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------- PageHeader ----------------------------- */
export function PageHeader({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    // A 24px title plus a wrapped subtitle plus a row of full-size buttons was
    // ~150px of a 390px screen spent before the page began. Below sm the title
    // drops to 21px (`t-page-title`), the subtitle is held to two lines, and the
    // actions sit on the title's own row where there is almost always space for
    // them - so the content starts above the fold instead of below it.
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2 sm:mb-6 sm:items-end sm:gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="t-page-title text-slate-900 dark:text-slate-100">{title}</h1>
        {subtitle && (
          <p className="t-meta mt-1 line-clamp-2 max-w-prose sm:line-clamp-none">{subtitle}</p>
        )}
      </div>
      {/* `shrink-0` alone let a wide control (the Teams/Individuals segmented switch
          on Achievements) push itself past the right edge of a 390px screen, where
          it was clipped by the viewport with no way to reach the second option.
          `max-w-full` keeps it inside the page and lets it scroll within itself. */}
      {children && (
        <div className="snap-row max-w-full shrink-0 items-center gap-2 sm:flex sm:overflow-visible">{children}</div>
      )}
    </div>
  );
}

/* ----------------------------- StatCard ----------------------------- */
// Blue-gradient stat tile (dashboard design). The value is echoed as a large,
// faint watermark in the corner, mirroring the mockup's `data-bg-number`.
export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-6 text-white shadow-[var(--card-shadow)]"
      style={{ backgroundImage: 'linear-gradient(135deg, var(--stat-grad-from), var(--stat-grad-to))' }}
    >
      <div aria-hidden className="pointer-events-none absolute -bottom-5 -right-2 select-none text-[120px] font-extrabold leading-none tnum opacity-10">{value}</div>
      <div className="relative">
        <div className="text-sm font-medium opacity-90">{label}</div>
        <div className="mt-3 text-4xl font-bold tracking-tight tnum">{value}</div>
        {hint && <div className="mt-1 text-[13px] opacity-80">{hint}</div>}
      </div>
    </div>
  );
}

/* ----------------------------- Avatar ----------------------------- */
export function Avatar({ name, size = 36 }: { name?: string | null; size?: number }) {
  const initials = (name ?? '?')
    .split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  return (
    <span
      className="inline-grid flex-none place-items-center rounded-full bg-brand-100 font-semibold text-brand-700 dark:bg-brand-500/20 dark:text-brand-200"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials}
    </span>
  );
}

/* ----------------------------- Tabs ----------------------------- */
export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: ReactNode; badge?: ReactNode }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-[color,border-color] duration-200 ease-out',
            active === t.id ? 'border-brand-500 text-brand-600 dark:text-brand-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >
          {t.label}{t.badge}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------- Stepper ----------------------------- */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-col gap-4">
      {steps.map((s, i) => {
        const done = i < current, active = i === current;
        return (
          <li key={s} className="flex items-center gap-3">
            <span className={cn(
              'grid h-7 w-7 flex-none place-items-center rounded-full border text-xs font-bold',
              done ? 'border-brand-500 bg-brand-500 text-white'
                : active ? 'border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'border-slate-300 text-slate-400 dark:border-slate-800 dark:text-slate-500',
            )}>{done ? <Check size={13} /> : i + 1}</span>
            <span className={cn('text-sm font-semibold', active ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400')}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ----------------------------- Toggle ----------------------------- */
export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn('relative h-6 w-11 flex-none rounded-full transition-colors', checked ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-600')}
    >
      <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

/* ----------------------------- EmptyState ----------------------------- */
export function EmptyState({ icon = <CircleDashed size={32} />, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-eos-line bg-white px-6 py-14 text-center dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 text-slate-300 dark:text-slate-600">{icon}</div>
      <h3 className="font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ----------------------------- BackButton ----------------------------- */
export function BackButton({
  to, onClick, children, className = '',
}: { to?: string; onClick?: () => void; children: ReactNode; className?: string }) {
  const cls = cn(
    'mb-4 inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-700 dark:hover:text-white',
    className,
  );
  const content = <><ChevronLeft size={15} className="opacity-70" aria-hidden />{children}</>;
  if (to) return <Link to={to} className={cls}>{content}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{content}</button>;
}

/* ----------------------------- ListToolbar ----------------------------- */
export function ListToolbar({ children, className = '', inline = false }: { children: ReactNode; className?: string; inline?: boolean }) {
  return (
    <div className={cn(
      'flex flex-wrap items-center gap-2',
      inline
        ? className
        : cn('mb-4 p-2 shadow-sm', SURFACE, className),
    )}>
      {children}
    </div>
  );
}

export function SortDirButton({ dir, onToggle }: { dir: 'asc' | 'desc'; onToggle: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onToggle}
      title={dir === 'asc' ? 'Sort ascending' : 'Sort descending'}
      aria-label={dir === 'asc' ? 'Sort ascending' : 'Sort descending'}
    >
      {dir === 'asc' ? <><ArrowUp size={13} /> Asc</> : <><ArrowDown size={13} /> Desc</>}
    </Button>
  );
}

/* ----------------------------- SearchInput ----------------------------- */
export function SearchInput({
  value, onChange, placeholder = 'Search…', className = '', autoFocus,
}: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  return (
    <div className={cn('relative shrink-0', className.includes('w-full') ? 'w-full' : '', className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" aria-hidden><Search size={14} /></span>
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(fieldBase, 'w-full pl-8', value && 'pr-8')}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 grid h-5 w-5 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
        ><X size={12} /></button>
      )}
    </div>
  );
}

/* ----------------------------- Segmented control ----------------------------- */
export function Segmented<T extends string>({
  options, value, onChange, size = 'md',
}: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className={cn('inline-flex rounded bg-slate-100 p-0.5 dark:bg-slate-800', size === 'sm' ? 'text-xs' : 'text-sm')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-sm px-3 py-1.5 font-semibold transition-colors',
            value === o.value ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >{o.label}</button>
      ))}
    </div>
  );
}

/* ----------------------------- SortHeader ----------------------------- */
// Clickable <th> that shows/toggles sort direction. Use inside <THead>.
export function SortHeader({
  label, sortKey, active, dir, onSort, className = '',
}: { label: ReactNode; sortKey: string; active: boolean; dir: 'asc' | 'desc'; onSort: (key: string) => void; className?: string }) {
  return (
    <th className={cn('px-4 py-3 font-semibold', className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn('inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200', active && 'text-slate-800 dark:text-slate-200')}
      >
        {label}
        <span className="text-slate-400">{active ? (dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} />}</span>
      </button>
    </th>
  );
}

/* ----------------------------- Pagination ----------------------------- */
export function Pagination({
  page, pageCount, total, pageSize, onPage, className = '',
}: { page: number; pageCount: number; total: number; pageSize: number; onPage: (p: number) => void; className?: string }) {
  if (total === 0) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 pt-3 text-sm', className)}>
      <span className="text-slate-500 dark:text-slate-400">
        Showing <span className="font-semibold text-slate-700 tnum dark:text-slate-300">{from}–{to}</span> of <span className="font-semibold text-slate-700 tnum dark:text-slate-300">{total}</span>
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 0}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >Prev</button>
        <span className="px-2 text-slate-500 tnum dark:text-slate-400">Page {page + 1} / {pageCount}</span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pageCount - 1}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >Next</button>
      </div>
    </div>
  );
}

/* ----------------------------- Spinner ----------------------------- */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500 dark:border-slate-600 dark:border-t-brand-400" />
      {label ?? 'Loading…'}
    </div>
  );
}

/* ----------------------------- Checkbox ----------------------------- */
export function Checkbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => { if (el) el.indeterminate = !!indeterminate && !checked; }}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 cursor-pointer rounded border-slate-300 text-brand-500 focus:ring-brand-400 dark:border-slate-600 dark:bg-slate-800"
    />
  );
}

/* ----------------------------- BulkBar ----------------------------- */
// Sticky action bar shown when one or more rows are selected.
export function BulkBar({ count, children, onClear }: { count: number; children: ReactNode; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-2.5 dark:border-brand-500/30 dark:bg-brand-500/10">
      <span className="text-sm font-semibold text-brand-700 dark:text-brand-300">{count} selected</span>
      <div className="flex items-center gap-2">
        {children}
        <button onClick={onClear} className="text-sm font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">Clear</button>
      </div>
    </div>
  );
}

/* ----------------------------- Table ----------------------------- */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className={cn('overflow-auto', SURFACE)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}
export const THead = ({ children }: { children: ReactNode }) =>
  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">{children}</thead>;
export const TH = ({ children, className = '' }: { children?: ReactNode; className?: string }) =>
  <th className={cn('px-4 py-3 font-semibold', className)}>{children}</th>;
export const TR = ({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) =>
  <tr className={cn('border-t border-slate-100 dark:border-slate-800', onClick && 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50', className)} onClick={onClick}>{children}</tr>;
export const TD = ({ children, className = '' }: { children?: ReactNode; className?: string }) =>
  <td className={cn('px-4 py-3 align-middle', className)}>{children}</td>;

/* ----------------------------- Progress ----------------------------- */
type ProgressTone = 'brand' | 'green' | 'amber' | 'rose' | 'slate';
const PROGRESS_FILL: Record<ProgressTone, string> = {
  brand: 'bg-brand-500', green: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500', slate: 'bg-slate-400',
};

// Linear progress bar. Pass `label` to show a name + percentage row above it.
export function Progress({
  value, max = 100, tone = 'brand', label, className = '',
}: { value: number; max?: number; tone?: ProgressTone; label?: ReactNode; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={className}>
      {label != null && (
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
          <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-100">{Math.round(pct)}%</span>
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('h-full rounded-full transition-[width] duration-500', PROGRESS_FILL[tone])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Segmented step progress (e.g. "3 / 5 steps"). Filled segments use the brand colour.
export function ProgressSteps({ total, current, label, className = '' }: { total: number; current: number; label?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {label != null && (
        <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>{label}</span>
          <span className="font-semibold text-brand-600 dark:text-brand-300">{current} / {total} steps</span>
        </div>
      )}
      <div className="flex gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} className={cn('h-1.5 flex-1 rounded-full', i < current ? 'bg-brand-500' : 'bg-slate-200 dark:bg-slate-800')} />
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- Skeleton ----------------------------- */
// Shimmer placeholder. Size/shape via className, e.g. <Skeleton className="h-3 w-1/2" />.
export function Skeleton({ className = '', rounded = 'rounded-md' }: { className?: string; rounded?: string }) {
  return <div className={cn('skeleton', rounded, className)} aria-hidden />;
}

/* ----------------------------- Toast ----------------------------- */
export type ToastType = 'success' | 'info' | 'warning' | 'error';
interface ToastItem { id: number; type: ToastType; title: string; message?: string }

const TOAST_META: Record<ToastType, { icon: ReactNode; chip: string }> = {
  success: { icon: <Check size={13} />, chip: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400' },
  info: { icon: <Info size={13} />, chip: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300' },
  warning: { icon: <AlertTriangle size={13} />, chip: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400' },
  error: { icon: <X size={13} />, chip: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400' },
};

// Presentational toast. Full border + small colored icon chip encodes the type.
export function Toast({ type, title, message, onClose }: { type: ToastType; title: string; message?: string; onClose?: () => void }) {
  const m = TOAST_META[type];
  return (
    <div className={cn('flex items-start gap-3 px-3.5 py-3 shadow-md', SURFACE)} role="status">
      <span className={cn('mt-0.5 flex-none rounded-sm p-1', m.chip)} aria-hidden>{m.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</div>
        {message && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{message}</div>}
      </div>
      {onClose && (
        <button onClick={onClose} aria-label="Dismiss" className="flex-none text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={14} /></button>
      )}
    </div>
  );
}

interface ToastApi { push: (toast: { type?: ToastType; title: string; message?: string }) => void }
const ToastContext = createContext<ToastApi | null>(null);

// Hook to fire toasts from anywhere under <ToastProvider>.
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

// Module-level emitter so non-hook code (mutation callbacks, helpers) can fire
// toasts via `toast.error(...)` - registered by the mounted ToastProvider.
let emit: ToastApi['push'] | null = null;
export const toast = {
  show: (t: { type?: ToastType; title: string; message?: string }) => emit?.(t),
  success: (title: string, message?: string) => emit?.({ type: 'success', title, message }),
  error: (title?: string, message?: string) => emit?.({ type: 'error', title: title || 'Something went wrong', message }),
  info: (title: string, message?: string) => emit?.({ type: 'info', title, message }),
  warning: (title: string, message?: string) => emit?.({ type: 'warning', title, message }),
};

// Provides the toast API and renders the bottom-right stack. Auto-dismiss after 5s.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const remove = useCallback((id: number) => setToasts((s) => s.filter((t) => t.id !== id)), []);
  const push = useCallback<ToastApi['push']>((t) => {
    const id = Date.now() + Math.random();
    setToasts((s) => [...s, { id, type: t.type ?? 'info', title: t.title, message: t.message }]);
    setTimeout(() => remove(id), 5000);
  }, [remove]);

  // Expose the emitter to module-level `toast.*` helpers.
  useEffect(() => { emit = push; return () => { if (emit === push) emit = null; }; }, [push]);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[600] flex w-[min(92vw,360px)] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto animate-fade-up">
            <Toast type={t.type} title={t.title} message={t.message} onClose={() => remove(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ----------------------------- Confirm dialog ----------------------------- */
// In-app replacement for window.confirm. Call `confirmDialog(...)` from anywhere and
// await the boolean - a string arg is treated as the message. Mirrors the `toast`
// pattern: a module-level emitter registered by the mounted <ConfirmProvider>. Falls
// back to window.confirm if the provider isn't mounted (e.g. in tests).
export interface ConfirmOptions {
  title?: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
}
let confirmEmit: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;
export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  const o = typeof opts === 'string' ? { message: opts } : opts;
  if (confirmEmit) return confirmEmit(o);
  return Promise.resolve(window.confirm(typeof o.message === 'string' ? o.message : o.title ?? 'Are you sure?'));
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
  const ask = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ opts, resolve })), []);
  useEffect(() => { confirmEmit = ask; return () => { if (confirmEmit === ask) confirmEmit = null; }; }, [ask]);

  const settle = (value: boolean) => { state?.resolve(value); setState(null); };
  const o = state?.opts;
  const tone = o?.tone ?? 'danger';

  return (
    <>
      {children}
      {state && o && (
        <Modal
          title={o.title ?? 'Are you sure?'}
          onClose={() => settle(false)}
          footer={(
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => settle(false)}>{o.cancelLabel ?? 'Cancel'}</Button>
              <Button variant={tone} onClick={() => settle(true)} autoFocus>{o.confirmLabel ?? 'Confirm'}</Button>
            </div>
          )}
        >
          <div className="text-sm text-slate-600 dark:text-slate-300">{o.message ?? 'This action cannot be undone.'}</div>
        </Modal>
      )}
    </>
  );
}
