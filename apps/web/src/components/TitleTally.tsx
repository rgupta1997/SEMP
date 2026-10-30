import { useState } from 'react';
import { formatPoints } from '@semp/shared';
import { Badge, Segmented } from './ui';

// Ranking sports (swimming, powerlifting) on the Results page: a master tally per title
// (each club's place in every event, the total, and what the title pays), and each
// event's own standing for its Point tally tab. Data: GET /championships/:id/title-tally.

type EventState = 'signed_off' | 'in_progress' | 'not_started';
interface TallyEvent { draw_id: string; name: string; share: number; state: EventState }
interface TallyRow {
  entity_id: string; name: string; short_name: string | null; cells: Record<string, { place: number | null; points: number }>;
  total: number; gold: number; silver: number; bronze: number; rank: number; title_points: number | null;
}
interface TallyTitle { name: string; label: string; events: TallyEvent[]; rows: TallyRow[] }
export interface SportTally { sport_id: string; sport: string; titles_on: boolean; titles: TallyTitle[] }
export interface EventTally {
  draw_id: string; sport_id: string; name: string; state: EventState;
  rows: Array<{ entity_id: string; name: string; short_name: string | null; place: number | null; points: number; medal: 'gold' | 'silver' | 'bronze' | null }>;
}
export interface TitleTallyResponse { sports: SportTally[]; events: EventTally[] }

export const titleTallyPath = (eventId: string) => `/championships/${eventId}/title-tally`;

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
const STATE_LABEL: Record<EventState, string> = { signed_off: '', in_progress: 'in progress', not_started: 'not started' };
const MEDAL: Record<'gold' | 'silver' | 'bronze', string> = { gold: '🥇', silver: '🥈', bronze: '🥉' };

/** A sport has something to show once any of its titles has a club in it. */
export const hasTally = (s?: SportTally) => !!s && s.titles.some((t) => t.rows.length > 0);

export function TitleTallyCard({ tally }: { tally: SportTally }) {
  const titles = tally.titles.filter((t) => t.rows.length > 0 || t.events.length > 0);
  const [active, setActive] = useState(titles[0]?.name ?? '');
  const title = titles.find((t) => t.name === active) ?? titles[0];
  if (!title) return null;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {tally.sport} · {tally.titles_on ? 'Title tally' : 'Sport tally'}
        </span>
        {titles.length > 1 && (
          <Segmented size="sm" value={title.name} onChange={setActive}
            options={titles.map((t) => ({ value: t.name, label: t.label }))} />
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
              <th className="px-3 py-1.5 text-left">#</th>
              <th className="px-2 py-1.5 text-left">Club</th>
              {title.events.map((e) => (
                <th key={e.draw_id} className="whitespace-nowrap px-2 py-1.5 text-center normal-case" title={e.share < 1 ? 'Counts half toward this title' : undefined}>
                  <span className="font-semibold">{e.name}{e.share < 1 ? ' ½' : ''}</span>
                  {STATE_LABEL[e.state] && <span className="block text-[10px] font-normal text-slate-400">{STATE_LABEL[e.state]}</span>}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right">Total</th>
              <th className="px-2 py-1.5 text-right" title="1st places">1sts</th>
              <th className="px-2 py-1.5 text-right" title="2nd places">2nds</th>
              <th className="px-2 py-1.5 text-right" title="3rd places (shown for the full medal count; not a tie-breaker)">3rds</th>
              {tally.titles_on && <th className="px-3 py-1.5 text-right">Title pts</th>}
            </tr>
          </thead>
          <tbody>
            {title.rows.map((r) => (
              <tr key={r.entity_id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-1.5 text-slate-400">{r.rank}</td>
                <td className="max-w-[12rem] truncate px-2 py-1.5 font-medium text-slate-800 dark:text-slate-100" title={r.name}>{r.name}</td>
                {title.events.map((e) => {
                  const c = r.cells[e.draw_id];
                  return (
                    <td key={e.draw_id} className="whitespace-nowrap px-2 py-1.5 text-center tabular-nums text-slate-700 dark:text-slate-200"
                      title={c ? `${formatPoints(c.points)} event points${e.share < 1 ? ', half counted' : ''}` : undefined}>
                      {c?.place != null ? ordinal(c.place) : <span className="text-slate-400">-</span>}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-slate-900 dark:text-white">{formatPoints(r.total)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.gold}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.silver}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.bronze}</td>
                {tally.titles_on && (
                  <td className="px-3 py-1.5 text-right">
                    {r.title_points ? <Badge tone="brand">{formatPoints(r.title_points)}</Badge> : <span className="text-slate-400">0</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
        Each event column is the club's finishing place. Total adds up the event points{title.events.some((e) => e.share < 1) ? ' (½ events count half)' : ''};
        level totals go by more 1sts, then more 2nds (3rds are shown for the full count only).{tally.titles_on ? ' Title pts is what this title pays to the overall table.' : ' Titles are off for this sport, so event points go straight to the overall table.'}
      </p>
    </div>
  );
}

/** One ranking event's own standing (its Point tally tab). */
export function EventTallyTable({ event }: { event: EventTally }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{event.name}</span>
        {event.state === 'signed_off' ? <Badge tone="green">Signed off</Badge> : <Badge tone="slate">{STATE_LABEL[event.state]}</Badge>}
      </div>
      {event.rows.length === 0 ? (
        <p className="px-3 py-3 text-sm text-slate-400">No results yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                <th className="px-3 py-1.5 text-left">Place</th>
                <th className="px-2 py-1.5 text-left">Club</th>
                <th className="px-2 py-1.5 text-right">Event pts</th>
                <th className="px-3 py-1.5 text-right">Medal</th>
              </tr>
            </thead>
            <tbody>
              {event.rows.map((r) => (
                <tr key={r.entity_id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-1.5 text-slate-500">{r.place != null ? ordinal(r.place) : '-'}</td>
                  <td className="max-w-[12rem] truncate px-2 py-1.5 font-medium text-slate-800 dark:text-slate-100" title={r.name}>{r.name}</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatPoints(r.points)}</td>
                  <td className="px-3 py-1.5 text-right">{r.medal ? MEDAL[r.medal] : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
