import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from './ui';

export interface PickOption {
  value: string; label: string;
  /** Muted text after the label. */
  hint?: string;
  /** Options sharing a group sit under one heading, in the order given. */
  group?: string;
  icon?: ReactNode;
  /** Shown but not pickable (e.g. a format the plan does not include). */
  disabled?: boolean;
}

/** Show a search box once the list is this long. */
const SEARCH_FROM = 8;

/**
 * A styled single-select in place of a native <select>: a field-like button and a
 * card of options, with search for long lists, headings and keyboard control.
 * The list is portalled to <body>: cards clip overflow and the page-enter animation
 * leaves a transform, either of which would cut off or misplace it.
 */
export function PickList({ value, onChange, options, placeholder = 'Choose…', searchPlaceholder = 'Search', ariaLabel, className }: {
  value: string; onChange: (v: string) => void; options: PickOption[];
  placeholder?: string; searchPlaceholder?: string; ariaLabel?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const searchable = options.length >= SEARCH_FROM;

  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => `${o.label} ${o.group ?? ''} ${o.hint ?? ''}`.toLowerCase().includes(needle)) : options;

  // Below the button, or above it when there is clearly more room there.
  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 240 && above > below;
    const width = Math.max(r.width, 220);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    setPos(up ? { left, width, bottom: window.innerHeight - r.top + 6, maxH: Math.min(340, above) }
      : { left, width, top: r.bottom + 6, maxH: Math.min(340, below) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, place]);

  // Opening starts on the current choice; typing restarts at the first match.
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, shown.findIndex((o) => o.value === value)));
    requestAnimationFrame(() => (searchable ? search.current : list.current)?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { if (open) setActive(0); }, [q, open]);
  useEffect(() => { list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const close = (refocus = true) => { setOpen(false); setQ(''); if (refocus) btn.current?.focus(); };

  // Any press outside the list or its button closes it. A listener, not a scrim:
  // the app sidebar stacks above a scrim, so clicks there slipped past it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!pop.current?.contains(n) && !btn.current?.contains(n)) { setOpen(false); setQ(''); }
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);
  const pick = (o: PickOption) => { if (o.disabled) return; onChange(o.value); close(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close(false);
  };

  return (
    <>
      <button ref={btn} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); } }}
        className={cn('flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border bg-white px-3 text-left text-sm shadow-sm transition focus:outline-none focus-visible:border-brand-500 focus-visible:ring-[3px] focus-visible:ring-brand-500/20 dark:bg-slate-800',
          open ? 'border-brand-500 ring-[3px] ring-brand-500/20' : 'border-slate-200 hover:border-brand-300 dark:border-slate-700 dark:hover:border-brand-500/50', className)}>
        {selected?.icon && <span className="grid shrink-0 place-items-center" aria-hidden>{selected.icon}</span>}
        <span className={cn('min-w-0 flex-1 truncate', selected ? 'font-medium text-slate-800 dark:text-slate-100' : 'text-slate-400')}>
          {selected ? (selected.group ? `${selected.group} · ${selected.label}` : selected.label) : placeholder}
        </span>
        <ChevronDown size={15} className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>

      {open && pos && createPortal(
          <div ref={pop} className="animate-dropdown fixed z-popover flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
            style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}>
            {searchable && (
              <div className="flex items-center gap-2 border-b border-slate-100 px-3 dark:border-slate-800">
                <Search size={14} className="shrink-0 text-slate-400" aria-hidden />
                <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder} className="h-10 w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100" />
              </div>
            )}
            <ul ref={list} role="listbox" tabIndex={-1} onKeyDown={onKey} aria-label={ariaLabel} className="min-h-0 flex-1 overflow-y-auto p-1 outline-none">
              {shown.length === 0 && <li className="px-3 py-6 text-center text-xs text-slate-400">{needle ? 'No matches' : 'Nothing to choose yet'}</li>}
              {shown.map((o, i) => {
                const heading = o.group && o.group !== shown[i - 1]?.group;
                const isSel = o.value === value;
                return (
                  <li key={o.value || '__none'} role="presentation">
                    {heading && <div className={cn('px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400', i === 0 ? 'pt-1.5' : 'pt-3')}>{o.group}</div>}
                    <div role="option" aria-selected={isSel} data-i={i}
                      onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}
                      aria-disabled={o.disabled || undefined}
                      className={cn('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm', o.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                        i === active ? 'bg-slate-100 dark:bg-slate-800' : '',
                        isSel ? 'font-semibold text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-200')}>
                      {o.icon && <span className="grid w-6 shrink-0 place-items-center" aria-hidden>{o.icon}</span>}
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {o.hint && <span className="shrink-0 text-xs text-slate-400">{o.hint}</span>}
                      {isSel && <Check size={15} className="shrink-0" aria-hidden />}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>,
        document.body,
      )}
    </>
  );
}
