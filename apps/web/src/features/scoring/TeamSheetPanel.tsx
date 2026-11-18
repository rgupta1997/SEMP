import { useMemo, useState } from 'react';
import {
  defaultJerseys, defaultSideSheet, duplicateJerseys, isJerseyNumber, sheetOrder,
  type SheetPerson, type SideSheet, type TeamSheet,
} from '@semp/shared';
import { Button, Card, Segmented, cn } from '../../components/ui';
import { JerseyInput } from './Jersey';

// ============================================================================
// The team sheet, before kick-off: for each side, who PLAYS, who is a SUBSTITUTE, and
// who is left in the squad. Pre-filled with the sport's usual numbers so the scorer
// only changes what differs. The scorer's pickers then offer playing + substitutes.
// Shirt numbers start from each player's profile and can be changed for this match only.
// ============================================================================

type Slot = 'playing' | 'bench' | 'squad';
const SLOTS: { key: Slot; label: string }[] = [
  { key: 'playing', label: 'Playing' },
  { key: 'bench', label: 'Substitutes' },
  { key: 'squad', label: 'Remaining squad' },
];

export interface TeamSheetSide { side: 'A' | 'B'; name: string; org?: string | null; squad: SheetPerson[] }

export function TeamSheetPanel({ sportName, usual, sides, initial, onSave, onCancel, disabled }: {
  sportName: string;
  usual: { onField: number; bench: number };
  /** In screen order, home then away. */
  sides: [TeamSheetSide, TeamSheetSide];
  /** The saved sheet when editing; otherwise the suggested one is used. */
  initial?: TeamSheet | null;
  onSave: (sheet: TeamSheet) => void;
  onCancel?: () => void;
  disabled?: boolean;
}) {
  const suggested = useMemo<TeamSheet>(() => ({
    A: defaultSideSheet(sides[0].squad, usual),
    B: defaultSideSheet(sides[1].squad, usual),
  }), [sides, usual]);
  // A sheet saved before shirt numbers existed starts from the profile numbers too.
  const [sheet, setSheet] = useState<TeamSheet>(() => (initial
    ? {
      A: { ...initial.A, jerseys: initial.A.jerseys ?? defaultJerseys(sides[0].squad) },
      B: { ...initial.B, jerseys: initial.B.jerseys ?? defaultJerseys(sides[1].squad) },
    }
    : suggested));
  const [shown, setShown] = useState<'A' | 'B'>('A');

  const slotOf = (s: SideSheet, id: string): Slot =>
    (s.playing.includes(id) ? 'playing' : s.bench.includes(id) ? 'bench' : 'squad');

  const move = (side: 'A' | 'B', id: string, to: Slot) => setSheet((cur) => {
    const s = cur[side];
    const playing = s.playing.filter((x) => x !== id);
    const bench = s.bench.filter((x) => x !== id);
    if (to === 'playing') playing.push(id);
    if (to === 'bench') bench.push(id);
    return { ...cur, [side]: { ...s, playing, bench } };
  });

  // Blank clears the number for this match; anything outside 0-999 is not kept.
  const setJersey = (side: 'A' | 'B', id: string, raw: string) => setSheet((cur) => {
    const jerseys = { ...(cur[side].jerseys ?? {}) };
    const n = raw.trim() === '' ? null : Number(raw);
    if (n == null) delete jerseys[id];
    else if (isJerseyNumber(n)) jerseys[id] = n;
    else return cur;
    return { ...cur, [side]: { ...cur[side], jerseys } };
  });

  const sideBlock = (t: TeamSheetSide) => {
    const s = sheet[t.side];
    const ordered = sheetOrder(t.squad);
    const short = Math.min(usual.onField, t.squad.length);
    // A note, never a block: 7-a-side, a player short, an extra on the field - the scorer knows.
    const note = s.playing.length !== short
      ? `${sportName} usually fields ${usual.onField} - ${s.playing.length} playing.`
      : null;
    const clashes = duplicateJerseys(s);
    return (
      <div key={t.side} className={cn('grid content-start gap-3', shown !== t.side && 'max-sm:hidden')}>
        <div>
          <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{t.name}</div>
          {t.org && <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">{t.org}</div>}
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {s.playing.length} playing · {s.bench.length} substitutes · {t.squad.length - s.playing.length - s.bench.length} in the squad
          </div>
          {note && <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">{note}</div>}
          {clashes.length > 0 && (
            <div className="mt-1 text-xs text-amber-700 dark:text-amber-300" data-qa="jersey-clash">
              Same jersey number on more than one player: {clashes.map((n) => `#${n}`).join(', ')}.
            </div>
          )}
        </div>
        {t.squad.length === 0 ? (
          <div className="text-xs text-slate-400 dark:text-slate-500">No players on this squad yet.</div>
        ) : SLOTS.map((slot) => {
          const people = ordered.filter((p) => slotOf(s, p.id) === slot.key);
          return (
            <div key={slot.key} className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {slot.label} ({people.length})
                </span>
                {/* Jerseys don't look editable, so say it once per side, on the first list with people. */}
                {!disabled && people.length > 0 && slot.key === SLOTS.find((x) => ordered.some((p) => slotOf(s, p.id) === x.key))?.key && (
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300" data-qa="jersey-hint">
                    Tap a jersey to change its number
                  </span>
                )}
              </div>
              {people.length === 0 ? (
                <div className="text-xs text-slate-400 dark:text-slate-500">Nobody.</div>
              ) : people.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700">
                  <span className="flex min-w-0 items-center gap-2">
                    <JerseyInput
                      value={s.jerseys?.[p.id]}
                      onChange={(raw) => setJersey(t.side, p.id, raw)}
                      disabled={disabled}
                      label={`Jersey number for ${p.name} in this match`}
                      title={p.jersey != null ? `Profile number: #${p.jersey}` : 'No number on their profile'}
                    />
                    <span className="min-w-0 truncate text-sm text-slate-700 dark:text-slate-200">{p.name}</span>
                  </span>
                  <span className="flex-none">
                    <Segmented
                      size="sm"
                      value={slot.key}
                      onChange={(to) => !disabled && move(t.side, p.id, to)}
                      options={[
                        { value: 'playing', label: 'Play' },
                        { value: 'bench', label: 'Sub' },
                        { value: 'squad', label: 'Out' },
                      ]}
                    />
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Card className="grid gap-4 p-4">
      <div>
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Team sheet</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Suggested from each squad - change anyone with Play, Sub or Out. Only players and substitutes appear in the scoring pickers.
          Jersey numbers come from each player's profile; changing one here is for this match only.
        </div>
      </div>

      {/* One team at a time on a phone; both side by side from sm up. */}
      <div className="sm:hidden">
        <Segmented
          value={shown}
          onChange={setShown}
          options={[{ value: 'A', label: sides[0].name }, { value: 'B', label: sides[1].name }]}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">{sides.map(sideBlock)}</div>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={disabled} onClick={() => onSave(sheet)}>{initial ? 'Save team sheet' : 'Confirm team sheet'}</Button>
        {onCancel && <Button variant="subtle" onClick={onCancel}>Cancel</Button>}
        <button
          type="button" disabled={disabled}
          className="ml-auto text-xs text-slate-400 underline underline-offset-2 hover:text-slate-600 dark:text-slate-500"
          onClick={() => setSheet(suggested)}
        >
          Reset to suggested
        </button>
      </div>
    </Card>
  );
}
