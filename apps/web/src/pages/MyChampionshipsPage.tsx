import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, fmtDateRange } from '../lib/hooks';
import { Badge, Card, EmptyState, PageHeader, Spinner, StatusBadge } from '../components/ui';
import { InvitationsInbox } from '../components/InvitationsInbox';

interface MyChampionship {
  id: string; name: string; slug: string; status: string;
  venue?: string | null; start_date: string; end_date: string;
  my_roles: string[];
}

const ROLE_TONE: Record<string, 'brand' | 'green' | 'amber' | 'slate'> = {
  organiser: 'brand', official: 'amber', player: 'green', member: 'slate',
};

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'registration_open', label: 'Upcoming' },
  { key: 'ongoing', label: 'Live' },
  { key: 'completed', label: 'Completed' },
] as const;

// Championships the user is involved in — in any capacity (organiser / official /
// player / org member). Tagged with the roles they hold per championship.
export function MyChampionshipsPage() {
  const { data: rows = [], isLoading } = useApi<MyChampionship[]>('/championships/mine');
  const [tab, setTab] = useState<string>('all');

  const filtered = tab === 'all' ? rows : rows.filter((c) => c.status === tab);

  return (
    <div className="space-y-4">
      <PageHeader title="Where you're competing" subtitle="Every championship you're part of — across all your organizations." />

      <InvitationsInbox />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t.key ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? <Spinner /> : filtered.length === 0 ? (
        <EmptyState icon="🏆" title="Nothing here yet" description="Join a team, get assigned as an official, or host your own — your championships will show up here." />
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <Card key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-base font-black text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">{c.name.slice(0, 1)}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{c.name}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{c.venue || 'Venue TBD'} · {fmtDateRange(c.start_date, c.end_date)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {c.my_roles.map((r) => <Badge key={r} tone={ROLE_TONE[r] ?? 'slate'}>{r}</Badge>)}
                <Link
                  to={
                    c.my_roles.includes('organiser')
                      ? `/championships/${c.id}`
                      : c.my_roles.includes('player')
                        // Players get their personal participation view (teams / matches / stats).
                        ? `/profile/championships/${c.id}`
                        // Everyone else (org members, officials) gets the read-only spectator view.
                        : `/championships/${c.id}`
                  }
                  className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
                >
                  View details →
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
