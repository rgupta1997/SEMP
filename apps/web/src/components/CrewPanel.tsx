import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { EmptyState, SearchInput, cn } from './ui';
import { HEAD_ROW } from './GroupTables';

/** The organising team's card: tabs and tools on top, rows, a quiet note under them. */
export function CrewPanel({ tabs, search, onSearch, searchPlaceholder, action, note, children }: {
  tabs: ReactNode; search?: string; onSearch?: (v: string) => void; searchPlaceholder?: string;
  action?: ReactNode; note?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2.5 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        {tabs}
        <div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto">
          {onSearch && <SearchInput pill value={search ?? ''} onChange={onSearch} placeholder={searchPlaceholder} className="min-w-0 flex-1 sm:w-64 sm:flex-none" />}
          {action}
        </div>
      </header>
      {children}
      {note && <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] leading-relaxed text-slate-400 dark:border-slate-800">{note}</p>}
    </section>
  );
}

/** Column headings, desktop only; shares its grid with the rows. */
export function CrewHead({ grid, cols }: { grid: string; cols: string[] }) {
  return (
    <div className={cn('hidden items-center gap-x-4 px-4 py-2 lg:grid', HEAD_ROW)} style={{ gridTemplateColumns: grid }}>
      {cols.map((c, i) => <span key={i} className={i === cols.length - 1 ? 'text-right' : undefined}>{c}</span>)}
    </div>
  );
}

/** A round icon button for row actions. */
export function IconAction({ icon: Icon, label, onClick, disabled, title, danger }: {
  icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; title?: string; danger?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={title ?? label}
      className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-40',
        danger ? 'hover:bg-rose-50 hover:text-rose-600 disabled:hover:bg-transparent disabled:hover:text-slate-400 dark:hover:bg-rose-500/10'
          : 'hover:bg-brand-50 hover:text-brand-700 disabled:hover:bg-transparent disabled:hover:text-slate-400 dark:hover:bg-brand-500/15 dark:hover:text-brand-300')}>
      <Icon size={15} aria-hidden />
    </button>
  );
}

export function Contact({ email, phone }: { email?: string | null; phone?: string | null }) {
  return (
    <span className="block min-w-0">
      <span className="block truncate text-sm text-slate-600 dark:text-slate-300" title={email ?? undefined}>{email || '-'}</span>
      {phone && <span className="block truncate text-xs text-slate-400">{phone}</span>}
    </span>
  );
}

/** Nothing in the list yet (or nothing matching). */
export function CrewEmpty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <EmptyState bare icon={icon} title={title} description={text} action={action} />;
}
