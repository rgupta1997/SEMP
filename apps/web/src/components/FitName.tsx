import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from './ui';

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

/**
 * A team name that fits its box: the full name when there is room, the short code
 * when there is not (and "…" if even that is too long). The full name is always the
 * tooltip. Re-measured whenever the box resizes - a phone rotating, a panel opening.
 */
export function FitName({ full, short, prefix = '', className, sub, fullBelow = false, belowClassName = 'text-[9px]', align = 'center', forceShort = false, onFitChange }: {
  full: string; short?: string | null; prefix?: string; className?: string;
  /** Show the short code even though the full name fits - so two names in one row match. */
  forceShort?: boolean;
  /** Told whether the full name fits, so a row can switch both of its names together. */
  onFitChange?: (fits: boolean) => void;
  /** Size of the second line - always smaller than the line above it. */
  belowClassName?: string;
  /** A tiny second line, e.g. "no player". */
  sub?: string;
  /** When the short code is shown, repeat the full name tiny on the second line. */
  fullBelow?: boolean;
  align?: keyof typeof ALIGN;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // The box spans its container (w-full), so its width is the space available -
    // sized to its text, it shrank to the code and the full name could never come back.
    // 1px slack: sub-pixel rounding alone was enough to call a fitting name too wide.
    const check = () => setFits(!probe.current
      || probe.current.getBoundingClientRect().width <= el.getBoundingClientRect().width + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    // Re-measure once web fonts arrive: measured in the narrower fallback font, a name
    // "fitted" and was then cut with "…" when the real font loaded.
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    let live = true;
    fonts?.ready.then(() => { if (live) check(); });
    fonts?.addEventListener?.('loadingdone', check);
    return () => { live = false; ro.disconnect(); fonts?.removeEventListener?.('loadingdone', check); };
  }, [full, prefix]);
  useEffect(() => { onFitChange?.(fits); }, [fits]); // eslint-disable-line react-hooks/exhaustive-deps
  const shortened = (forceShort || !fits) && !!short && short !== full;
  const below = [shortened && fullBelow ? full : null, sub].filter(Boolean).join(' · ');
  return (
    <>
      <span ref={box} title={`${prefix}${full}`} className={cn('relative block w-full truncate', ALIGN[align], className)}>
        {prefix}{shortened ? short : full}
        {/* Invisible copy of the full text, measured at its natural width. */}
        <span ref={probe} aria-hidden className="invisible absolute left-0 top-0 whitespace-nowrap">{prefix}{full}</span>
      </span>
      {below && <span className={cn('block w-full truncate font-normal leading-tight opacity-70', ALIGN[align], belowClassName)}>{below}</span>}
    </>
  );
}
