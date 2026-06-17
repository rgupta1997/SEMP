import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type {
  ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode,
  SelectHTMLAttributes, TextareaHTMLAttributes,
} from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, ChevronLeft, Info, X } from 'lucide-react';

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
    primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm',
    ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
    outline: 'border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm',
    subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300 dark:hover:bg-brand-500/25',
  };
  const sizes: Record<ButtonSize, string> = {
    sm: 'px-2.5 py-1.5 text-xs rounded-lg gap-1.5',
    md: 'px-3.5 py-2 text-sm rounded-lg gap-2',
    lg: 'px-5 py-2.5 text-base rounded-xl gap-2',
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
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 transition-[border-color,box-shadow] focus:outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/20 disabled:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-900';

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
      <span className="pointer-championships-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 dark:text-slate-500" aria-hidden>▾</span>
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
export function Card({ className = '', children, interactive, ...p }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-200 bg-white shadow-sm transition-[box-shadow,transform,border-color] duration-200 dark:border-slate-800 dark:bg-slate-900',
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
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
      <div>
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export const CardBody = ({ className = '', children }: { className?: string; children: ReactNode }) =>
  <div className={cn('px-5 pb-5', className)}>{children}</div>;

/* ----------------------------- Badge ----------------------------- */
type BadgeTone = 'brand' | 'green' | 'amber' | 'rose' | 'slate' | 'violet' | 'info' | 'live';
export function Badge({ tone = 'slate', className = '', children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  const tones: Record<BadgeTone, string> = {
    brand: 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/30',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30',
    slate: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600/40',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
    info: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
    // Broadcast LIVE: solid red with a pulsing ring + blinking dot.
    live: 'bg-[var(--live)] text-white ring-transparent animate-live',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', tones[tone], className)}>
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
    ['approved', 'completed', 'active', 'ongoing', 'roster_locked'].includes(s) ? 'green'
    : ['pending', 'forming', 'upcoming', 'submitted', 'scheduled', 'draft'].includes(s) ? 'amber'
    : ['rejected', 'cancelled'].includes(s) ? 'rose'
    : ['registration_open'].includes(s) ? 'brand'
    : 'slate';
  return <Badge tone={tone}>{label ?? (status ?? '—').replace(/_/g, ' ')}</Badge>;
}

/* ----------------------------- Modal ----------------------------- */
// The modal is capped to the viewport height: the header (and optional `footer`)
// stay pinned while only the body scrolls. Put action buttons in `footer` so they
// never scroll out of view. `size` overrides the default/`wide` width.
const MODAL_WIDTHS = { lg: 'max-w-lg', xl: 'max-w-xl', '2xl': 'max-w-2xl', '3xl': 'max-w-3xl', '4xl': 'max-w-4xl' } as const;
export function Modal({ title, onClose, children, footer, wide, size }:
  { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; size?: keyof typeof MODAL_WIDTHS }) {
  const maxW = size ? MODAL_WIDTHS[size] : wide ? 'max-w-2xl' : 'max-w-lg';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-900/50 p-4 sm:p-6 backdrop-blur-sm" onClick={onClose}>
      <div className={cn('mt-10 flex max-h-[calc(100vh-5rem)] w-full flex-col animate-fade-up rounded-[20px] border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900', maxW)} onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <h3 className="text-lg font-semibold dark:text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="shrink-0 border-t border-slate-200 px-5 py-4 dark:border-slate-700">{footer}</div>}
      </div>
    </div>
  );
}

/* ----------------------------- Pills ----------------------------- */
// Inline single-select chip group — a friendlier alternative to a <select> when
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
                ? 'border-brand-500 bg-brand-500 text-white shadow-sm'
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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

/* ----------------------------- StatCard ----------------------------- */
export function StatCard({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className={cn('rounded-2xl border p-4', accent ? 'border-brand-200 bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900')}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={cn('mt-1 text-3xl font-extrabold tracking-tight tnum', accent ? 'text-brand-600 dark:text-brand-300' : 'text-slate-900 dark:text-slate-100')}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
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
            '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors',
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
              : 'border-slate-300 text-slate-400 dark:border-slate-700 dark:text-slate-500',
            )}>{done ? '✓' : i + 1}</span>
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
export function EmptyState({ icon = '◎', title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-slate-100 text-2xl text-slate-400 dark:bg-slate-800 dark:text-slate-500">{icon}</div>
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
    'mb-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-700 dark:hover:text-white',
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
        : cn('mb-4 rounded-xl border border-slate-200/80 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900', className),
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
      {dir === 'asc' ? '↑ Asc' : '↓ Desc'}
    </Button>
  );
}

/* ----------------------------- SearchInput ----------------------------- */
export function SearchInput({
  value, onChange, placeholder = 'Search…', className = '', autoFocus,
}: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  return (
    <div className={cn('relative shrink-0', className.includes('w-full') ? 'w-full' : '', className)}>
      <span className="pointer-championships-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" aria-hidden>⌕</span>
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
        >×</button>
      )}
    </div>
  );
}

/* ----------------------------- Segmented control ----------------------------- */
export function Segmented<T extends string>({
  options, value, onChange, size = 'md',
}: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className={cn('inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800', size === 'sm' ? 'text-xs' : 'text-sm')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-3 py-1.5 font-semibold transition-colors',
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
        <span className="text-[10px] text-slate-400">{active ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
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
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >Prev</button>
        <span className="px-2 text-slate-500 tnum dark:text-slate-400">Page {page + 1} / {pageCount}</span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pageCount - 1}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
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
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 dark:border-brand-500/30 dark:bg-brand-500/10">
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
    <div className="overflow-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
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

const TOAST_META: Record<ToastType, { icon: ReactNode; bar: string; text: string }> = {
  success: { icon: <Check size={14} />,          bar: 'border-l-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  info:    { icon: <Info size={14} />,           bar: 'border-l-brand-500',   text: 'text-brand-600 dark:text-brand-300' },
  warning: { icon: <AlertTriangle size={14} />,  bar: 'border-l-amber-500',   text: 'text-amber-600 dark:text-amber-400' },
  error:   { icon: <X size={14} />,             bar: 'border-l-rose-600',    text: 'text-rose-600 dark:text-rose-400' },
};

// Presentational toast (also used standalone). Left accent bar encodes the type.
export function Toast({ type, title, message, onClose }: { type: ToastType; title: string; message?: string; onClose?: () => void }) {
  const m = TOAST_META[type];
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border-l-4 bg-white px-3.5 py-3 shadow-md dark:bg-slate-900', m.bar)} role="status">
      <span className={cn('mt-0.5 flex-none text-sm', m.text)} aria-hidden>{m.icon}</span>
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
// toasts via `toast.error(...)` — registered by the mounted ToastProvider.
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
      <div className="pointer-championships-none fixed bottom-4 right-4 z-[600] flex w-[min(92vw,360px)] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-championships-auto animate-fade-up">
            <Toast type={t.type} title={t.title} message={t.message} onClose={() => remove(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ----------------------------- Confirm dialog ----------------------------- */
// In-app replacement for window.confirm. Call `confirmDialog(...)` from anywhere and
// await the boolean — a string arg is treated as the message. Mirrors the `toast`
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
