import { useState } from 'react';
import { buildTieSpec, tieLayoutsFor, type TieRubberDraft, type TieSpec } from '@semp/shared';
import { Button, Input, Select, cn } from '../../components/ui';

// ============================================================================
// The rubbers a team tie is made of, per draw.
//
// Events play their own team formats - a corporate three-rubber tie, five singles -
// so the organiser picks a ready-made layout or builds one. How each rubber is SCORED
// still comes from the sport and the draw's scoring format; this only says which
// rubbers there are and how the tie is won.
// ============================================================================

export interface TieLayoutValue {
  /** true = no layout of our own: the sport's standard tie applies. */
  standard: boolean;
  spec: TieSpec;
}

export function TieLayoutEditor({ sport, stored, onChange }: {
  sport: string;
  /** The draw's saved tie, when it has one. */
  stored?: TieSpec;
  onChange: (v: TieLayoutValue) => void;
}) {
  const layouts = tieLayoutsFor(sport);
  const [standard, setStandard] = useState(!stored);
  const [rubbers, setRubbers] = useState<TieRubberDraft[]>(() =>
    stored
      ? stored.rubbers.map((r) => ({ label: r.label, size: r.size ?? (/doubles/i.test(r.label) ? 2 : 1) }))
      : layouts[0]?.rubbers ?? [{ label: 'Singles', size: 1 }]);
  const [target, setTarget] = useState<number>(stored?.winBy === 'count' ? stored.target ?? 0 : 0);
  // Dead rubbers. The sport standard stops once decided in every round; picking a
  // layout suggests playing league / group rubbers out, because rubbers won can decide
  // a table. A layout saved before this split keeps its single setting for both.
  const [skipKnockout, setSkipKnockout] = useState(stored?.skipDeadRubbers ?? true);
  const [skipGroups, setSkipGroups] = useState(stored ? (stored.skipDeadInGroups ?? stored.skipDeadRubbers) : true);
  const [preset, setPreset] = useState<string>(stored ? 'custom' : 'standard');

  const emit = (next: { standard?: boolean; rubbers?: TieRubberDraft[]; target?: number; skipKnockout?: boolean; skipGroups?: boolean }) => {
    const s = next.standard ?? standard;
    const r = next.rubbers ?? rubbers;
    const t = next.target ?? target;
    onChange({
      standard: s,
      spec: buildTieSpec(sport, r, {
        target: t || null,
        skipDeadRubbers: next.skipKnockout ?? skipKnockout,
        skipDeadInGroups: next.skipGroups ?? skipGroups,
      }),
    });
  };

  // Changing a rule makes the layout the draw's own.
  const own = () => { setStandard(false); setPreset((p) => (p === 'standard' ? 'custom' : p)); };

  const pickPreset = (key: string) => {
    setPreset(key);
    if (key === 'standard') {
      const def = layouts[0]?.rubbers ?? rubbers;
      setStandard(true); setRubbers(def); setTarget(0); setSkipKnockout(true); setSkipGroups(true);
      emit({ standard: true, rubbers: def, target: 0, skipKnockout: true, skipGroups: true });
      return;
    }
    const layout = layouts.find((l) => l.key === key);
    const next = layout ? layout.rubbers : rubbers;
    // A ready-made layout comes with the recommended split; 'Custom' keeps what is set.
    const groups = layout ? false : skipGroups;
    const knockout = layout ? true : skipKnockout;
    setStandard(false); setRubbers(next); setTarget(0); setSkipGroups(groups); setSkipKnockout(knockout);
    emit({ standard: false, rubbers: next, target: 0, skipGroups: groups, skipKnockout: knockout });
  };

  // Any edit makes the layout the draw's own.
  const edit = (next: TieRubberDraft[]) => {
    setRubbers(next); setStandard(false); setPreset('custom');
    const t = target > next.length ? 0 : target;
    setTarget(t);
    emit({ standard: false, rubbers: next, target: t });
  };

  const majority = Math.floor(rubbers.length / 2) + 1;

  return (
    <div className="mb-3 grid gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div>
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Team tie layout</div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          The rubbers a team match is made of. A tie that has already started keeps the layout it began with.
        </p>
      </div>

      <Select value={preset} onChange={(e) => pickPreset(e.target.value)}>
        <option value="standard">Sport standard{layouts[0] ? ` — ${layouts[0].rubbers.length} rubbers` : ''}</option>
        {layouts.filter((l) => l.key !== 'default').map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
        <option value="custom">Custom</option>
      </Select>

      <div className="grid gap-2">
        {rubbers.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-slate-400">{i + 1}</span>
            <Input
              value={r.label}
              aria-label={`Rubber ${i + 1} name`}
              onChange={(e) => edit(rubbers.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <Select
              className="w-32 shrink-0"
              value={String(r.size)}
              aria-label={`Rubber ${i + 1} players`}
              onChange={(e) => edit(rubbers.map((x, j) => (j === i ? { ...x, size: Number(e.target.value) } : x)))}
            >
              <option value="1">Singles</option>
              <option value="2">Doubles</option>
            </Select>
            <button
              type="button"
              disabled={rubbers.length <= 1}
              aria-label={`Remove rubber ${i + 1}`}
              onClick={() => edit(rubbers.filter((_, j) => j !== i))}
              className={cn('shrink-0 rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10',
                rubbers.length <= 1 && 'opacity-30')}
            >
              Remove
            </button>
          </div>
        ))}
        <div>
          <Button size="sm" variant="subtle" disabled={rubbers.length >= 9}
            onClick={() => edit([...rubbers, { label: `Rubber ${rubbers.length + 1}`, size: 1 }])}>
            + Add rubber
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-slate-500 dark:text-slate-400">
          Tie is won by
          <Select value={String(target)} onChange={(e) => { const t = Number(e.target.value); setTarget(t); own(); emit({ target: t, standard: false }); }}>
            <option value="0">First to {majority} (majority)</option>
            {Array.from({ length: rubbers.length }, (_, i) => i + 1).filter((n) => n !== majority).map((n) => (
              <option key={n} value={n}>First to {n}</option>
            ))}
          </Select>
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-slate-500 dark:text-slate-400">
          League &amp; group matches
          <Select value={skipGroups ? 'stop' : 'all'}
            onChange={(e) => { const v = e.target.value === 'stop'; setSkipGroups(v); own(); emit({ skipGroups: v, standard: false }); }}>
            <option value="all">Play every rubber</option>
            <option value="stop">Stop once the tie is decided</option>
          </Select>
        </label>
        <label className="grid gap-1 text-xs text-slate-500 dark:text-slate-400">
          Knockout matches
          <Select value={skipKnockout ? 'stop' : 'all'}
            onChange={(e) => { const v = e.target.value === 'stop'; setSkipKnockout(v); own(); emit({ skipKnockout: v, standard: false }); }}>
            <option value="stop">Stop once the tie is decided</option>
            <option value="all">Play every rubber</option>
          </Select>
        </label>
      </div>
      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        Playing every rubber in league and group rounds keeps rubbers-won fair in the table and gives every player a match.
      </p>
    </div>
  );
}
