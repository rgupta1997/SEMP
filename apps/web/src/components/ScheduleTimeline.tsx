import { useMemo, useState } from 'react';
import { fmtDate } from '../lib/hooks';
import { Badge, Button, EmptyState, Field, Modal, Segmented, Select, StatusBadge, cn } from './ui';

export interface DisciplineRow {
  id: string;            // tournament_discipline_id
  sport: string;
  discipline: string;
  format?: string | null;
  entry_type?: string | null;
}
export interface GridFixture {
  id: string;
  tournament_discipline_id: string;
  status: string;
  round?: string | null;
  scheduled_at: string | null;
  duration_minutes?: number | null;
  sport?: string | null;
  sport_icon?: string | null;
  home?: { id: string; name: string } | null;
  away?: { id: string; name: string } | null;
}

// Default working window; the grid expands to cover any match scheduled outside it,
// up to the full 24-hour day.
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 20;
// Durations the organiser can assign to a match (minutes).
const DURATION_OPTIONS = [15, 20, 30, 45, 60, 75, 90, 120];
const DEFAULT_DURATION = 60;

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function matchLabel(f: GridFixture): string {
  if (f.home || f.away) return `${f.home?.name ?? 'TBD'} v ${f.away?.name ?? 'TBD'}`;
  return f.round || 'Match';
}

// "09:00–09:45" range label from a fixture's start + duration.
function timeRange(f: GridFixture): string {
  if (!f.scheduled_at) return '';
  const start = new Date(f.scheduled_at);
  const mins = f.duration_minutes && f.duration_minutes > 0 ? f.duration_minutes : DEFAULT_DURATION;
  const end = new Date(start.getTime() + mins * 60000);
  return `${hhmm(start)}–${hhmm(end)} · ${mins}m`;
}

