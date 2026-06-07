import { useMemo, useState } from 'react';
import { fmtDate } from '../lib/hooks';
import { Badge, EmptyState, Segmented } from './ui';

export interface TimelineFixture {
  id: string;
  status: string;
  round?: string | null;
  scheduled_at: string | null;
  duration_minutes?: number | null;
  ground?: { id: string; name: string; venue?: string | null } | null;
  sport?: string | null;
  sport_icon?: string | null;
  discipline?: string | null;
  home?: { id: string; name: string } | null;
  away?: { id: string; name: string } | null;
}

// Known sport accent tokens (defined in index.css). Falls back to brand.
const SPORT_KEYS = ['cricket', 'football', 'basketball', 'volleyball', 'tennis', 'badminton', 'athletics', 'swimming', 'hockey', 'tabletennis'];
function sportColor(name?: string | null): string {
  const k = (name ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const match = SPORT_KEYS.find((s) => k.includes(s));
  return match ? `var(--sport-${match})` : 'var(--color-brand-500)';
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
const PX_PER_MIN = 2.2;       // horizontal scale
const LANE_LABEL_W = 150;     // px

// Broadcast-style Gantt of an event's scheduled fixtures: ground lanes × time,
// sport-coloured blocks, and a live "now" marker.
export function ScheduleTimeline({ fixtures }: { fixtures: TimelineFixture[] }) {
  const scheduled = useMemo(() => fixtures.filter((f) => f.scheduled_at && f.ground), [fixtures]);

  const days = useMemo(() => {
    const set = new Set<string>();
    scheduled.forEach((f) => set.add(dayKey(new Date(f.scheduled_at!))));
    return [...set].sort();
  }, [scheduled]);

  const [day, setDay] = useState('');
  const activeDay = day && days.includes(day) ? day : days[0] ?? '';

  const dayFixtures = useMemo(
    () => scheduled.filter((f) => dayKey(new Date(f.scheduled_at!)) === activeDay),
    [scheduled, activeDay],
  );

  // Lanes = grounds with fixtures on this day, grouped by venue.
  const lanes = useMemo(() => {
    const map = new Map<string, { id: string; name: string; venue?: string | null }>();
    dayFixtures.forEach((f) => { if (f.ground) map.set(f.ground.id, f.ground); });
    return [...map.values()].sort((a, b) => `${a.venue ?? ''}${a.name}`.localeCompare(`${b.venue ?? ''}${b.name}`));
  }, [dayFixtures]);

  // Time window: snap to the hour around the day's earliest/latest blocks.
  const { startMin, spanMin, hours } = useMemo(() => {
    if (dayFixtures.length === 0) return { startMin: 8 * 60, spanMin: 12 * 60, hours: [] as number[] };
    let lo = Infinity, hi = -Infinity;
    for (const f of dayFixtures) {
      const s = minutesOfDay(new Date(f.scheduled_at!));
      lo = Math.min(lo, s);
      hi = Math.max(hi, s + (f.duration_minutes || 60));
    }
    const startH = Math.max(0, Math.floor(lo / 60) - 1);
    const endH = Math.min(24, Math.ceil(hi / 60) + 1);
    const hrs: number[] = [];
    for (let h = startH; h <= endH; h++) hrs.push(h);
    return { startMin: startH * 60, spanMin: (endH - startH) * 60, hours: hrs };
  }, [dayFixtures]);

  const gridWidth = spanMin * PX_PER_MIN;

  // Live marker (only if the active day is today and within the window).
  const now = new Date();
  const nowMin = minutesOfDay(now);
  const showNow = activeDay === dayKey(now) && nowMin >= startMin && nowMin <= startMin + spanMin;

  if (scheduled.length === 0) {
    return <EmptyState icon="⚑" title="Nothing scheduled yet" description="Generate draws and assign dates, times and grounds to see the timeline." />;
  }

  return (
    <div className="space-y-4">
      {days.length > 1 && (
        <Segmented
          value={activeDay}
          onChange={setDay}
          options={days.map((d) => ({ value: d, label: fmtDate(d) }))}
        />
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div style={{ minWidth: LANE_LABEL_W + gridWidth }}>
          {/* Hour ruler */}
          <div className="flex border-b border-slate-200 dark:border-slate-800">
            <div className="flex-none border-r border-slate-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800" style={{ width: LANE_LABEL_W }}>
              Venue · Ground
            </div>
            <div className="relative" style={{ width: gridWidth, height: 32 }}>
              {hours.map((h) => (
                <div key={h} className="absolute top-0 h-full border-l border-slate-100 dark:border-slate-800/80" style={{ left: (h * 60 - startMin) * PX_PER_MIN }}>
                  <span className="absolute left-1 top-1.5 font-mono text-[11px] text-slate-400 dark:text-slate-500">{String(h).padStart(2, '0')}:00</span>
                </div>
              ))}
            </div>
          </div>

          {/* Lanes */}
          {lanes.map((lane) => {
            const items = dayFixtures.filter((f) => f.ground?.id === lane.id);
            return (
              <div key={lane.id} className="flex border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                <div className="flex-none border-r border-slate-200 px-3 py-3 dark:border-slate-800" style={{ width: LANE_LABEL_W }}>
                  <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">{lane.name}</div>
                  {lane.venue && <div className="truncate text-xs text-slate-400 dark:text-slate-500">{lane.venue}</div>}
                </div>
                <div className="relative" style={{ width: gridWidth, minHeight: 64 }}>
                  {/* hour gridlines */}
                  {hours.map((h) => (
                    <div key={h} className="absolute top-0 h-full border-l border-slate-100 dark:border-slate-800/60" style={{ left: (h * 60 - startMin) * PX_PER_MIN }} />
                  ))}
                  {showNow && (
                    <div className="absolute top-0 z-10 h-full w-px bg-[var(--live)]" style={{ left: (nowMin - startMin) * PX_PER_MIN }}>
                      <span className="absolute -top-0.5 -left-1 h-2 w-2 rounded-full bg-[var(--live)]" />
                    </div>
                  )}
                  {items.map((f) => {
                    const s = minutesOfDay(new Date(f.scheduled_at!));
                    const dur = Math.max(30, f.duration_minutes || 60);
                    const color = sportColor(f.sport);
                    const live = f.status === 'live';
                    return (
                      <div
                        key={f.id}
                        title={`${f.sport ?? ''}${f.discipline ? ' · ' + f.discipline : ''}\n${f.home?.name ?? 'TBD'} vs ${f.away?.name ?? 'TBD'}`}
                        className="absolute top-2 overflow-hidden rounded-lg px-2 py-1 text-white shadow-sm"
                        style={{
                          left: (s - startMin) * PX_PER_MIN + 2,
                          width: dur * PX_PER_MIN - 4,
                          bottom: 8,
                          background: `linear-gradient(180deg, color-mix(in oklch, ${color} 92%, white 8%), ${color})`,
                          boxShadow: live ? '0 0 0 2px var(--live)' : undefined,
                        }}
                      >
                        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-90">
                          <span>{f.sport_icon ?? '•'}</span>
                          <span className="truncate">{f.round || f.discipline || f.sport}</span>
                          {live && <span className="ml-auto rounded-full bg-white/25 px-1 text-[9px]">LIVE</span>}
                        </div>
                        <div className="truncate text-xs font-semibold">{f.home?.name ?? 'TBD'} v {f.away?.name ?? 'TBD'}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sport legend */}
      <div className="flex flex-wrap gap-2">
        {[...new Set(dayFixtures.map((f) => f.sport).filter(Boolean))].map((s) => (
          <Badge key={s} tone="slate" className="gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: sportColor(s) }} />{s}
          </Badge>
        ))}
      </div>
    </div>
  );
}
