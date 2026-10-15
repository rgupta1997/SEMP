import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from './ui';

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

/**
 * A team name that fits its box: the full name when there is room, the short code
 * when there is not (and "…" if even that is too long). The full name is always the
 * tooltip. Re-measured whenever the box resizes - a phone rotating, a panel opening.
 */
export function FitName({ full, short, prefix = '', className, sub, fullBelow = false, belowClassName = 'text-[9px]', align = 'center' }: {
  full: string; short?: string | null; prefix?: string; className?: string;
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
    return () => ro.disconnect();
  }, [full, prefix]);
  const shortened = !fits && !!short && short !== full;
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
