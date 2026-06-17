import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// A shared Championship + Sport filter, surfaced once in the AppShell header and
// consumed by list pages. Each page *registers* the options that make sense for
// it (omit an axis to hide that dropdown), and reads back the current selection.
// Empty string ('') means "All" on either axis.

export interface FilterOption { id: string; name: string }
export interface FilterConfig {
  championships?: FilterOption[];
  tournaments?: FilterOption[];
  sports?: FilterOption[];
  /** Single-select tournament: no "All" option, auto-selects the first tournament. */
  tournamentRequired?: boolean;
}

interface FilterContextValue {
  eventId: string;
  tournamentId: string;
  sportId: string;
  setEventId: (id: string) => void;
  setTournamentId: (id: string) => void;
  setSportId: (id: string) => void;
  config: FilterConfig;
  setConfig: (c: FilterConfig) => void;
}

const FilterContext = createContext<FilterContextValue | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [eventId, setEventId] = useState('');
  const [tournamentId, setTournamentId] = useState('');
  const [sportId, setSportId] = useState('');
  const [config, setConfig] = useState<FilterConfig>({});
  return (
    <FilterContext.Provider value={{ eventId, tournamentId, sportId, setEventId, setTournamentId, setSportId, config, setConfig }}>
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
export function usePageFilters(opts: FilterConfig): { eventId: string; tournamentId: string; sportId: string } {
  const { eventId, tournamentId, sportId, setEventId, setTournamentId, setSportId, setConfig } = useFilterContext();
  const eventsKey = keyOf(opts.championships);
  const tournamentsKey = keyOf(opts.tournaments);
  const sportsKey = keyOf(opts.sports);

  // Publish this page's filter config to the header (overwrites on option change)…
  useEffect(() => {
    setConfig({ championships: opts.championships, tournaments: opts.tournaments, sports: opts.sports, tournamentRequired: opts.tournamentRequired });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsKey, tournamentsKey, sportsKey, opts.tournamentRequired]);
  // …and clear it only when the page actually unmounts, to avoid a flicker when
  // options change (e.g. selecting an championship narrows the sport list).
  useEffect(() => () => setConfig({}), [setConfig]);

  // Drop a selection that isn't valid for the current options. This also powers
  // the cascade: when the championship narrows the sport list, an out-of-scope sport
  // resets to All.
  useEffect(() => {
    if (opts.championships?.length && eventId && !opts.championships.some((o) => o.id === eventId)) setEventId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsKey, eventId]);
  // Keep the tournament selection valid. Required pages always land on a concrete
  // tournament (first option); optional pages fall back to '' (All).
  useEffect(() => {
    if (!opts.tournaments) return;
    const valid = tournamentId && opts.tournaments.some((o) => o.id === tournamentId);
    if (valid) return;
    if (opts.tournamentRequired && opts.tournaments.length) setTournamentId(opts.tournaments[0].id);
    else if (tournamentId) setTournamentId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentsKey, tournamentId, opts.tournamentRequired]);
  useEffect(() => {
    if (opts.sports?.length && sportId && !opts.sports.some((o) => o.id === sportId)) setSportId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sportsKey, sportId]);

  return {
    eventId: opts.championships ? eventId : '',
    tournamentId: opts.tournaments ? tournamentId : '',
    sportId: opts.sports ? sportId : '',
  };
}
