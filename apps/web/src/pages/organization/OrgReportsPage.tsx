import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Info } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { Card, PageHeader, Select, Skeleton, cn } from '../../components/ui';

// Leadership reporting (J5-E1/E2/E3).
//
// Three tabs over one season selector, because "are we growing?" and "are we winning?"
// and "who are we reaching?" are the same question asked of the same season, and making
// people re-pick the year per tab is how two numbers end up being compared across
// different periods by accident.
//
// Every figure here is server-derived. Nothing on this page recomputes anything: if the
// page and an export could disagree, the page is wrong by construction.

type Tab = 'participation' | 'performance' | 'inclusion';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'participation', label: 'Participation' },
  { key: 'performance', label: 'Performance' },
  { key: 'inclusion', label: 'Diversity & inclusion' },
];

interface Kpi { value: number | null; delta_pct: number | null }
interface SeasonRef { season: number; label: string }

/** A delta that refuses to invent a comparison it does not have. */
function Delta({ d }: { d: number | null }) {
  if (d === null) {
    return <span className="text-xs text-slate-400 dark:text-slate-500">no comparison available</span>;
  }
  const up = d >= 0;
  return (
    <span className={cn('text-xs font-medium', up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
      {up ? '+' : ''}{d}% year on year
    </span>
  );
}

function KpiTile({ label, kpi, suffix }: { label: string; kpi?: Kpi; suffix?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {kpi?.value === null || kpi?.value === undefined
          ? <span className="text-sm font-normal text-slate-400 dark:text-slate-500">Not available</span>
          : <>{kpi.value}{suffix}</>}
      </div>
      <div className="mt-0.5"><Delta d={kpi?.delta_pct ?? null} /></div>
    </div>
  );
}

/** A ranked horizontal bar list - the shape every breakdown on this page takes. */
function Bars({ rows, labelKey, valueKey, empty }: {
  rows: Array<Record<string, any>>; labelKey: string; valueKey: string; empty: string;
}) {
  if (!rows.length) return <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">{empty}</p>;
  const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1);
  return (
    <ul className="grid gap-2 px-4 py-3">
      {rows.map((r) => {
        const v = r[valueKey];
        return (
          <li key={String(r[labelKey])} className="flex items-center gap-3 text-sm">
            <span className="w-40 truncate text-slate-700 dark:text-slate-300">{r[labelKey]}</span>
            <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.round(((Number(v) || 0) / max) * 100)}%` }} />
            </span>
            <span className="w-16 text-right tabular-nums text-slate-600 dark:text-slate-300">
              {/* A suppressed cell is shown as suppressed, not as a zero (J5-E3-S4). */}
              {v === null ? <span className="text-xs text-slate-400">suppressed</span> : v}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-0">
      <div className="border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

export function OrgReportsPage() {
  const { orgId } = useParams();
  const [tab, setTab] = useState<Tab>('participation');
  const [season, setSeason] = useState<string>('');

  const q = season ? `?season=${season}` : '';
  const { data, isLoading } = useApi<any>(orgId ? `/organizations/${orgId}/reports/${tab}${q}` : null);
  const seasons: SeasonRef[] = data?.available_seasons ?? [];

  return (
    <div className="grid gap-5">
      <PageHeader title="Reports" subtitle="Derived from locked results only." />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {TABS.map((t) => (
            <button
              key={t.key} type="button" onClick={() => setTab(t.key)}
              aria-current={tab === t.key}
              className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition',
                tab === t.key ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200')}
            >{t.label}</button>
          ))}
        </div>
        {seasons.length > 0 && (
          <Select value={season || String(data?.season ?? '')} onChange={(e) => setSeason(e.target.value)} className="w-auto" aria-label="Season">
            {seasons.map((s) => <option key={s.season} value={s.season}>{s.label}</option>)}
          </Select>
        )}
      </div>

      {isLoading || !data ? <Skeleton className="h-64" /> : (
        <>
          {tab === 'participation' && (
            <div className="grid gap-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <KpiTile label="Unique participants" kpi={data.kpis?.participants} />
                <KpiTile label="Events" kpi={data.kpis?.events} />
                <KpiTile label="Matches played" kpi={data.kpis?.matches_played} />
                <KpiTile label="Medals" kpi={data.kpis?.medals} />
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <Panel title="Participants by sport">
                  <Bars rows={data.by_sport ?? []} labelKey="sport" valueKey="participants" empty="Nobody has been entered into a draw this season." />
                </Panel>
                <Panel title="Participants by programme">
                  <Bars rows={data.by_programme ?? []} labelKey="programme" valueKey="participants" empty="No participants to place yet." />
                </Panel>
              </div>
              <Panel title="Six-season trend">
                <Bars rows={data.trend ?? []} labelKey="label" valueKey="participants" empty="No completed seasons yet." />
              </Panel>
            </div>
          )}

          {tab === 'performance' && (
            <div className="grid gap-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <KpiTile label="Medals" kpi={data.kpis?.medals} />
                <KpiTile label="Gold" kpi={data.kpis?.gold} />
                <KpiTile label="Win rate" kpi={data.kpis?.win_rate_pct} suffix="%" />
                <KpiTile label="Awards" kpi={data.kpis?.awards} />
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <Panel title="Medals by sport">
                  {(data.medals_by_sport ?? []).length === 0
                    ? <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No medals recorded this season.</p>
                    : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                              <th className="px-4 py-2 font-medium">Sport</th>
                              <th className="px-2 py-2 text-right font-medium">🥇</th>
                              <th className="px-2 py-2 text-right font-medium">🥈</th>
                              <th className="px-2 py-2 text-right font-medium">🥉</th>
                              <th className="px-4 py-2 text-right font-medium">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.medals_by_sport.map((s: any) => (
                              <tr key={s.sport} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                                <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{s.sport}</td>
                                <td className="px-2 py-2 text-right tabular-nums">{s.gold}</td>
                                <td className="px-2 py-2 text-right tabular-nums">{s.silver}</td>
                                <td className="px-2 py-2 text-right tabular-nums">{s.bronze}</td>
                                <td className="px-4 py-2 text-right font-semibold tabular-nums">{s.total}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                </Panel>
                <Panel title="Top performers">
                  {(data.top_performers ?? []).length === 0
                    ? <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No medals or awards recorded this season.</p>
                    : (
                      <ol className="divide-y divide-slate-100 dark:divide-slate-800">
                        {data.top_performers.map((p: any, i: number) => (
                          <li key={p.user_id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                            <span className="w-5 text-right tabular-nums text-slate-400">{i + 1}</span>
                            <Link to={`/people/${p.user_id}/record`} className="flex-1 truncate font-medium text-brand-600 hover:underline dark:text-brand-400">{p.name}</Link>
                            <span className="tabular-nums text-slate-600 dark:text-slate-300">
                              {p.total_medals} medal{p.total_medals === 1 ? '' : 's'}{p.awards ? ` · ${p.awards} award${p.awards === 1 ? '' : 's'}` : ''}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                </Panel>
              </div>
            </div>
          )}

          {tab === 'inclusion' && (
            <div className="grid gap-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <KpiTile label="Participants" kpi={{ value: data.participants, delta_pct: null }} />
                <KpiTile label="Women" kpi={{ value: data.women?.count ?? null, delta_pct: data.women?.delta_pct ?? null }} />
                <KpiTile label="Women's share" kpi={{ value: data.women?.share_pct ?? null, delta_pct: null }} suffix="%" />
                <KpiTile label="First-time athletes" kpi={{ value: data.first_time_athletes?.value ?? null, delta_pct: null }} />
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <Panel title="How people answered">
                  <Bars rows={data.gender_breakdown ?? []} labelKey="gender" valueKey="count" empty="No demographics collected yet." />
                </Panel>
                <Panel title="Women by sport">
                  <Bars rows={data.women_by_sport ?? []} labelKey="sport" valueKey="count" empty="No participation to report." />
                </Panel>
              </div>
              <Panel title="Reach by programme">
                {(data.by_programme ?? []).length === 0
                  ? <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No programmes defined under Structure yet.</p>
                  : (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {data.by_programme.map((p: any) => (
                        <li key={p.programme} className="flex flex-wrap items-center gap-x-3 px-4 py-2.5 text-sm">
                          <span className="w-44 truncate text-slate-700 dark:text-slate-300">{p.programme}</span>
                          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <span className={cn('block h-full rounded-full', p.participants ? 'bg-brand-500' : 'bg-transparent')}
                              style={{ width: `${p.share_pct ?? 0}%` }} />
                          </span>
                          <span className="tabular-nums text-slate-600 dark:text-slate-300">
                            {p.participants} of {p.members}{p.share_pct !== null ? ` · ${p.share_pct}%` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
              </Panel>
            </div>
          )}

          {data.basis && (
            <p className="flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Info size={13} className="mt-0.5 flex-none" aria-hidden />{data.basis}
            </p>
          )}
        </>
      )}
    </div>
  );
}
