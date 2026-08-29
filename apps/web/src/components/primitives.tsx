import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, RotateCw, SlidersHorizontal, X } from 'lucide-react';
import { Button, Card, EmptyState, Skeleton, cn, SURFACE } from './ui';
import { useDialog } from '../lib/useDialog';

/**
 * The primitives the app was hand-rolling.
 *
 * Each one here replaces a pattern the audit found copy-pasted between four and
 * fourteen times, already drifted. They live in their own file rather than in
 * ui.tsx because ui.tsx is the styled-atoms layer (Button, Input, Badge) and these
 * are behaviours - a dialog that traps focus, a list that changes shape, a query
 * that can fail.
 */

/* ============================================================================
   Sheet - a dialog that is a bottom sheet on a phone
   ============================================================================
   The Modal primitive centred a `max-w-lg` box at every width and never became a
   sheet, so on a 390px screen every dialog in the product was a floating card with
   its confirm button somewhere below the fold. A sheet rises from the bottom edge,
   is reachable by a thumb, and keeps its actions pinned.
   ========================================================================== */

export function Sheet({
  title, description, onClose, children, footer, size = 'md', dismissible = true,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Pinned. Never let the confirm button scroll away - that was the bug. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  dismissible?: boolean;
}) {
  const ref = useDialog(true, onClose);
  const width = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size];

  return createPortal(
    <div
      className="animate-backdrop fixed inset-0 z-modal flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'animate-sheet flex max-h-[92dvh] w-full flex-col overflow-hidden bg-white shadow-2xl outline-none dark:bg-slate-900',
          // Rounded at the top only on a phone, because the bottom edge is the
          // screen edge; a fully rounded card floating at the bottom reads as
          // unfinished.
          'rounded-t-[22px] sm:rounded-card sm:border sm:border-slate-200 dark:sm:border-slate-800',
          width,
        )}
      >
        {/* The grab handle is the affordance that says "this can be dismissed by
            dragging", which is what a phone user expects of a bottom sheet. */}
        <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden>
          <span className="h-1 w-9 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-3 sm:border-b sm:border-slate-200 sm:pt-4 dark:sm:border-slate-800">
          <div className="min-w-0">
            <h2 className="t-section text-slate-900 dark:text-slate-100">{title}</h2>
            {description && <p className="t-meta mt-0.5">{description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="tap -m-1 shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="shrink-0 border-t border-slate-200 px-5 py-3.5 pb-safe dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ============================================================================
   QueryState - the branch nobody was writing
   ============================================================================
   The audit's single most repeated finding: not one list in the app read `isError`.
   React Query is configured with `retry: false`, so one dropped request rendered
   the honest-looking empty state - "No members yet" on an institution with two
   hundred. A list must distinguish "loading", "we could not ask", and "we asked
   and there is nothing".
   ========================================================================== */

export interface QueryLike {
  isLoading?: boolean;
  isPending?: boolean;
  isError?: boolean;
  error?: unknown;
  refetch?: () => unknown;
  data?: unknown;
}

export function QueryState({
  query, skeleton, empty, isEmpty, children, errorTitle = 'Could not load this',
}: {
  query: QueryLike | QueryLike[];
  /** What the shape looks like while it loads. A skeleton, not a spinner. */
  skeleton?: ReactNode;
  /** What to show when the request succeeded and returned nothing. */
  empty?: ReactNode;
  isEmpty?: boolean;
  children: ReactNode;
  errorTitle?: string;
}) {
  const qs = Array.isArray(query) ? query : [query];
  const loading = qs.some((q) => q.isLoading ?? q.isPending);
  const failed = qs.find((q) => q.isError);

  if (failed) {
    const message = (failed.error as { message?: string } | undefined)?.message;
    return (
      <EmptyState
        icon={<AlertTriangle size={30} className="text-amber-500" />}
        title={errorTitle}
        // The server's own sentence where there is one: "Only an owner can do
        // this" is worth reading, and "Something went wrong" never is.
        description={message || 'Check your connection and try again.'}
        action={failed.refetch
          ? <Button variant="outline" onClick={() => failed.refetch?.()}><RotateCw size={14} /> Try again</Button>
          : undefined}
      />
    );
  }

  if (loading) return <>{skeleton ?? <SkeletonList />}</>;
  if (isEmpty && empty) return <>{empty}</>;
  return <>{children}</>;
}

/** The loading shape for a list of rows. Reserve Spinner for in-button busy. */
export function SkeletonList({ rows = 5, variant = 'row' }: { rows?: number; variant?: 'row' | 'card' | 'stat' }) {
  if (variant === 'stat') {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={cn(SURFACE, 'p-4')}>
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="mt-3 h-7 w-20" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={cn('flex flex-col', variant === 'card' ? 'gap-3' : 'gap-0')}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={cn(
            'flex items-center gap-3 p-3.5',
            variant === 'card' ? SURFACE : 'border-b border-slate-100 last:border-0 dark:border-slate-800',
          )}
        >
          <Skeleton className="h-9 w-9 shrink-0" rounded="rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-[42%]" />
            <Skeleton className="mt-2 h-2.5 w-[26%]" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/* ============================================================================
   DataList - one column spec, two shapes
   ============================================================================
   Twenty-four files render a <table>, and the only mobile treatment anywhere was
   `overflow-x-auto` - which is not a mobile treatment, it is a desktop table you
   have to drag. A phone wants the same records as stacked cards where the column
   header becomes a label.

   One spec drives both, so the two can never disagree about what a row contains,
   and adding a column cannot be remembered on one and forgotten on the other.
   ========================================================================== */

export interface Column<T> {
  key: string;
  /** Column header, and the field label in the stacked card. */
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Shown as the card's title line rather than as a labelled field. */
  primary?: boolean;
  /** Kept out of the card entirely - a column that only makes sense in a grid. */
  desktopOnly?: boolean;
  /** Right-aligned in the table (numbers, actions). */
  align?: 'left' | 'right';
  className?: string;
  /** Rendered as the card's action row, full width and thumb-reachable. */
  actions?: boolean;
}

export function DataList<T>({
  rows, columns, rowKey, onRowClick, empty, className, caption,
}: {
  rows: T[];
  columns: Array<Column<T>>;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  className?: string;
  caption?: string;
}) {
  if (!rows.length && empty) return <>{empty}</>;

  const primary = columns.find((c) => c.primary) ?? columns[0];
  const actions = columns.filter((c) => c.actions);
  const fields = columns.filter((c) => c !== primary && !c.actions && !c.desktopOnly);

  return (
    <>
      {/* ---- phone: one card per record ---- */}
      <div className={cn('flex flex-col gap-2.5 sm:hidden', className)}>
        {rows.map((row) => (
          <Card
            key={rowKey(row)}
            interactive={!!onRowClick}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className="p-3.5"
          >
            <div className="t-card-title text-slate-900 dark:text-slate-100">{primary.render(row)}</div>
            {fields.length > 0 && (
              // Two columns of label/value: a phone card with one field per line
              // becomes a very long card, and these values are short.
              <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
                {fields.map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="t-eyebrow">{c.header}</dt>
                    <dd className="t-body-sm mt-0.5 truncate text-slate-700 dark:text-slate-300">{c.render(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {(() => {
              // Rendered first, then tested. A row with nothing to do returned an
              // empty node from its action column, and the container drew a divider
              // and 24px of padding under every card for no content at all.
              const nodes = actions.map((c) => [c.key, c.render(row)] as const).filter(([, n]) => !!n);
              if (!nodes.length) return null;
              return (
                <div
                  className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"
                  onClick={(e) => e.stopPropagation()}
                >
                  {nodes.map(([key, node]) => <div key={key} className="contents">{node}</div>)}
                </div>
              );
            })()}
          </Card>
        ))}
      </div>

      {/* ---- sm+: the table ---- */}
      <div className={cn('hidden overflow-x-auto sm:block', SURFACE, className)}>
        <table className="w-full text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-slate-200 text-left dark:border-slate-800">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn('t-eyebrow px-4 py-3', c.align === 'right' && 'text-right', c.className)}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-slate-100 last:border-0 dark:border-slate-800',
                  onRowClick && 'cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60',
                )}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3 align-middle', c.align === 'right' && 'text-right')}>
                    {c.actions ? <span onClick={(e) => e.stopPropagation()}>{c.render(row)}</span> : c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ============================================================================
   FilterBar - the toolbar that does not wrap into four lines
   ============================================================================
   Every list screen grew the same toolbar: a search box plus three to five
   selects. On a phone that is 500-700px of controls wrapping into four rows above
   a list, so the list starts below the fold.

   Search stays visible - it is the control people reach for. Everything else goes
   behind one button that says how many are active, and opens as a sheet. On sm+
   the controls sit inline exactly as before.
   ========================================================================== */

export function FilterBar({
  search, activeCount, onClear, children, right,
}: {
  /** The search input. Always visible at every width. */
  search?: ReactNode;
  /** How many filters are set - shown on the mobile button so it is never a mystery. */
  activeCount?: number;
  onClear?: () => void;
  /** The filter controls. Inline at sm+, inside the sheet below it. */
  children: ReactNode;
  /** Sort controls and the like, kept beside the search on desktop. */
  right?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const n = activeCount ?? 0;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {search && <div className="min-w-0 flex-1 sm:max-w-sm">{search}</div>}

        {/* phone: one button */}
        <Button
          variant={n > 0 ? 'subtle' : 'outline'}
          className="shrink-0 sm:hidden"
          onClick={() => setOpen(true)}
          aria-label={n > 0 ? `Filters, ${n} active` : 'Filters'}
        >
          <SlidersHorizontal size={15} />
          Filters
          {n > 0 && (
            <span className="ml-0.5 rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white t-num">{n}</span>
          )}
        </Button>

        {/* sm+: the controls themselves */}
        <div className="hidden flex-wrap items-center gap-2 sm:flex">{children}</div>
        {right && <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>}
      </div>

      {open && (
        <Sheet
          title="Filters"
          onClose={() => setOpen(false)}
          size="sm"
          footer={
            <div className="flex gap-2">
              {onClear && (
                <Button variant="outline" className="flex-1" onClick={() => { onClear(); setOpen(false); }}>
                  Clear all
                </Button>
              )}
              <Button className="flex-1" onClick={() => setOpen(false)}>Show results</Button>
            </div>
          }
        >
          {/* Stacked and full-width inside the sheet: a select at its desktop
              152px minimum in a 390px sheet leaves a ragged right edge. */}
          <div className="flex flex-col gap-3 [&_select]:w-full [&>*]:w-full">{children}</div>
        </Sheet>
      )}
    </>
  );
}

/* ============================================================================
   Section - one section header, everywhere
   ============================================================================
   Six visual dialects of "a heading with a count and an action" were in use. This
   is the one.
   ========================================================================== */

export function Section({
  title, count, description, action, children, className,
}: {
  title: ReactNode;
  count?: number;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="t-section flex items-center gap-2 text-slate-900 dark:text-slate-100">
            {title}
            {count !== undefined && (
              <span className="t-num rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {count}
              </span>
            )}
          </h2>
          {description && <p className="t-meta mt-1 max-w-prose">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/* ============================================================================
   StickyActionBar - the action a thumb can always reach
   ============================================================================
   On a long list, the primary action was at the top of the page. Below sm this
   pins it to the bottom edge above the tab bar, which is where a thumb is.
   ========================================================================== */

export function StickyActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-sticky -mx-4 mt-3 flex gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 pb-safe backdrop-blur',
        'dark:border-slate-800 dark:bg-slate-900/95',
        'sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none dark:sm:bg-transparent',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ============================================================================
   useUrlState - list state that survives Back
   ============================================================================
   Tab, search, filter, sort and page all lived in useState across every list
   screen, so opening a record and pressing Back returned you to an unfiltered
   list at page one - the friction the user reported on Results, in nine other
   places. Putting the state in the query string makes Back, refresh, and sharing
   a filtered view all work for free.
   ========================================================================== */

export function useUrlState<T extends string>(
  key: string,
  fallback: T,
  opts: { replace?: boolean } = {},
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return fallback;
    return (new URLSearchParams(window.location.search).get(key) as T) ?? fallback;
  });

  const set = useMemo(() => (v: T) => {
    setValue(v);
    const params = new URLSearchParams(window.location.search);
    // A filter back at its default should not sit in the URL - a shared link
    // reading `?status=&sport=&tab=all` tells the reader nothing and looks broken.
    if (!v || v === fallback) params.delete(key);
    else params.set(key, v);
    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    // replaceState by default: changing a filter is not a place you should have
    // to press Back through five times to escape.
    window.history[opts.replace === false ? 'pushState' : 'replaceState'](window.history.state, '', url);
  }, [key, fallback, opts.replace]);

  return [value, set];
}

/* ============================================================================
   usePreserveScroll - stay where you were
   ============================================================================
   The friction the user reported on Results: sign a match off, and you are back at
   the top of a long list hunting for your place.

   It was never the list re-rendering. It was the things ABOVE the list changing
   height - the "N results are waiting to be made official" banner disappearing when
   you locked the last one, the "Refreshing…" indicator appearing and going, a count
   rewrapping to one line. Every one of those moves the rows under them by 40-80px,
   which reads exactly like being scrolled away.

   So: snapshot the scroll offset before the update, put it back after the browser
   has laid out the new content. Two frames, because the first is when React commits
   and the second is when the layout it caused has settled.
   ========================================================================== */

export function usePreserveScroll() {
  return useMemo(() => () => {
    // The app scrolls <main>, not the document - find whichever ancestor actually
    // has the overflow rather than assuming.
    const scroller = document.querySelector('main');
    const el: Element | Window = scroller && scroller.scrollHeight > scroller.clientHeight ? scroller : window;
    const top = el === window ? window.scrollY : (el as Element).scrollTop;
    return () => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (el === window) window.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
        else (el as Element).scrollTop = top;
      }));
    };
  }, []);
}
