import { useMemo, useState } from 'react';
import { Plus, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApi, fmtDate } from '../../lib/hooks';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Spinner, cn } from '../../components/ui';
import type { Achievement } from '../../components/participant/types';
import { ClaimAchievementModal } from './ClaimAchievementModal';
import { EvidenceChip } from '../organization/ClaimsReviewPage';

// Two of the three views in a person's Achievements area (the third is the timeline,
// in ParticipantAchievementsLayout). They mirror the institution's Hall of Fame and
// Claims queue: same words, same order, one person's scope instead of an
// institution's.

interface AchievementsResponse { achievements: Achievement[] }

interface MyClaim {
  id: string; title: string; occurred_on: string; status: string; decision_note: string | null;
  organizations: { name: string } | null; sports: { name: string } | null;
  claim_evidence: Array<{ id: string; filename: string; mime: string; size_bytes: number }>;
}

const CLAIM_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Waiting for review', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' },
  approved: { label: 'Validated', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
  rejected: { label: 'Not accepted', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' },
};

const RESULT_STYLE: Record<string, string> = {
  won: 'text-emerald-600 dark:text-emerald-400',
  lost: 'text-rose-500 dark:text-rose-400',
  draw: 'text-slate-500 dark:text-slate-400',
  pending: 'text-slate-400 dark:text-slate-500',
};

// Every award the participant has earned, grouped by award name, each occurrence
// linking to its match - the person-scoped answer to "what have I won?".
export function ParticipantAwardsPage() {
  const { data, isLoading } = useApi<AchievementsResponse>('/me/achievements');

  const groups = useMemo(() => {
    const map = new Map<string, Achievement[]>();
    for (const a of data?.achievements ?? []) {
      const list = map.get(a.award_name) ?? [];
      list.push(a);
      map.set(a.award_name, list);
    }
    return [...map.entries()]
      .map(([award_name, items]) => ({ award_name, items }))
      .sort((a, b) => b.items.length - a.items.length || a.award_name.localeCompare(b.award_name));
  }, [data?.achievements]);

  return (
    <div className="space-y-5">
      <PageHeader title="Awards" subtitle="Your record · every award you've earned across your championships." />

      {isLoading ? <Spinner /> : groups.length === 0 ? (
        <EmptyState icon={<Trophy size={24} />} title="No achievements yet" description="Awards you receive from match officials will appear here." />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.award_name}>
              <CardHeader
                title={<span className="flex items-center gap-2"><Trophy size={16} className="text-amber-500" aria-hidden />{g.award_name}</span>}
                action={<Badge tone="amber">{g.items.length}×</Badge>}
              />
              <CardBody className="pt-0">
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {g.items.map((a) => {
                    const meta = [
                      a.championship?.name,
                      a.tournament?.name,
                      [a.sport, a.discipline].filter(Boolean).join(' ') || null,
                      a.round,
                    ].filter(Boolean).join(' · ');
                    const row = (
                      <div className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{meta || '-'}</div>
                          {a.opponent_team_name && (
                            <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                              {a.my_team_name ? `${a.my_team_name} ` : ''}vs {a.opponent_team_name}
                              {a.result && a.result !== 'pending' && (
                                <span className={cn('ml-2 font-semibold capitalize', RESULT_STYLE[a.result])}>{a.result}</span>
                              )}
                            </div>
                          )}
                        </div>
                        {a.date && <span className="flex-none text-xs text-slate-400 dark:text-slate-500">{fmtDate(a.date)}</span>}
                      </div>
                    );
                    return (
                      <li key={a.id}>
                        {a.fixture_id ? (
                          <Link to={`/profile/matches/${a.fixture_id}`} className="block rounded-lg px-1 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60">
                            {row}
                          </Link>
                        ) : row}
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// What this person has asked an institution to vouch for. The mirror of the
// institution's Claims queue, from the other side of the same decision - and it stays
// visible after a decision, because the rejection note is the most useful thing on
// this page to the person who got one.
export function ParticipantClaimsPage() {
  const claims = useApi<{ rows: MyClaim[] }>('/me/claims');
  const [claiming, setClaiming] = useState(false);
  const rows = claims.data?.rows ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Claims" subtitle="Your record · achievements you've asked an institution to vouch for.">
        <Button onClick={() => setClaiming(true)}><Plus size={15} aria-hidden />Claim an achievement</Button>
      </PageHeader>

      {claiming && <ClaimAchievementModal onClose={() => setClaiming(false)} invalidate={['/me/claims']} />}

      {claims.isLoading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState
          icon={<Trophy size={24} />}
          title="Nothing claimed yet"
          description="Won something outside this platform? Claim it, attach your evidence, and your institution can validate it onto your record."
        />
      ) : (
        <Card>
          <CardBody>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((c) => {
                const s = CLAIM_STATUS[c.status] ?? { label: c.status, cls: 'bg-slate-100 text-slate-700' };
                return (
                  <li key={c.id} className="grid gap-1.5 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{c.title}</span>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', s.cls)}>{s.label}</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {fmtDate(c.occurred_on)}{c.sports?.name ? ` · ${c.sports.name}` : ''}
                      {c.organizations?.name ? ` · reviewed by ${c.organizations.name}` : ''}
                    </p>
                    {c.decision_note && (
                      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
                        {c.decision_note}
                      </p>
                    )}
                    {c.claim_evidence.length > 0 && (
                      <div className="flex flex-wrap gap-2">{c.claim_evidence.map((e) => <EvidenceChip key={e.id} e={e} />)}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
