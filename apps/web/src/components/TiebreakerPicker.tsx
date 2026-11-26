import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { tiebreakerLabel, tiebreakerOptions, type GroupRanking, type StandingsTiebreaker } from '@semp/shared';
import { PickList } from './PickList';
import { FIELD_LABEL, NUM_INPUT } from './formStyles';
import { cn } from './ui';

const ROW_BTN = 'grid h-7 w-7 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-slate-700 dark:hover:text-slate-200';

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
    <div className="space-y-2">
      <ol className="space-y-1.5">
        {value.map((t, i) => (
          <li key={t} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white py-1.5 pl-2 pr-1.5 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-black text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate font-semibold text-slate-800 dark:text-slate-100">{tiebreakerLabel(t, sport, entryType)}</span>
            <button type="button" className={ROW_BTN} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" title="Move up"><ArrowUp size={14} /></button>
            <button type="button" className={ROW_BTN} disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="Move down" title="Move down"><ArrowDown size={14} /></button>
            <button type="button" className={cn(ROW_BTN, 'hover:!bg-rose-50 hover:!text-rose-600')} disabled={value.length === 1} onClick={() => onChange(value.filter((x) => x !== t))} aria-label="Remove" title="Remove"><X size={14} /></button>
          </li>
        ))}
      </ol>
      {unused.length > 0 && (
        <PickList value="" onChange={(v) => v && onChange([...value, v as StandingsTiebreaker])} placeholder="+ Add a tie-breaker"
          ariaLabel="Add a tie-breaker" options={unused.map((t) => ({ value: t, label: tiebreakerLabel(t, sport, entryType) }))}
          className="max-w-xs border-dashed shadow-none" />
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
    <label className="block">
      <span className={FIELD_LABEL}>{label}</span>
      <input
        type="text" inputMode="numeric" value={String(value[key])}
        onChange={(e) => {
          const cleaned = e.target.value.replace(/[^\d]/g, '');
          onChange({ ...value, [key]: cleaned === '' ? 0 : Math.min(100, parseInt(cleaned, 10)) });
        }}
        className={cn(NUM_INPUT, 'w-16')}
      />
    </label>
  );
  return <div className="flex gap-3">{field('win', 'Win')}{field('draw', 'Draw')}{field('loss', 'Loss')}</div>;
}
