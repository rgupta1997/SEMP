import { Link, useNavigate } from 'react-router-dom';
import { useApi, fmtDateRange } from '../lib/hooks';
import { Button, Card, EmptyState, PageHeader, Spinner, StatusBadge } from '../components/ui';

interface MyChampionship {
  id: string; name: string; slug: string; status: string;
  venue?: string | null; start_date: string; end_date: string;
  my_roles: string[];
}

// Host - championships the user organises, plus the entry point to create one.
// Open to everyone: anyone can host.
export function HostPage() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = useApi<MyChampionship[]>('/championships/mine');
  const hosted = rows.filter((c) => c.my_roles.includes('organiser'));

  return (
    <div className="space-y-4">
      <PageHeader title="Your championships" subtitle="Create and run multi-sport championships for any community - schools, colleges, corporates, clubs.">
        <Button onClick={() => navigate('/championships/new')}>+ Create Event</Button>
      </PageHeader>

      {isLoading ? <Spinner /> : hosted.length === 0 ? (
        <EmptyState
          icon="＋"
          title="You're not hosting anything yet"
          description="Create a championship to set up tournaments, sports, disciplines, fixtures and approvals."
          action={<Button onClick={() => navigate('/championships/new')}>+ Create Event</Button>}
        />
      ) : (
        <div className="space-y-3">
          {hosted.map((c) => (
            <Card key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-base font-black text-teal-600 dark:bg-teal-500/10 dark:text-teal-300">{c.name.slice(0, 1)}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{c.name}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{c.venue || 'Venue TBD'} · {fmtDateRange(c.start_date, c.end_date)}</div>
                </div>
              </div>
              <Link to={`/championships/${c.id}`} className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300">Open →</Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
