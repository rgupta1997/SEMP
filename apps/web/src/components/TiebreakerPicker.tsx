import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { tiebreakerLabel, tiebreakerOptions, type GroupRanking, type StandingsTiebreaker } from '@semp/shared';
import { Select } from './ui';

// Ordered tie-breakers for a group / league table, named in the sport's own terms
// (goal difference, set difference...). Teams still level after the last one are
// ordered by hand on the group table.
export function TiebreakerPicker({ value, onChange, sport, entryType }: {
  value: StandingsTiebreaker[]; onChange: (next: StandingsTiebreaker[]) => void; sport?: string | null; entryType?: string | null;
}) {
  const unused = tiebreakerOptions(sport, entryType).filter((t) => !value.includes(t));
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-1.5">
      <ol className="space-y-1">
        {value.map((t, i) => (
          <li key={t} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800">
            <span className="w-5 text-xs font-semibold text-slate-400">{i + 1}.</span>
            <span className="flex-1 text-slate-800 dark:text-slate-100">{tiebreakerLabel(t, sport, entryType)}</span>
            <button type="button" className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={14} /></button>
            <button type="button" className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={14} /></button>
            <button type="button" className="rounded p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30" disabled={value.length === 1} onClick={() => onChange(value.filter((x) => x !== t))} aria-label="Remove"><X size={14} /></button>
          </li>
        ))}
      </ol>
      {unused.length > 0 && (
        <Select className="w-full max-w-xs" value="" onChange={(e) => e.target.value && onChange([...value, e.target.value as StandingsTiebreaker])}>
          <option value="">+ Add a tie-breaker</option>
          {unused.map((t) => <option key={t} value={t}>{tiebreakerLabel(t, sport, entryType)}</option>)}
        </Select>
      )}
      <p className="text-xs text-slate-400 dark:text-slate-500">Still level after these? Set their order by hand on the group table, with a reason.</p>
    </div>
  );
}

/** Win / draw / loss points for a table, as compact number inputs. */
export function MatchPointsFields({ value, onChange }: {
  value: Pick<GroupRanking, 'win' | 'draw' | 'loss'>; onChange: (next: Pick<GroupRanking, 'win' | 'draw' | 'loss'>) => void;
}) {
  const field = (key: 'win' | 'draw' | 'loss', label: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</span>
      <input
        type="text" inputMode="numeric" value={String(value[key])}
        onChange={(e) => {
          const cleaned = e.target.value.replace(/[^\d]/g, '');
          onChange({ ...value, [key]: cleaned === '' ? 0 : Math.min(100, parseInt(cleaned, 10)) });
        }}
        className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      />
    </label>
  );
  return <div className="flex gap-3">{field('win', 'Win')}{field('draw', 'Draw')}{field('loss', 'Loss')}</div>;
}