// Discipline × time scheduler. Rows are the championship's disciplines; columns are
// hourly lanes across the day. Tap an empty slot (managers only) to place one of that
// discipline's unscheduled matches at a chosen start time + duration; scheduled
// matches render as blocks in their row + start-hour lane.
export function ScheduleTimeline({ rows, fixtures, days, canManage, onPlace, placing }: {
  rows: DisciplineRow[];
  fixtures: GridFixture[];
  days: string[];
  canManage: boolean;
  onPlace: (fixtureId: string, startISO: string, durationMinutes: number) => void;
  placing?: boolean;
}) {
  const [day, setDay] = useState('');
  const activeDay = day && days.includes(day) ? day : days[0] ?? '';
  const [slot, setSlot] = useState<{ row: DisciplineRow; hour: number } | null>(null);

  const unscheduledCount = useMemo(() => fixtures.filter((f) => !f.scheduled_at).length, [fixtures]);

  // Hour lanes to render: the default 8–20 window, widened to include any match
  // scheduled earlier/later on the active day (so a 06:00 or 22:00 match still shows).
  const hours = useMemo(() => {
    let lo = DEFAULT_START_HOUR;
    let hi = DEFAULT_END_HOUR;
    for (const f of fixtures) {
      if (!f.scheduled_at) continue;
      const d = new Date(f.scheduled_at);
      if (dayKey(d) !== activeDay) continue;
      lo = Math.min(lo, d.getHours());
      hi = Math.max(hi, d.getHours());
    }
    lo = Math.max(0, lo);
    hi = Math.min(23, hi);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [fixtures, activeDay]);

  const cellFixtures = (rowId: string, hour: number) =>
    fixtures.filter((f) => {
      if (f.tournament_discipline_id !== rowId || !f.scheduled_at) return false;
      const d = new Date(f.scheduled_at);
      if (dayKey(d) !== activeDay) return false;
      return d.getHours() === hour;
    });

  const rowUnscheduled = (rowId: string) => fixtures.filter((f) => f.tournament_discipline_id === rowId && !f.scheduled_at);

  if (rows.length === 0) {
    return <EmptyState icon="⚑" title="No disciplines yet" description="Add sports & disciplines in Setup before scheduling matches." />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {days.length > 1 ? (
          <Segmented value={activeDay} onChange={setDay} options={days.map((d) => ({ value: d, label: fmtDate(d) }))} />
        ) : <div className="text-sm font-semibold text-slate-600 dark:text-slate-300">{activeDay ? fmtDate(activeDay) : 'Schedule'}</div>}
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Unscheduled: {unscheduledCount}</span>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-block rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:bg-slate-900 dark:text-slate-500" style={{ minWidth: 160 }}>
                Discipline / time
              </th>
              {hours.map((h) => (
                <th key={h} className="px-3 py-2 text-center text-xs font-bold text-slate-500 dark:text-slate-400" style={{ minWidth: 130 }}>{pad(h)}:00</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                <td className="sticky left-0 z-10 bg-white px-3 py-3 align-top dark:bg-slate-900">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{row.sport} · {row.discipline}</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500">{row.format ?? row.entry_type ?? ''}</div>
                </td>
                {hours.map((h) => {
                  const items = cellFixtures(row.id, h);
                  return (
                    <td key={h} className="p-1.5 align-top">
                      {items.length > 0 ? (
                        <div className="space-y-1">
                          {items.map((f) => (
                            <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-left dark:border-amber-500/30 dark:bg-amber-500/10">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                  <span>{f.sport_icon ?? '•'}</span><span className="truncate">{f.round || 'Match'}</span>
                                </div>
                                <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{matchLabel(f)}</div>
                                <div className="truncate text-[10px] text-slate-400 dark:text-slate-500">{timeRange(f)}</div>
                              </div>
                              {f.status !== 'scheduled' && <span className="shrink-0"><StatusBadge status={f.status} /></span>}
                            </div>
                          ))}
                        </div>
                      ) : canManage ? (
                        <button
                          type="button"
                          onClick={() => setSlot({ row, hour: h })}
                          className="grid h-14 w-full place-items-center rounded-lg border border-dashed border-slate-200 text-slate-300 transition hover:border-brand-300 hover:text-brand-500 dark:border-slate-700 dark:text-slate-600 dark:hover:border-brand-500/50"
                          aria-label={`Schedule ${row.sport} ${row.discipline} at ${pad(h)}:00`}
                        >
                          +
                        </button>
                      ) : (
                        <div className="h-14 rounded-lg border border-dashed border-slate-100 dark:border-slate-800/60" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {canManage && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Columns = time, rows = discipline. Tap an empty slot to schedule a match — pick its exact start time and how long it runs.
        </p>
      )}

      {slot && (
        <PlaceModal
          slot={slot}
          activeDay={activeDay}
          matches={rowUnscheduled(slot.row.id)}
          placing={placing}
          onClose={() => setSlot(null)}
          onPlace={onPlace}
        />
      )}
    </div>
  );
}

// Schedule-a-match modal: pick one of the discipline's unscheduled matches, set the
// exact start time (seeded from the tapped lane) and a duration, then place it.
function PlaceModal({ slot, activeDay, matches, placing, onClose, onPlace }: {
  slot: { row: DisciplineRow; hour: number };
  activeDay: string;
  matches: GridFixture[];
  placing?: boolean;
  onClose: () => void;
  onPlace: (fixtureId: string, startISO: string, durationMinutes: number) => void;
}) {
  const [time, setTime] = useState(`${pad(slot.hour)}:00`);
  const [duration, setDuration] = useState(DEFAULT_DURATION);

  const place = (fixtureId: string) => {
    const [y, mo, d] = activeDay.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const startISO = new Date(y, mo - 1, d, hh || 0, mm || 0).toISOString();
    onPlace(fixtureId, startISO, duration);
    onClose();
  };

  return (
    <Modal title="Schedule a match" onClose={onClose}>
      <p className="-mt-2 mb-3 text-sm text-slate-500 dark:text-slate-400">{slot.row.sport} · {slot.row.discipline} · {fmtDate(activeDay)}</p>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Field label="Start time">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
        </Field>
        <Field label="Duration">
          <Select value={String(duration)} onChange={(e) => setDuration(Number(e.target.value))}>
            {DURATION_OPTIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
          </Select>
        </Field>
      </div>

      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Unscheduled {slot.row.sport} · {slot.row.discipline}</div>
      {matches.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-400 dark:bg-slate-800/60 dark:text-slate-500">
          No unscheduled matches in this discipline. Generate the draw first, or all matches are already placed.
        </p>
      ) : (
        <div className="space-y-2">
          {matches.map((f) => (
            <div key={f.id} className={cn('flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800', placing && 'opacity-60')}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge tone="slate">{f.round || 'Match'}</Badge>
                  <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{matchLabel(f)}</span>
                </div>
              </div>
              <Button size="sm" variant="subtle" disabled={placing} onClick={() => place(f.id)}>
                Place →
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
