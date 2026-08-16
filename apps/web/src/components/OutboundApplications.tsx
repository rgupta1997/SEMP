import { Link } from 'react-router-dom';
import { useApi, fmtDateRange } from '../lib/hooks';
import { Badge, Card, EmptyState, Spinner } from './ui';

interface Application {
  id: string;
  championship_id: string;
  status: 'pending' | 'approved' | 'rejected';
  applied_at: string;
  reviewed_at: string | null;
  rejection_note: string | null;
  championships: { id: string; name: string; slug: string; status: string; start_date: string; end_date: string } | null;
}

const TONE: Record<string, 'amber' | 'green' | 'rose'> = {
  pending: 'amber', approved: 'green', rejected: 'rose',
};

// Every championship this organisation has applied to, and what came of it
// (FR-DIS-4, J3-E4). The mirror of the inbound invitations above it: the data has
// always existed, but the only way to see it was to open each championship in turn
// and work out whether you were in.
export function OutboundApplications({ orgId }: { orgId: string }) {
  const { data: applications = [], isLoading } = useApi<Application[]>(
    orgId ? `/me/enrollments?organization_id=${orgId}` : null,
  );

  if (isLoading) return <Spinner />;
  if (applications.length === 0) {
    return (
      <EmptyState icon="📨" title="No applications yet"
        description="Championships this organisation applies to from Discover show up here with their status." />
    );
  }

  return (
    <div className="space-y-2">
      {applications.map((a) => (
        <Card key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {a.championships ? (
                <Link to={`/championships/${a.championship_id}`} className="font-semibold text-slate-900 hover:underline dark:text-slate-100">
                  {a.championships.name}
                </Link>
              ) : (
                <span className="font-semibold text-slate-500 dark:text-slate-400">A championship that no longer exists</span>
              )}
              <Badge tone={TONE[a.status] ?? 'slate'}>{a.status}</Badge>
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {a.championships && <>{fmtDateRange(a.championships.start_date, a.championships.end_date)} · </>}
              applied {new Date(a.applied_at).toLocaleDateString()}
            </div>
            {/* The organiser's note is the whole point of showing a rejection - a
                bare "rejected" tells an applicant nothing they can act on. */}
            {a.status === 'rejected' && a.rejection_note && (
              <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                {a.rejection_note}
              </p>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
