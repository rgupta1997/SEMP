import { Link } from 'react-router-dom';
import { Clock, MapPin, Radio, UserCheck } from 'lucide-react';
import { useApi, fmtDate, fmtDateTime } from '../../lib/hooks';
import { Badge, Card, CardBody, EmptyState, PageHeader, Spinner } from '../../components/ui';
import { useEvent } from './EventLayout';

// One screen showing every match in progress (J2-E6-S1).
//
// Polls rather than pushes: the API runs on Lambda with no long-lived process,
// so websockets are not available to it, and a few seconds of staleness on a
// scoreboard costs nothing. The interval is deliberately modest — this is a page
// an organiser leaves open all day.

const REFRESH_MS = 15_000;

interface LiveFixture {
  id: string;
  status: string;
  round: string | null;
  sport: string | null;
  sport_icon: string | null;
  discipline: string | null;
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
  venue: string | null;
  official: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  elapsed_minutes: number | null;
  /** Marked live for longer than any match runs - almost certainly never closed. */
  stale: boolean;
}

interface LivePayload { live: LiveFixture[]; next: LiveFixture[]; as_of: string }

function Score({ f }: { f: LiveFixture }) {
  if (f.home_score == null && f.away_score == null) {
    return <span className="text-sm text-slate-400 dark:text-slate-500">No score yet</span>;
  }
  return <span className="text-2xl font-bold tabular-nums">{f.home_score ?? 0} – {f.away_score ?? 0}</span>;
}

function Meta({ f }: { f: LiveFixture }) {
  const context = [f.sport, f.discipline, f.round].filter(Boolean).join(' · ');
  return (
    <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
      {context && <div>{context}</div>}
      {f.venue && <div className="flex items-center gap-1"><MapPin size={11} aria-hidden />{f.venue}</div>}
      {f.official && <div className="flex items-center gap-1"><UserCheck size={11} aria-hidden />{f.official}</div>}
    </div>
  );
}

export function LivePage() {
  const { eventId, canManage } = useEvent();
  const { data, isLoading } = useApi<LivePayload>(
    eventId ? `/championships/${eventId}/live` : null,
    true,
    { refetchInterval: REFRESH_MS },
  );

  if (isLoading && !data) return <Spinner />;
  const live = data?.live ?? [];
  const next = data?.next ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Live"
        subtitle={`Every match in progress. Refreshes every ${REFRESH_MS / 1000} seconds.`}
      />

      {live.length === 0 ? (
        <EmptyState
          icon={<Radio size={24} />}
          title="Nothing is live right now"
          // Never a bare "no data": between sessions the organiser needs to know
          // what is coming, not that the page still works.
          description={next.length > 0 ? 'Here is what is coming up next.' : 'Matches appear here as officials start them.'}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {live.map((f) => {
            const card = (
              <Card key={f.id} interactive className="h-full">
                <CardBody className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    {/* A stale card is a to-do, not a scoreboard: it says the
                        match needs closing rather than pretending it is running. */}
                    <Badge tone={f.stale ? 'amber' : 'live'}>{f.stale ? 'Not closed' : 'Live'}</Badge>
                    {f.stale ? (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        Started {f.started_at ? fmtDate(f.started_at) : 'a while ago'}
                      </span>
                    ) : f.elapsed_minutes != null && (
                      <span className="flex items-center gap-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                        <Clock size={11} aria-hidden />{f.elapsed_minutes}′
                      </span>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    <div className="truncate text-sm font-semibold">{f.home_team ?? 'TBD'}</div>
                    <div className="truncate text-sm font-semibold">{f.away_team ?? 'TBD'}</div>
                  </div>
                  <Score f={f} />
                  <Meta f={f} />
                </CardBody>
              </Card>
            );
            // Clicking opens the console — but only for someone who may score it;
            // a spectator following the day gets the card without a dead link.
            return canManage
              ? <Link key={f.id} to={`/score/${f.id}`} className="block">{card}</Link>
              : <div key={f.id}>{card}</div>;
          })}
        </div>
      )}

      {next.length > 0 && (
        <Card>
          <CardBody className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Up next</h2>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {next.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {f.home_team ?? 'TBD'} vs {f.away_team ?? 'TBD'}
                    </div>
                    <Meta f={f} />
                  </div>
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                    {f.scheduled_at ? fmtDateTime(f.scheduled_at) : 'Unscheduled'}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
