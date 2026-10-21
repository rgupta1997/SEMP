import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useApi, fmtDateTime } from '../../lib/hooks';
import { titleCase } from '../../lib/format';
import { BackButton, Card, CardBody, CardHeader, EmptyState, Spinner, StatusBadge } from '../../components/ui';
import { ResultBadge } from '../../components/participant/ResultBadge';
import type { MatchResult } from '../../components/participant/types';
import { formatPoints, TBD_LABEL, type MatchOutcome } from '@semp/shared';

interface MatchDetail {
  fixture: {
    id: string;
    round: string | null;
    status: string;
    scheduled_at: string | null;
    duration_minutes: number | null;
    notes: string | null;
    home_score: number | null;
    away_score: number | null;
    my_score: number | null;
    opp_score: number | null;
    pens?: [number, number] | null;
    result: MatchResult;
    venue: { ground: string | null; venue_name: string | null; city: string | null } | null;
    sport: string | null;
    discipline: string | null;
    tournament: string | null;
    championship: { id: string; name: string; slug: string } | null;
    my_team: { id: string; name: string; organization: string | null };
    opponent: { id: string; name: string; organization: string | null } | null;
    my_role: string | null;
    jersey_number: number | null;
    teammates: { name: string; phone: string | null; role: string; jersey_number: number | null }[];
    former_member?: boolean;
  };
  /**
   * The player's own numbers; null if not in the match. `played: false` = named but didn't
   * take part, distinct from scoring nothing (no duck for someone who never batted).
   */
  my_stats?: {
    played: boolean;
    outcome: MatchOutcome | null;
    position: string | null;
    /** False while the result can still change - said out loud, not implied. */
    official: boolean;
    groups: { title: string; items: { label: string; value: string | number }[] }[];
    note?: string;
  } | null;
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right font-medium text-slate-800 dark:text-slate-200">{value || '-'}</span>
    </div>
  );
}

export function ParticipantMatchPage() {
  const { fixtureId } = useParams();
  const { data, isLoading, error } = useApi<MatchDetail>(`/me/matches/${fixtureId}`);

  if (isLoading) return <Spinner />;
  if (error || !data) {
    return <EmptyState icon="⚑" title="Match not available" description="This match doesn't exist or you're not part of it." />;
  }

  const f = data.fixture;
  const venue = f.venue ? [f.venue.ground, f.venue.venue_name, f.venue.city].filter(Boolean).join(', ') : null;
  const subtitle = [f.sport, f.discipline].filter(Boolean).join(' · ');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        {/* The championship page stays closed to someone who has left the squad - their list of matches is where they go back to. */}
        {f.former_member ? (
          <BackButton to="/profile/matches" className="mb-0">Back to your matches</BackButton>
        ) : f.championship ? (
          <BackButton to={`/profile/championships/${f.championship.id}`} className="mb-0">Back to championship</BackButton>
        ) : (
          <BackButton to="/profile/matches" className="mb-0">All matches</BackButton>
        )}
        <StatusBadge status={f.status} />
      </div>

      <Card>
        <CardBody className="pt-5">
          <div className="text-center text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {f.championship?.name}{subtitle ? ` · ${subtitle}` : ''}
          </div>
          {f.round && <div className="mt-1 text-center text-sm text-slate-500 dark:text-slate-400">{f.round} · {fmtDateTime(f.scheduled_at)}</div>}

          <div className="mt-5 flex items-center justify-center gap-6">
            <div className="flex-1 text-right">
              <div className="font-bold text-slate-900 dark:text-slate-100">{f.my_team.name}</div>
              {f.my_team.organization && <div className="text-xs text-slate-400 dark:text-slate-500">{f.my_team.organization}</div>}
            </div>
            <div className="flex items-center gap-3 text-3xl font-black tabular-nums text-slate-900 dark:text-slate-100">
              <span>{f.my_score != null ? formatPoints(f.my_score) : '–'}</span>
              <span className="text-slate-300 dark:text-slate-600">:</span>
              <span>{f.opp_score != null ? formatPoints(f.opp_score) : '–'}</span>
            </div>
            <div className="flex-1 text-left">
              <div className="font-bold text-slate-900 dark:text-slate-100">{f.opponent?.name ?? TBD_LABEL}</div>
              {f.opponent?.organization && <div className="text-xs text-slate-400 dark:text-slate-500">{f.opponent.organization}</div>}
            </div>
          </div>

          {f.pens && (
            <div className="mt-2 text-center text-sm font-semibold text-brand-600 dark:text-brand-400">
              {f.result === 'won' ? 'Won' : 'Lost'} {f.pens[0]}–{f.pens[1]} on penalties
            </div>
          )}
          <div className="mt-4 flex justify-center">
            <ResultBadge result={f.result} />
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Match details" />
          <CardBody className="pt-0">
            <Detail label="Season" value={f.tournament} />
            <Detail label="Venue" value={venue} />
            <Detail label="When" value={fmtDateTime(f.scheduled_at)} />
            <Detail label="Duration" value={f.duration_minutes ? `${f.duration_minutes} min` : null} />
            <Detail label="Your team" value={f.my_team.name} />
            <Detail label="Your role" value={[titleCase(f.my_role), f.jersey_number != null ? `#${f.jersey_number}` : null].filter(Boolean).join(' · ')} />
            {f.notes && <Detail label="Notes" value={f.notes} />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Your team" subtitle={f.my_team.name} />
          <CardBody className="pt-0">
            {f.teammates.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">
                {f.former_member ? "You're no longer on this squad." : 'No roster recorded.'}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {f.teammates.map((t, i) => (
                  <li key={i} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">{t.name}</span>
                      {/* Teammates' phone numbers hidden here; the API still returns them. */}
                    </span>
                    <span className="text-slate-400 dark:text-slate-500">
                      {titleCase(t.role)}{t.jersey_number != null ? ` · #${t.jersey_number}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <MyStatsCard stats={data.my_stats} />
      </div>
    </div>
  );
}

/**
 * Rendered from the API's groups, not a per-sport layout, so one shape fits every sport.
 * Absent when the sport records no individual detail - an empty card would read as broken.
 */
function MyStatsCard({ stats }: { stats?: MatchDetail['my_stats'] }) {
  if (!stats) return null;

  return (
    <Card>
      <CardHeader
        title="Your statistics"
        subtitle={stats.official
          ? 'From the official result.'
          : 'Provisional - this result has not been made official yet.'}
      />
      <CardBody>
        {stats.note && (
          <p className="text-sm text-slate-400 dark:text-slate-500">{stats.note}</p>
        )}
        {stats.groups.map((g) => (
          <div key={g.title} className="mb-4 last:mb-0">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {g.title}
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {g.items.map((it) => (
                <Detail key={it.label} label={it.label} value={String(it.value)} />
              ))}
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
