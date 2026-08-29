import { useEffect, useRef } from 'react';

/* ============================================================================
   useDialog - what every overlay in the app was missing
   ============================================================================
   The sidebar drawer, the notification drawer and the Modal primitive each failed
   the same four checks: no focus trap, no Escape, no focus restore, and the page
   behind stayed in the tab order and readable by a screen reader. Fixed once here
   and used by every overlay, rather than four times badly.
   ========================================================================== */

export function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;

    // The body must not scroll behind a sheet. Padding compensates for the
    // scrollbar so the page does not jump sideways as it locks on desktop.
    const gap = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPad = document.body.style.paddingRight;
    document.body.style.overflow = 'hidden';
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;

    // Focus the first thing worth focusing, not the container - a sheet that
    // opens with the panel focused reads as "dialog" and then says nothing.
    const t = window.setTimeout(() => {
      const first = ref.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (first ?? ref.current)?.focus();
    }, 40);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const focusable = [...ref.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // Wrap, so Tab can never reach the page behind the dialog.
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPad;
      window.clearTimeout(t);
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  return ref;
}

