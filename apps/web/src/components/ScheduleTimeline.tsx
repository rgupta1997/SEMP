import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { fmtDate, fmtDateTime } from '../lib/hooks';
import { Badge, Button, EmptyState, Field, Modal, Segmented, Select, cn, toast } from './ui';

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
  bracket_position?: number | null;
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

// Horizontal gantt: time runs left → right. Each hour is HOUR_PX wide, so a 60-minute
// match is exactly one hour wide and a 15-minute match a quarter of that. Overlapping
// matches stack into lanes (LANE_PX tall each).
const HOUR_PX = 148;
const QUARTER_PX = HOUR_PX / 4; // a 15-minute slot
const LANE_PX = 56;
const ROW_PAD = 8;
const CARD_GAP = 14; // vertical gap between stacked lanes, so cards never touch
const LABEL_W = 172;
const HEADER_H = 34;
const QUARTERS = [0, 1, 2, 3] as const;

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fixtureDuration = (f: GridFixture) => (f.duration_minutes && f.duration_minutes > 0 ? f.duration_minutes : DEFAULT_DURATION);

function matchLabel(f: GridFixture): string {
  if (f.home || f.away) return `${f.home?.name ?? 'TBD'} v ${f.away?.name ?? 'TBD'}`;
  return f.round || 'Match';
}

// "09:00–09:45" range label from a fixture's start + duration.
function timeRange(f: GridFixture): string {
  if (!f.scheduled_at) return '';
  const start = new Date(f.scheduled_at);
  const mins = fixtureDuration(f);
  const end = new Date(start.getTime() + mins * 60000);
  return `${hhmm(start)}–${hhmm(end)} · ${mins}m`;
}

// Knockout-stage matches carry a bracket position (QF/SF/final/round-of-N) or a
// 3rd-place label; everything else (round-robin "Round N", group "Pool A - Match N",
// incrementally-added league fixtures) is a league/group match.
const KNOCKOUT_ROUND = /^(final|sf|qf|r\d+|3rd place|bronze)\b/i;
function isKnockout(f: GridFixture): boolean {
  return f.bracket_position != null || (!!f.round && KNOCKOUT_ROUND.test(f.round.trim()));
}

// League-before-knockout rule (per sport): a knockout match (QF/SF/final) must not
// start before that sport's league/group matches, and a league match must not be
// pushed past the sport's knockout matches. Compares against already-scheduled
// fixtures of the same sport (across its disciplines); returns a human-readable
// reason if the proposed start breaks that order, else null.
function placementError(fixture: GridFixture, startMs: number, all: GridFixture[]): string | null {
  const sport = fixture.sport;
  if (!sport) return null; // can't attribute the fixture to a sport - don't block
  const sameSport = all.filter((f) => f.id !== fixture.id && f.sport === sport && f.scheduled_at);
  if (isKnockout(fixture)) {
    const leagueStarts = sameSport.filter((f) => !isKnockout(f)).map((f) => new Date(f.scheduled_at!).getTime());
    if (leagueStarts.length) {
      const latest = Math.max(...leagueStarts);
      if (startMs < latest) {
        return `Knockout matches can't be scheduled before the ${sport} league stage. The last league match starts ${fmtDateTime(new Date(latest))} - pick a later time.`;
      }
    }
  } else {
    const koStarts = sameSport.filter(isKnockout).map((f) => new Date(f.scheduled_at!).getTime());
    if (koStarts.length) {
      const earliest = Math.min(...koStarts);
      if (startMs > earliest) {
        return `League matches must be scheduled before the ${sport} knockout stage. The first knockout match starts ${fmtDateTime(new Date(earliest))} - pick an earlier time.`;
      }
    }
  }
  return null;
}

// Lay a row's matches onto horizontal lanes: each match spans [start, start+duration)
// minutes; overlapping matches drop into the next free lane (calendar style) so a
// 60-minute match always shows its full width and clashes are both visible.
function packRow(items: GridFixture[]) {
  const ev = items
    .map((f) => {
      const d = new Date(f.scheduled_at!);
      const start = d.getHours() * 60 + d.getMinutes();
      return { f, start, end: start + fixtureDuration(f) };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds: number[] = [];
  const placed = ev.map((it) => {
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.end); }
    else laneEnds[lane] = it.end;
    return { ...it, lane };
  });
  return { placed, lanes: Math.max(1, laneEnds.length) };
}

