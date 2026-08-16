import { Link, useParams } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Radio } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { Card, PageHeader, Skeleton, cn } from '../../components/ui';

// The institution home (J1-E7) - decisions first, navigation second.
//
// One fetch, because six tiles from six endpoints is six spinners on the screen a
// person sees most often. Everything on it is either a real number or absent; there is
// no placeholder tile, and no zero standing in for "we haven't built this yet".

interface Dashboard {
  organization: { id: string; name: string; short_name: string | null; logo_url: string | null; verified: boolean; city: string | null };
  kpis: {
    people: number; teams: number; championships: number; matches_live_now: number;
    awaiting_approval: number; pending_verification: number; certificates_pending: number | null;
  };
  pending_actions: Array<{ key: string; label: string; count: number; cta: string; href: string }>;
  events: Array<{ id: string; name: string; status: string; venue: string | null; start_date: string; end_date: string; sports: string[] }>;
  participation_trend: Array<{ season: number; participants: number; delta_pct: number | null }>;
  sync: { records: number; as_of: string };
}

const STATUS_CHIP: Record<string, string> = {
  ongoing: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  registration_open: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  completed: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};
const STATUS_LABEL: Record<string, string> = {
  ongoing: 'Live', registration_open: 'Registration', draft: 'Draft', completed: 'Completed', upcoming: 'Upcoming',
};

const dateRange = (a: string, b: string) => {
  const f = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return a === b ? f(a) : `${f(a)} – ${f(b)}`;
};

/** A KPI that knows the difference between nought and not-yet-built. */
function Kpi({ label, value, accent }: { label: string; value: number | null; accent?: boolean }) {
  return (
    <div className={cn(
      'rounded-xl border p-4',
      accent && (value ?? 0) > 0
        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
        : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
    )}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      {value === null
        ? <div className="mt-1 text-sm text-slate-400 dark:text-slate-500">Not yet available</div>
        : (
          <div className={cn('mt-1 flex items-baseline gap-1.5 text-2xl font-semibold tabular-nums',
            accent && value > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-900 dark:text-slate-100')}>
            {accent && value > 0 && <Radio size={16} className="animate-pulse" aria-hidden />}
            {value}
          </div>
        )}
    </div>
  );
}

export function OrgHomePage() {
  const { orgId } = useParams();
  const { data, isLoading } = useApi<Dashboard>(orgId ? `/organizations/${orgId}/dashboard` : null);

  if (isLoading || !data) {
    return <div className="grid gap-4"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;
  }
  const { organization: org, kpis, pending_actions: actions, events, participation_trend: trend, sync } = data;
  const latest = trend[trend.length - 1];

  return (
    <div className="grid gap-6">
      <PageHeader
        title={org.name}
        subtitle={[org.city, org.verified ? 'Verified sports organisation' : null].filter(Boolean).join(' · ') || undefined}
      />

      {/* J1-E7-S2: what needs a decision, before anything else on the page. */}
      {actions.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 p-0 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="border-b border-amber-200 px-4 py-2.5 text-sm font-semibold text-amber-900 dark:border-amber-900 dark:text-amber-200">
            Needs your attention
          </div>
          <ul className="divide-y divide-amber-200 dark:divide-amber-900">
            {actions.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid h-7 min-w-7 place-items-center rounded-full bg-amber-200 px-2 text-sm font-bold tabular-nums text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                  {a.count}
                </span>
                <span className="flex-1 text-sm text-slate-800 dark:text-slate-200">{a.label}</span>
                <Link to={a.href} className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700">
                  {a.cta} <ArrowRight size={14} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="People" value={kpis.people} />
        <Kpi label="Teams" value={kpis.teams} />
        <Kpi label="Championships" value={kpis.championships} />
        <Kpi label="Matches live now" value={kpis.matches_live_now} accent />
        <Kpi label="Awaiting approval" value={kpis.awaiting_approval} />
        <Kpi label="Pending verification" value={kpis.pending_verification} />
        <Kpi label="Certificates pending" value={kpis.certificates_pending} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* J1-E7-S4 */}
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Live &amp; upcoming</h2>
            <Link to="/championships" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">All championships</Link>
          </div>
          {events.length === 0
            ? <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">Nothing scheduled. Host a championship or enter one from Discover.</p>
            : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {events.map((e) => (
                  <li key={e.id} className="px-4 py-3">
                    <Link to={`/championships/${e.id}`} className="group flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{dateRange(e.start_date, e.end_date)}</span>
                      <span className="flex-1 truncate text-sm font-medium text-slate-800 group-hover:underline dark:text-slate-200">{e.name}</span>
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_CHIP[e.status] ?? STATUS_CHIP.draft)}>
                        {STATUS_LABEL[e.status] ?? e.status}
                      </span>
                      {e.sports.length > 0 && (
                        <span className="w-full truncate text-xs text-slate-500 dark:text-slate-400">{e.sports.join(' · ')}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
        </Card>

        {/* J1-E7-S3 */}
        <Card className="p-0">
          <div className="border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Participation by season</h2>
          </div>
          {trend.length === 0
            ? <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No seasons with entered squads yet.</p>
            : (
              <div className="px-4 py-3">
                <div className="mb-3 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{latest.participants}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    unique participants in {latest.season}
                    {/* Never a fabricated percentage against a season that does not exist. */}
                    {latest.delta_pct === null
                      ? ' · no comparison available'
                      : ` · ${latest.delta_pct >= 0 ? '+' : ''}${latest.delta_pct}% year on year`}
                  </span>
                </div>
                <ul className="grid gap-1.5">
                  {trend.map((t) => {
                    const max = Math.max(...trend.map((x) => x.participants), 1);
                    return (
                      <li key={t.season} className="flex items-center gap-2 text-xs">
                        <span className="w-10 tabular-nums text-slate-500 dark:text-slate-400">{t.season}</span>
                        <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.round((t.participants / max) * 100)}%` }} />
                        </span>
                        <span className="w-8 text-right tabular-nums text-slate-600 dark:text-slate-300">{t.participants}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
        </Card>
      </div>

      {/* J1-E7-S5 - a real count of what the workspace holds, or nothing at all. */}
      {sync.records > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <BadgeCheck size={13} aria-hidden />
          Synced across {sync.records.toLocaleString()} records · updated {new Date(sync.as_of).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
