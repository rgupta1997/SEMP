/** How each championship lifecycle status reads: a solid pill in its own colour. */
export const EVENT_STATUS_LOOK: Record<string, { label: string; dot: string; solid: string }> = {
  draft: { label: 'Draft', dot: 'bg-amber-900/60', solid: 'bg-amber-400 text-amber-950 shadow-amber-900/20' },
  registration_open: { label: 'Registration open', dot: 'bg-sky-900/60', solid: 'bg-sky-300 text-sky-950 shadow-sky-900/20' },
  ongoing: { label: 'Live', dot: 'bg-white', solid: 'bg-rose-500 text-white shadow-rose-900/30' },
  completed: { label: 'Completed', dot: 'bg-emerald-950/60', solid: 'bg-emerald-400 text-emerald-950 shadow-emerald-900/20' },
};

export const eventStatusLook = (status: string) =>
  EVENT_STATUS_LOOK[status] ?? { label: status, dot: 'bg-slate-500', solid: 'bg-white text-slate-800' };