// A match counts as LIVE only when BOTH hold: scoring has been started (status 'live')
// AND the clock is within its scheduled window [start, end]. So a match flipped live
// early (before its slot) or left live long after it ended doesn't pulse forever - it
// goes live as its datetime arrives and drops out once the end time passes.
function isLiveNow(f: GridFixture, now: number): boolean {
  if (f.status !== 'live' || !f.scheduled_at) return false;
  const start = new Date(f.scheduled_at).getTime();
  const end = start + fixtureDuration(f) * 60000;
  return now >= start && now <= end;
}

// Compact status marker shown on the card (so completed/postponed/etc. are clearly
// labelled, not just colour-coded). Returns null for the default "scheduled" look.
function statusChip(status: string): { text: string; cls: string } | null {
  switch (status) {
    case 'completed': return { text: 'Completed', cls: 'text-emerald-700 dark:text-emerald-400' };
    case 'walkover': return { text: 'Walkover', cls: 'text-emerald-700 dark:text-emerald-400' };
    case 'postponed': return { text: 'Postponed', cls: 'text-slate-500 dark:text-slate-400' };
    case 'cancelled': return { text: 'Cancelled', cls: 'text-slate-500 dark:text-slate-400' };
    case 'bye': return { text: 'Bye', cls: 'text-slate-500 dark:text-slate-400' };
    default: return null; // scheduled, or live-but-outside-its-window
  }
}

// Status → card tint. `live` (the start+end window is current AND recording) wins; then
// resolved states read green/grey, and everything else is the "to-do" amber.
function cardTint(status: string, live: boolean): string {
  if (live) return 'border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10';
  switch (status) {
    case 'completed':
    case 'walkover':
      return 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10';
    case 'bye':
      return 'border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/60';
    case 'postponed':
    case 'cancelled':
      return 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60';
    default:
      return 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10';
  }
}

// Knockout rounds are labelled by the number of teams remaining (R16, QF = 8,
// SF = 4, Final = 2; "3rd Place" is the consolation). Map a label to that count so
// the unscheduled list can be ordered by play order.
function knockoutTeams(round: string): number | null {
  const s = round.trim().toLowerCase();
  if (s === 'final' || s === 'f') return 2;
  if (s.includes('3rd') || s.includes('third')) return 3; // consolation - just before the final
  if (s.startsWith('sf') || s.includes('semi')) return 4;
  if (s.startsWith('qf') || s.includes('quarter')) return 8;
  const m = s.match(/^r(\d+)$/); // R16, R32, R64…
  if (m) return Number(m[1]);
  return null;
}

// Sort key that puts a discipline's matches in play order: pool/league rounds first,
// then the knockout bracket biggest-first (R32 → R16 → QF → SF → 3rd Place → Final).
function roundSortKey(round: string | null | undefined): number {
  const r = (round ?? '').trim();
  if (!r) return 9000; // unlabelled "Match" sorts last
  const pool = r.match(/^(?:pool|group)\s+([a-z])\b.*?(\d+)?\s*$/i);
  if (pool) return 1000 + (pool[1].toUpperCase().charCodeAt(0) - 65) * 100 + (pool[2] ? Number(pool[2]) : 0);
  const rr = r.match(/^round\s+(\d+)/i);
  if (rr) return 1000 + Number(rr[1]);
  const ko = knockoutTeams(r);
  if (ko != null) return 5000 - ko; // more teams remaining ⇒ earlier round
  return 9000;
}

