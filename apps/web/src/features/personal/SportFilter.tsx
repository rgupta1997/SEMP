import { useMemo } from 'react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { cn } from '../../components/ui';
import { SportChips } from '../schedule/ScheduleParts';

const FALLBACK_ICON = '🏅';

/** The sport catalogue's emoji by name, for lists that only carry sport names. */
export function useSportIcon() {
  const { data: catalogue = [] } = useApi<Array<{ name: string; icon?: string | null }>>('/sports');
  return useMemo(() => {
    const m = new Map(catalogue.map((s) => [s.name.toLowerCase(), s.icon || FALLBACK_ICON]));
    return (sport: string | null | undefined) => (sport ? m.get(sport.toLowerCase()) ?? FALLBACK_ICON : FALLBACK_ICON);
  }, [catalogue]);
}

/** One chip per sport across the given lists, counting the items that run it. */
export function useSportOptions(lists: Array<string[] | undefined>, iconOf: (s: string) => string) {
  return useMemo(() => {
    const count = new Map<string, number>();
    for (const l of lists) for (const s of l ?? []) count.set(s, (count.get(s) ?? 0) + 1);
    return [...count].sort(([a], [b]) => a.localeCompare(b)).map(([name, total]) => ({ id: name, name, icon: iconOf(name), live: 0, total }));
  }, [lists, iconOf]);
}

/** The pill that folds the sport chips away; shows how many are picked. */
export function SportFilterButton({ open, picked, onToggle, controls, accent = 'teal' }: {
  open: boolean; picked: number; onToggle: () => void; controls: string; accent?: 'teal' | 'brand';
}) {
  const on = open || picked > 0;
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={controls}
      className={cn('inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold shadow-sm transition',
        on ? (accent === 'teal' ? 'border-[var(--accent-deep)]/40 bg-[var(--accent)]/15 text-[var(--accent-deep)] dark:text-[var(--accent)]' : 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-200')
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200')}>
      <SlidersHorizontal size={14} aria-hidden />Sports
      {picked > 0 && <span className={cn('grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-black text-white', accent === 'teal' ? 'bg-[var(--accent-deep)]' : 'bg-brand-600')}>{picked}</span>}
      <ChevronDown size={14} className={cn('transition', open && 'rotate-180')} aria-hidden />
    </button>
  );
}

/** The opened panel: chips wrap instead of scrolling sideways; capped and scrolling on phones. */
export function SportFilterPanel({ id, sports, value, onChange, allTotal }: {
  id: string; sports: Parameters<typeof SportChips>[0]['sports']; value: string[]; onChange: (v: string[]) => void; allTotal: number;
}) {
  return (
    <div id={id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm max-sm:max-h-64 max-sm:overflow-y-auto dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
          {value.length ? `${value.length} sport${value.length === 1 ? '' : 's'} selected` : 'Filter by sport'}
        </span>
        {value.length > 0 && (
          <button type="button" onClick={() => onChange([])}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-50 dark:text-rose-300 dark:ring-rose-500/30 dark:hover:bg-rose-500/10">
            <X size={12} aria-hidden />Clear
          </button>
        )}
      </div>
      <SportChips wrap sports={sports} value={value} onChange={onChange} allTotal={allTotal} />
    </div>
  );
}
