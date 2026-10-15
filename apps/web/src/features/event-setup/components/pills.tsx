import type { ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { SetupEventType } from '@semp/shared';
import { Badge, cn } from '../../../components/ui';
import { statusMeta, TYPE_SHORT } from '../status';
import type { IssueCounts } from '../types';

/** Keyboard focus that is visible on every custom control on these pages. */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900';

export function StatusPill({ status }: { status: string }) {
  const m = statusMeta(status);
  return (
    <Badge tone={m.tone} className="whitespace-nowrap">
      {status === 'applying' && <LoaderCircle size={12} className="animate-spin" aria-hidden />}
      {m.label}
    </Badge>
  );
}

export function TypeChip({ type }: { type: SetupEventType }) {
  return (
    <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {TYPE_SHORT[type] ?? type}
    </span>
  );
}

/** "3 errors · 5 warnings", or a quiet "Clean" when the workbook had none. */
export function IssueBadges({ counts, validated }: { counts: IssueCounts | null | undefined; validated: boolean }) {
  if (!validated || !counts) return <span className="text-slate-400 dark:text-slate-500">-</span>;
  if (!counts.error && !counts.warning) return <Badge tone="green">Clean</Badge>;
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {counts.error > 0 && <Badge tone="rose">{counts.error.toLocaleString()} {counts.error === 1 ? 'error' : 'errors'}</Badge>}
      {counts.warning > 0 && <Badge tone="amber">{counts.warning.toLocaleString()} {counts.warning === 1 ? 'warning' : 'warnings'}</Badge>}
    </span>
  );
}

/** A small figure with a label, for the dense summary grids. */
export function Tile({ label, value, hint, tone }: {
  label: string; value: ReactNode; hint?: ReactNode; tone?: 'amber' | 'rose' | 'green';
}) {
  return (
    <div className="rounded-xl border border-eos-line bg-white px-3.5 py-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="t-eyebrow truncate">{label}</div>
      <div className={cn(
        't-num mt-1 text-[22px] font-bold leading-none tracking-tight',
        tone === 'amber' ? 'text-amber-600 dark:text-amber-400'
          : tone === 'rose' ? 'text-rose-600 dark:text-rose-400'
            : tone === 'green' ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-slate-900 dark:text-slate-100',
      )}>{value}</div>
      {hint && <div className="t-meta mt-1 truncate">{hint}</div>}
    </div>
  );
}

/** A coloured note across the width of a section: what is true, and what to do. */
export function Banner({ tone, icon, title, children, action }: {
  tone: 'green' | 'amber' | 'rose' | 'info' | 'slate';
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
    amber: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
    rose: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200',
    info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200',
    slate: 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200',
  }[tone];
  return (
    <div role={tone === 'rose' ? 'alert' : 'status'} className={cn('flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-start sm:p-4', tones)}>
      <div className="flex min-w-0 flex-1 gap-3">
        {icon && <span className="mt-0.5 shrink-0" aria-hidden>{icon}</span>}
        <div className="min-w-0">
          <div className="text-[15px] font-bold leading-snug">{title}</div>
          {children && <div className="mt-1 text-[13.5px] leading-relaxed opacity-90">{children}</div>}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
}