// Discipline × time scheduler (horizontal gantt). Rows are the championship's
// disciplines; time runs left→right with one column per hour, each split into four
// 15-minute slots. Tap an empty slot (managers only) to place one of that discipline's
// unscheduled matches there; drag a placed match to another slot to move it, or click
// it to change its time/duration or unschedule it.
export function ScheduleTimeline({ rows, fixtures, days, canManage, onPlace, onUnschedule, placing }: {
  rows: DisciplineRow[];
  fixtures: GridFixture[];
  days: string[];
  canManage: boolean;
  onPlace: (fixtureId: string, startISO: string, durationMinutes: number) => void;
  onUnschedule?: (fixtureId: string) => void;
  placing?: boolean;
}) {
  const [day, setDay] = useState('');
  const activeDay = day && days.includes(day) ? day : days[0] ?? '';
  const [slot, setSlot] = useState<{ row: DisciplineRow; hour: number; minute: number } | null>(null);
  const [editing, setEditing] = useState<GridFixture | null>(null);
  // Re-render every 30s so a match flips to LIVE the moment its start time arrives and
  // drops out once its end passes, without needing a manual refresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const unscheduledCount = useMemo(() => fixtures.filter((f) => !f.scheduled_at).length, [fixtures]);

  // Hour columns to render: the default 8–20 window, widened to cover any match that
  // starts earlier or runs later on the active day.
  const hours = useMemo(() => {
    let lo = DEFAULT_START_HOUR;
    let hi = DEFAULT_END_HOUR;
    for (const f of fixtures) {
      if (!f.scheduled_at) continue;
      const d = new Date(f.scheduled_at);
      if (dayKey(d) !== activeDay) continue;
      lo = Math.min(lo, d.getHours());
      const endHour = new Date(d.getTime() + fixtureDuration(f) * 60000);
      hi = Math.max(hi, endHour.getMinutes() > 0 ? endHour.getHours() : endHour.getHours() - 1);
    }
    lo = Math.max(0, lo);
    hi = Math.min(23, Math.max(hi, lo));
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [fixtures, activeDay]);
  const startHour = hours[0] ?? DEFAULT_START_HOUR;
  const trackW = hours.length * HOUR_PX;

  const dayFixtures = (rowId: string) => fixtures.filter((f) => {
    if (f.tournament_discipline_id !== rowId || !f.scheduled_at) return false;
    return dayKey(new Date(f.scheduled_at)) === activeDay;
  });
  const rowUnscheduled = (rowId: string) => fixtures.filter((f) => f.tournament_discipline_id === rowId && !f.scheduled_at);

  // Run the league-before-knockout check, then place (or surface why not). Returns
  // false when the placement was rejected so callers (modals) can stay open.
  const tryPlace = (fixtureId: string, startISO: string, durationMinutes: number): boolean => {
    const f = fixtures.find((x) => x.id === fixtureId);
    const err = f ? placementError(f, new Date(startISO).getTime(), fixtures) : null;
    if (err) { toast.error(err); return false; }
    onPlace(fixtureId, startISO, durationMinutes);
    return true;
  };

  // Drag a placed match onto an empty slot to reschedule it - accepted only within the
  // match's own discipline row (we move it in time, not across draws).
  const onCardDragStart = (ev: DragEvent, f: GridFixture) => {
    ev.dataTransfer.setData('text/plain', f.id);
    ev.dataTransfer.effectAllowed = 'move';
  };
  const onSlotDrop = (ev: DragEvent, rowId: string, hour: number, minute: number) => {
    ev.preventDefault();
    const id = ev.dataTransfer.getData('text/plain');
    const f = fixtures.find((x) => x.id === id);
    if (!f || f.tournament_discipline_id !== rowId) return;
    const [y, mo, d] = activeDay.split('-').map(Number);
    const startISO = new Date(y, mo - 1, d, hour, minute).toISOString();
    tryPlace(id, startISO, fixtureDuration(f));
  };

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

      {/* Single scroll box so the header row and discipline column can stay pinned. */}
      <div className="max-h-[68vh] overflow-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div style={{ width: LABEL_W + trackW }}>
          {/* Header: sticky on vertical scroll; the corner cell also sticks left. */}
          <div className="sticky top-0 z-30 flex border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="sticky left-0 z-10 flex items-center border-r border-slate-200 bg-white px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500"
              style={{ width: LABEL_W, minWidth: LABEL_W, height: HEADER_H }}>
              Discipline / time
            </div>
            <div className="relative" style={{ width: trackW, height: HEADER_H }}>
              {hours.map((h, hi) => (
                <div key={h} className="absolute top-0 flex h-full items-center justify-center border-l border-slate-100 text-xs font-bold text-slate-500 dark:border-slate-800 dark:text-slate-400"
                  style={{ left: hi * HOUR_PX, width: HOUR_PX }}>{pad(h)}:00</div>
              ))}
            </div>
          </div>

          {/* Rows */}
          {rows.map((row) => {
            const { placed, lanes } = packRow(dayFixtures(row.id));
            const rowH = lanes * LANE_PX + ROW_PAD * 2;
            return (
              <div key={row.id} className="flex border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                <div className="sticky left-0 z-20 border-r border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900" style={{ width: LABEL_W, minWidth: LABEL_W }}>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{row.sport} · {row.discipline}</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500">{row.format ?? row.entry_type ?? ''}</div>
                </div>
                <div className="relative" style={{ width: trackW, height: rowH }}>
                  {/* 15-minute slots: click to schedule, or drop a match here. */}
                  {hours.map((h, hi) => QUARTERS.map((q) => (
                    canManage ? (
                      <button
                        key={`${h}-${q}`}
                        type="button"
                        onClick={() => setSlot({ row, hour: h, minute: q * 15 })}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => onSlotDrop(e, row.id, h, q * 15)}
                        aria-label={`Schedule ${row.sport} ${row.discipline} at ${pad(h)}:${pad(q * 15)}`}
                        className={cn(
                          'group absolute top-0 grid place-items-center text-slate-300 transition-colors hover:bg-brand-50 dark:text-slate-600 dark:hover:bg-brand-500/10',
                          q === 0 ? 'border-l border-slate-200 dark:border-slate-700/80' : 'border-l border-dashed border-slate-100 dark:border-slate-800/60',
                        )}
                        style={{ left: hi * HOUR_PX + q * QUARTER_PX, width: QUARTER_PX, height: rowH }}
                      >
                        <span className="text-xs opacity-0 transition-opacity group-hover:opacity-100">+</span>
                      </button>
                    ) : (
                      <div key={`${h}-${q}`} className={cn('absolute top-0', q === 0 ? 'border-l border-slate-200 dark:border-slate-700/80' : 'border-l border-dashed border-slate-100 dark:border-slate-800/60')}
                        style={{ left: hi * HOUR_PX + q * QUARTER_PX, width: QUARTER_PX, height: rowH }} />
                    )
                  )))}

                  {/* Placed matches: width = duration, lane = overlap row. */}
                  {placed.map(({ f, start, lane }) => {
                    const left = ((start - startHour * 60) / 60) * HOUR_PX;
                    const width = Math.max(QUARTER_PX - 2, (fixtureDuration(f) / 60) * HOUR_PX - 2);
                    const wide = width >= 116;
                    const live = isLiveNow(f, now);
                    const chip = statusChip(f.status);
                    return (
                      <div
                        key={f.id}
                        draggable={canManage}
                        onDragStart={canManage ? (ev) => onCardDragStart(ev, f) : undefined}
                        onClick={canManage ? () => setEditing(f) : undefined}
                        title={`${matchLabel(f)} · ${timeRange(f)} · ${live ? 'live' : f.status}`}
                        className={cn(
                          'absolute z-10 flex flex-col justify-center overflow-hidden rounded-lg border px-1.5',
                          cardTint(f.status, live),
                          canManage && 'cursor-pointer hover:shadow-sm hover:brightness-95',
                        )}
                        style={{ left, width, top: ROW_PAD + lane * LANE_PX, height: LANE_PX - CARD_GAP }}
                      >
                        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          <span>{f.sport_icon ?? '•'}</span><span className="truncate">{f.round || 'Match'}</span>
                          {live ? (
                            <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[9px] text-rose-600 dark:text-rose-400"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />LIVE</span>
                          ) : wide && chip ? (
                            <span className={cn('ml-auto shrink-0 text-[9px] font-bold', chip.cls)}>{chip.text}</span>
                          ) : null}
                        </div>
                        <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{matchLabel(f)}</div>
                        {wide && <div className="truncate text-[10px] text-slate-400 dark:text-slate-500">{timeRange(f)}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {canManage && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Time runs left to right - each hour column is split into four 15-minute slots, so a match's width is its duration (a 60-minute match fills an hour, a 15-minute one a quarter). Tap an empty slot to schedule a match, drag a placed match to move it, or click it to change its time, duration or unschedule it.
        </p>
      )}

      {slot && (
        <PlaceModal
          slot={slot}
          activeDay={activeDay}
          matches={rowUnscheduled(slot.row.id)}
          placing={placing}
          onClose={() => setSlot(null)}
          onPlace={tryPlace}
        />
      )}

      {editing && (
        <EditTimingModal
          fixture={editing}
          days={days}
          activeDay={activeDay}
          placing={placing}
          onClose={() => setEditing(null)}
          onPlace={tryPlace}
          onUnschedule={onUnschedule}
        />
      )}
    </div>
  );
}

// Schedule-a-match modal: pick one of the discipline's unscheduled matches, set the
// exact start time (seeded from the tapped slot) and a duration, then place it.
function PlaceModal({ slot, activeDay, matches, placing, onClose, onPlace }: {
  slot: { row: DisciplineRow; hour: number; minute: number };
  activeDay: string;
  matches: GridFixture[];
  placing?: boolean;
  onClose: () => void;
  onPlace: (fixtureId: string, startISO: string, durationMinutes: number) => boolean;
}) {
  const [time, setTime] = useState(`${pad(slot.hour)}:${pad(slot.minute)}`);
  const [duration, setDuration] = useState(DEFAULT_DURATION);

  // List the discipline's unscheduled matches in play order: pool/league rounds
  // first, then the knockout bracket biggest-first (R16 → QF → SF → Final).
  const ordered = useMemo(
    () => [...matches].sort((a, b) => roundSortKey(a.round) - roundSortKey(b.round)),
    [matches],
  );

  const place = (fixtureId: string) => {
    const [y, mo, d] = activeDay.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const startISO = new Date(y, mo - 1, d, hh || 0, mm || 0).toISOString();
    // Stay on the modal so the organiser can keep placing matches (the placed one
    // drops out of the list as the fixtures refetch). On a rejected place, leave the
    // time alone so the toast is actionable; on success, roll the start time forward
    // by this match's duration so the next match lands in the following slot.
    if (!onPlace(fixtureId, startISO, duration)) return;
    const next = Math.min((hh || 0) * 60 + (mm || 0) + duration, 23 * 60 + 45);
    setTime(`${pad(Math.floor(next / 60))}:${pad(next % 60)}`);
  };

  return (
    <Modal title="Schedule a match" onClose={onClose}
      footer={<div className="flex justify-end"><Button variant="ghost" onClick={onClose}>Done</Button></div>}>
      <p className="-mt-2 mb-3 text-sm text-slate-500 dark:text-slate-400">{slot.row.sport} · {slot.row.discipline} · {fmtDate(activeDay)}</p>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Field label="Start time">
          <input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)}
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
          {ordered.map((f) => (
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

// Edit the timing of a placed match straight from the timeline: change its day, start
// time or duration, or unschedule it (sending it back to the unscheduled pool).
function EditTimingModal({ fixture, days, activeDay, placing, onClose, onPlace, onUnschedule }: {
  fixture: GridFixture;
  days: string[];
  activeDay: string;
  placing?: boolean;
  onClose: () => void;
  onPlace: (fixtureId: string, startISO: string, durationMinutes: number) => boolean;
  onUnschedule?: (fixtureId: string) => void;
}) {
  const cur = fixture.scheduled_at ? new Date(fixture.scheduled_at) : null;
  const [day, setDay] = useState(cur ? dayKey(cur) : activeDay);
  const [time, setTime] = useState(cur ? hhmm(cur) : '09:00');
  const [duration, setDuration] = useState(fixtureDuration(fixture));

  const save = () => {
    const [y, mo, d] = day.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const startISO = new Date(y, mo - 1, d, hh || 0, mm || 0).toISOString();
    // Keep the modal open if the placement was rejected (so the toast is actionable).
    if (onPlace(fixture.id, startISO, duration)) onClose();
  };
  const unschedule = () => { onUnschedule?.(fixture.id); onClose(); };

  return (
    <Modal title={`Edit timing · ${matchLabel(fixture)}`} onClose={onClose}>
      {days.length > 1 && (
        <Field label="Day">
          <Select value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start time">
          <input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
        </Field>
        <Field label="Duration">
          <Select value={String(duration)} onChange={(e) => setDuration(Number(e.target.value))}>
            {DURATION_OPTIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
          </Select>
        </Field>
      </div>
      <div className="mt-3 flex items-center justify-between">
        {onUnschedule ? (
          <Button variant="ghost" className="text-rose-600 dark:text-rose-400" disabled={placing} onClick={unschedule}>Unschedule</Button>
        ) : <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={placing} onClick={save}>{placing ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}
