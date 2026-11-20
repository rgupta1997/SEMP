import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp } from 'lucide-react';
import { cn } from './ui';

/** How far down (px) before the button appears. */
const SHOW_AFTER = 600;

/**
 * A floating "Back to top" button for long pages. The app scrolls inside <main>,
 * not the window, so it watches the nearest scrolling ancestor.
 */
export function BackToTop() {
  const anchor = useRef<HTMLSpanElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let el: HTMLElement | null = anchor.current?.parentElement ?? null;
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    setScroller(el);
  }, []);

  useEffect(() => {
    const target: HTMLElement | Window = scroller ?? window;
    const read = () => setShow((scroller ? scroller.scrollTop : window.scrollY) > SHOW_AFTER);
    read();
    target.addEventListener('scroll', read, { passive: true });
    return () => target.removeEventListener('scroll', read);
  }, [scroller]);

  return (
    <>
      <span ref={anchor} hidden />
      {/* Portalled to <body>: the page-enter animation leaves a transform on the page
          wrapper, which would pin a "fixed" button to the page bottom instead of the screen. */}
      {createPortal(<button
        type="button"
        onClick={() => (scroller ?? window).scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Back to top"
        className={cn(
          // Phone: clear of the bottom nav bar.
          'fixed bottom-20 right-4 z-30 flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/25 transition-all duration-200 hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 md:bottom-6 md:right-6',
          show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
        )}
      >
        <ArrowUp size={16} aria-hidden />
        <span>Back to top</span>
      </button>, document.body)}
    </>
  );
}
