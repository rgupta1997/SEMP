import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// A shared Event + Sport filter, surfaced once in the AppShell header and
// consumed by list pages. Each page *registers* the options that make sense for
// it (omit an axis to hide that dropdown), and reads back the current selection.
// Empty string ('') means "All" on either axis.

export interface FilterOption { id: string; name: string }
export interface FilterConfig { events?: FilterOption[]; sports?: FilterOption[] }

interface FilterContextValue {
  eventId: string;
  sportId: string;
  setEventId: (id: string) => void;
  setSportId: (id: string) => void;
  config: FilterConfig;
  setConfig: (c: FilterConfig) => void;
}

const FilterContext = createContext<FilterContextValue | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [eventId, setEventId] = useState('');
  const [sportId, setSportId] = useState('');
  const [config, setConfig] = useState<FilterConfig>({});
  return (
    <FilterContext.Provider value={{ eventId, sportId, setEventId, setSportId, config, setConfig }}>
      {children}
    </FilterContext.Provider>
  );
}

function useFilterContext() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used within a FilterProvider');
  return ctx;
}

// Used by the header to render the dropdowns.
export function useFilterBar() {
  return useFilterContext();
}

const keyOf = (opts?: FilterOption[]) => (opts ? opts.map((o) => `${o.id}:${o.name}`).join('|') : '');

/**
 * Page-side hook: declares which filters this page supports (and their current
 * options) and returns the active selection. Pages that omit an axis get '' for
 * it, so a stale global selection never leaks into a view that can't honour it.
 */
export function usePageFilters(opts: FilterConfig): { eventId: string; sportId: string } {
  const { eventId, sportId, setEventId, setSportId, setConfig } = useFilterContext();
  const eventsKey = keyOf(opts.events);
  const sportsKey = keyOf(opts.sports);

  // Publish this page's filter config to the header (overwrites on option change)…
  useEffect(() => {
    setConfig({ events: opts.events, sports: opts.sports });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsKey, sportsKey]);
  // …and clear it only when the page actually unmounts, to avoid a flicker when
  // options change (e.g. selecting an event narrows the sport list).
  useEffect(() => () => setConfig({}), [setConfig]);

  // Drop a selection that isn't valid for the current options. This also powers
  // the cascade: when the event narrows the sport list, an out-of-scope sport
  // resets to All.
  useEffect(() => {
    if (opts.events?.length && eventId && !opts.events.some((o) => o.id === eventId)) setEventId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsKey, eventId]);
  useEffect(() => {
    if (opts.sports?.length && sportId && !opts.sports.some((o) => o.id === sportId)) setSportId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sportsKey, sportId]);

  return {
    eventId: opts.events ? eventId : '',
    sportId: opts.sports ? sportId : '',
  };
}
