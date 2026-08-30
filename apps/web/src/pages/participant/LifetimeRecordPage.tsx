import { Clock, Medal, Trophy, ShieldCheck } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useApi, fmtDate } from '../../lib/hooks';
import {
  Badge, Card, CardBody, CardHeader, EmptyState, Spinner, StatCard, cn,
} from '../../components/ui';

// The lifetime record (J4-E2) - a player's permanent, verified sporting history.
//
// The page has NO edit affordance anywhere, and that is the feature. Every row
// here was written by the lock transaction from a result an organiser made
// official; the only way any of it changes is by correcting that result, which
// is audited. A pencil icon on this page would quietly turn an institutional
// record into a claim.
//
// The same component serves the player's own view and a coordinator's view of
// one of their players, from the same endpoint - so a coordinator can never be
// shown something the player cannot see about themselves.

interface Chip { kind: string; title: string; medal?: 'gold' | 'silver' | 'bronze'; placement?: string }

interface TimelineEntry {
  id: string;
  date: string;
  kind: string;
  title: string;
  /** false = played, but the organiser has not made it official yet. */
  verified: boolean;
  fixture_id: string | null;
  detail: {
    role?: string; team_name?: string | null; opponent_name?: string | null;
    outcome?: 'won' | 'lost' | 'drew' | null; score?: string | null; round?: string | null;
    sport?: string | null; discipline?: string | null; championship_name?: string | null;
    chips?: Chip[];
  } | null;
}

interface AchievementRecord {
  id: string; date: string; kind: string; medal: 'gold' | 'silver' | 'bronze' | null; title: string;
  detail: { placement?: string; sport?: string | null; championship_name?: string | null } | null;
}

interface Profile {
  person: { id: string; name: string; email: string | null; phone: string | null };
  stats: {
    events: number; won: number; lost: number; drew: number;
    medals: { gold: number; silver: number; bronze: number };
    awards: number; total_medals: number; provisional: number;
  };
  timeline: TimelineEntry[];
  achievements: AchievementRecord[];
}

const MEDAL_TONE = {
  gold: 'text-amber-500',
  silver: 'text-slate-400',
  bronze: 'text-orange-600 dark:text-orange-500',
} as const;

const OUTCOME_TONE: Record<string, string> = {
  won: 'text-emerald-600 dark:text-emerald-400',
  lost: 'text-rose-500 dark:text-rose-400',
  drew: 'text-slate-500 dark:text-slate-400',
};

function ChipRow({ chips }: { chips: Chip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((c, i) => (
        <Badge key={i} tone={c.medal === 'gold' ? 'amber' : c.kind === 'award' ? 'violet' : 'slate'}>
          <span className="flex items-center gap-1">
            {c.medal ? <Medal size={12} className={MEDAL_TONE[c.medal]} aria-hidden /> : <Trophy size={12} aria-hidden />}
            {c.title}
          </span>
        </Badge>
      ))}
    </div>
  );
}

export function LifetimeRecordPage() {
  // No :userId → the signed-in player's own record.
  const { userId } = useParams();
  const { data, isLoading, error } = useApi<Profile>(userId ? `/people/${userId}/profile` : '/me/profile');

  if (isLoading) return <Spinner />;
  if (error) {
    return (
      <EmptyState
        icon={<ShieldCheck size={24} />}
        title="This record is not yours to open"
        description="You can only view the record of someone in an institution you belong to."
      />
    );
  }
  if (!data) return null;

  const { stats, timeline, achievements } = data;

  return (
    <div className="space-y-5">
      {/* The totals count VERIFIED results only. The provisional hint is what
          keeps that from reading as data loss when a player can plainly see
          more matches on the timeline than the counter admits. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Verified events"
          value={stats.events}
          hint={stats.provisional > 0 ? `${stats.provisional} awaiting the organiser` : undefined}
        />
        <StatCard label="Won / Lost / Drew" value={`${stats.won} / ${stats.lost} / ${stats.drew}`} />
        <StatCard
          label="Medals"
          value={stats.total_medals}
          hint={stats.total_medals > 0 ? `${stats.medals.gold} gold · ${stats.medals.silver} silver · ${stats.medals.bronze} bronze` : undefined}
        />
        <StatCard label="Awards" value={stats.awards} />
      </div>

      {achievements.length > 0 && (
        <Card>
          <CardHeader title="Honours" subtitle="Every medal, placement and award, each tied to a verified result." />
          <CardBody className="pt-0">
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {achievements.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="flex min-w-0 items-start gap-2">
                    <Medal size={16} className={cn('mt-0.5 shrink-0', a.medal ? MEDAL_TONE[a.medal] : 'text-slate-400')} aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{a.title}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {[a.detail?.sport, fmtDate(a.date)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </span>
                  <Badge tone={a.kind === 'award' ? 'violet' : 'slate'}>{a.kind}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Timeline" subtitle="Most recent first. Verified entries are permanent; provisional ones can still change." />
        <CardBody className="pt-0">
          {timeline.length === 0 ? (
            <EmptyState
              icon={<Trophy size={24} />}
              title="Nothing here yet"
              description="Matches appear as soon as they are scored, and become permanent once the organiser locks the scorecard."
            />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {timeline.map((e) => {
                const d = e.detail ?? {};
                const meta = [d.championship_name, [d.sport, d.discipline].filter(Boolean).join(' · ') || null, d.round]
                  .filter(Boolean).join(' · ');
                return (
                  // A provisional row is dimmed rather than hidden: the player
                  // played the match and knows it, so the honest thing is to
                  // show it and say what is still missing.
                  <li key={e.id} className={cn('py-3', !e.verified && 'opacity-70')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={cn('truncate text-sm font-medium', d.outcome ? OUTCOME_TONE[d.outcome] : '')}>{e.title}</p>
                        {meta && <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{meta}</p>}
                        {/* Chips ride only on verified rows. A gold medal shown
                            against a scorecard the official can still edit is
                            exactly the claim this subsystem exists to avoid. */}
                        {e.verified && <ChipRow chips={d.chips ?? []} />}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-slate-500 dark:text-slate-400">{fmtDate(e.date)}</p>
                        {e.verified ? (
                          <span className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                            <ShieldCheck size={12} aria-hidden /> Verified
                          </span>
                        ) : (
                          <span className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                            <Clock size={12} aria-hidden /> Provisional
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
