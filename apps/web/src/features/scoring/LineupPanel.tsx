import { useState } from 'react';
import type { RubberLineup } from '@semp/shared';
import { Button, Card, cn } from '../../components/ui';

// ============================================================================
// "Who is playing?" - careers are built from this: only players named here get the
// result and stats. Skipping is allowed; the result then counts for the team alone.
// ============================================================================

export interface LineupPerson { id: string; name: string }

export interface LineupSide {
  side: 'A' | 'B';
  name: string;
  org?: string | null;
  roster: LineupPerson[];
}

export function LineupPanel({ title, size, sides, initial, usedElsewhere, onSave, onSkip, onCancel, disabled }: {
  title: string;
  /** Players per side: 1 singles, 2 doubles. */
  size: number;
  /** In screen order, left then right. */
  sides: [LineupSide, LineupSide];
  initial?: RubberLineup;
  /** Rubbers each person already plays in this tie - a warning, never a block. */
  usedElsewhere?: Map<string, string[]>;
  onSave: (lineup: RubberLineup) => void;
  onSkip?: () => void;
  onCancel?: () => void;
  disabled?: boolean;
}) {
  const [picked, setPicked] = useState<RubberLineup>(() => initial ?? { A: [], B: [] });
  // A side with a short roster can only field who it has.
  const need = (s: LineupSide) => Math.min(size, s.roster.length);

  const toggle = (side: 'A' | 'B', id: string) => setPicked((cur) => {
    const list = cur[side];
    if (list.includes(id)) return { ...cur, [side]: list.filter((x) => x !== id) };
    // Over the limit: the earliest pick makes way, so a mis-tap is one tap to fix.
    const next = [...list, id];
    return { ...cur, [side]: next.length > size ? next.slice(next.length - size) : next };
  });

  const ready = sides.every((s) => picked[s.side].length === need(s) && need(s) > 0);
  const warnings = sides.flatMap((s) => picked[s.side].flatMap((id) => {
    const used = usedElsewhere?.get(id);
    const who = s.roster.find((p) => p.id === id)?.name;
    return used?.length && who ? [`${who} already plays ${used.join(', ')} in this tie.`] : [];
  }));

  return (
    <Card className="grid gap-4 p-4">
      <div>
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title} — who is playing?</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Tap {size === 1 ? 'one player' : `${size} players`} a side. Only the players named here get this result in their career.
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {sides.map((s) => (
          <div key={s.side} className="grid content-start gap-2">
            <div>
              <div className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{s.name}</div>
              {s.org && <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">{s.org}</div>}
            </div>
            {s.roster.length === 0 ? (
              <div className="text-xs text-slate-400 dark:text-slate-500">No players on this squad yet.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {s.roster.map((person) => {
                  const order = picked[s.side].indexOf(person.id);
                  return (
                    <button
                      key={person.id} type="button" disabled={disabled}
                      onClick={() => toggle(s.side, person.id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition',
                        order >= 0
                          ? 'border-emerald-500 bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
                          : 'border-slate-200 text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:text-slate-200',
                      )}
                    >
                      {order >= 0 && size > 1 && (
                        <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-[10px] text-white">{order + 1}</span>
                      )}
                      {person.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {warnings.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-300">
          {warnings.map((w) => <div key={w}>{w}</div>)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!ready || disabled} onClick={() => onSave(picked)}>Confirm players</Button>
        {onCancel && <Button variant="subtle" onClick={onCancel}>Cancel</Button>}
        {onSkip && (
          <button type="button" disabled={disabled}
            className="ml-auto text-xs text-slate-400 underline underline-offset-2 hover:text-slate-600 dark:text-slate-500"
            onClick={onSkip}>
            Skip — no names (counts for the team only)
          </button>
        )}
      </div>
    </Card>
  );
}
