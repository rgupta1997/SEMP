import { JERSEY_NUMBER_MAX, JERSEY_NUMBER_MIN } from '@semp/shared';
import { cn } from '../../components/ui';

// One shirt outline for every shirt number on screen: the console chips and the team sheet.
const JERSEY_PATH = 'M7.5 1 3 3 .5 7.5 4 9.6 5 8.4V19h14V8.4l1 1.2 3.5-2.1L21 3l-4.5-2c-.9 2-2.4 3-4.5 3s-3.6-1-4.5-3Z';

/** "#10 Aarav" -> number and name; null number when the label has none. */
export function splitJersey(label: string): { num: string | null; name: string } {
  const m = /^#(\d+)\s+(.*)$/.exec(label);
  return m ? { num: m[1], name: m[2] } : { num: null, name: label };
}

/** The shirt number as a jersey, before a name. `on` = sits on a selected (brand) chip; `md` for headers. */
export function JerseyBadge({ num, on = false, size = 'sm', title }: { num: string | number; on?: boolean; size?: 'sm' | 'md'; title?: string }) {
  num = String(num);
  const wide = num.length > 2;
  return (
    <span className={cn('relative inline-block shrink-0',
      size === 'md' ? (wide ? 'h-[26px] w-[40px]' : 'h-[26px] w-[32px]') : (wide ? 'h-[19px] w-[30px]' : 'h-[19px] w-[24px]'))}
      aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title ? `${title} ${num}` : undefined} title={title}
      data-qa="jersey-badge">
      <svg viewBox="0 0 24 20" preserveAspectRatio="none" className={cn('absolute inset-0 h-full w-full',
        on ? 'fill-white' : 'fill-slate-700 dark:fill-slate-300')}>
        <path d={JERSEY_PATH} />
      </svg>
      {/* On the chest, below the collar - not centred on the whole shirt. */}
      <span className={cn('absolute inset-x-0 grid place-items-center font-mono font-bold leading-none tabular-nums',
        size === 'md' ? 'bottom-[3px] top-[8px]' : 'bottom-[2px] top-[6px]',
        size === 'md' ? (wide ? 'text-[10px]' : 'text-[11.5px]') : (wide ? 'text-[7.5px]' : 'text-[9px]'),
        on ? 'text-brand-700' : 'text-white dark:text-slate-900')}>{num}</span>
    </span>
  );
}

/**
 * A jersey the scorer types the number onto. Empty: an outlined shirt with a faint "#";
 * numbered: a filled shirt. The input covers the whole shirt, so any tap on it edits.
 */
export function JerseyInput({ value, onChange, label, title, disabled }: {
  value: number | null | undefined;
  onChange: (raw: string) => void;
  /** Accessible name, e.g. "Shirt number for Aarav in this match". */
  label: string;
  title?: string;
  disabled?: boolean;
}) {
  const filled = value != null;
  return (
    <span className="group relative inline-grid h-8 w-10 flex-none place-items-center" title={title}>
      <svg viewBox="0 0 24 20" aria-hidden
        className={cn('absolute inset-0 h-full w-full transition-colors',
          filled
            ? 'fill-slate-800 stroke-slate-800 dark:fill-slate-200 dark:stroke-slate-200'
            : 'fill-transparent stroke-slate-400 dark:stroke-slate-500',
          'group-focus-within:fill-brand-600 group-focus-within:stroke-brand-600 dark:group-focus-within:fill-brand-500 dark:group-focus-within:stroke-brand-500')}
        strokeWidth={1.2} strokeLinejoin="round">
        <path d={JERSEY_PATH} />
      </svg>
      <input
        type="number" inputMode="numeric" min={JERSEY_NUMBER_MIN} max={JERSEY_NUMBER_MAX}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="#"
        aria-label={label}
        data-qa="sheet-jersey"
        // Sits on the chest, below the collar; spinners hidden so three digits fit.
        className={cn('relative z-10 mt-1 w-full bg-transparent text-center font-mono text-[10.5px] font-bold tabular-nums outline-none',
          '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          'placeholder:font-semibold placeholder:text-slate-400 dark:placeholder:text-slate-500',
          filled ? 'text-white dark:text-slate-900' : 'text-slate-700 dark:text-slate-200',
          'group-focus-within:text-white group-focus-within:placeholder:text-white/70',
          'disabled:cursor-not-allowed')}
      />
    </span>
  );
}
