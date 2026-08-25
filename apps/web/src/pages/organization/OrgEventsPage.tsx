import { useMemo, useState } from 'react';
import { Mail, Trophy } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useApi, useTableControls, fmtDateRange } from '../../lib/hooks';
import { usePermissions } from '../../lib/permissions';
import { OrgHeader } from '../../components/OrgHeader';
import { InvitationsInbox } from '../../components/InvitationsInbox';
import {
  Badge, EmptyState, ListToolbar, PageHeader, Pagination, SearchInput, Spinner, StatusBadge,
} from '../../components/ui';

// Organisation > Events (F-068).
//
// One table covering every event this organisation is associated with, with the
// relationship shown per row. Three tabs rather than three pages, because an
// organiser asking "what are we in?" does not experience hosting and participating
// as separate systems - and an event can legitimately be both.

interface Row {
  id: string; name: string; slug: string; status: string;
  start_date: string; end_date: string; venue: string | null;
  relationship: string;
  our_teams: number;
  participant_count: number;
  applied_at: string | null;
}

const REL_TONE: Record<string, 'brand' | 'green' | 'amber' | 'rose' | 'slate'> = {
  participating: 'green', pending: 'amber', rejected: 'rose', withdrawn: 'slate',
};

// Invitations sit here rather than on a page of their own: an invitation is an
// event relationship that has not been accepted yet, so it belongs beside the ones
// that have. It is also the only way in - the old organisation tab rail that used
// to carry it duplicated the sidebar and has been removed.
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'participating', label: 'Participating' },
  { key: 'pending', label: 'Awaiting approval' },
  { key: 'invitations', label: 'Invitations' },
] as const;

export function OrgEventsPage() {
  const { orgId = '' } = useParams();
  const { data, isLoading } = useApi<{ rows: Row[] }>(`/organizations/${orgId}/events`);
  const [tab, setTab] = useState<string>('all');

  // Only owners and admins can act on an invitation, so only they are shown one -
  // a tab everybody can see and nobody else can use is just a locked door.
  const canManage = usePermissions().canManageOrg(orgId);
  const { data: allInvites = [] } = useApi<any[]>(canManage ? '/me/invitations' : null);
  const invites = allInvites.filter((i) => i.organization_id === orgId);

  const rows = data?.rows ?? [];
  const counts = useMemo(() => ({
    all: rows.length,
    participating: rows.filter((r) => r.relationship === 'participating').length,
    pending: rows.filter((r) => r.relationship === 'pending').length,
    invitations: invites.length,
  }), [rows, invites.length]);

  const filtered = useMemo(
    () => rows.filter((r) => tab === 'all' || r.relationship === tab),
    [rows, tab],
  );

  const tc = useTableControls(filtered, {
    search: (r) => `${r.name} ${r.venue ?? ''} ${r.relationship}`,
    sorts: { start: (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime() },
    initialSort: 'start',
    pageSize: 12,
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="pb-20">
      <OrgHeader orgId={orgId} />
      <PageHeader title="Events" subtitle="Everything this organisation is entered in, hosting, or waiting on." />

      <div className="mb-4 mt-4 flex flex-wrap gap-2">
        {TABS.filter((t) => t.key !== 'invitations' || canManage).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t.key ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'}`}
          >
            {t.label}
            <span className={`font-mono text-[11px] ${tab === t.key ? 'text-white/75' : 'text-slate-400'}`}>
              {counts[t.key as keyof typeof counts]}
            </span>
          </button>
        ))}
      </div>

      {tab === 'invitations' ? (
        invites.length === 0 ? (
          <EmptyState
            icon={<Mail size={24} />}
            title="No pending invitations"
            description="When an event invites this organisation, it shows up here to accept or decline."
          />
        ) : (
          <InvitationsInbox organizationId={orgId} />
        )
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Trophy size={24} />}
          title="Not entered in anything yet"
          description="Apply from Discover and approved entries appear here, with the teams you have entered."
        />
      ) : tc.total === 0 ? (
        <EmptyState icon={<Trophy size={24} />} title="Nothing in this tab" description="Try another tab or search." />
      ) : (
        <>
          <ListToolbar>
            <SearchInput value={tc.query} onChange={tc.setQuery} placeholder="Search events…" className="w-full sm:w-72" />
          </ListToolbar>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left font-mono text-[9px] uppercase tracking-[0.13em] text-slate-500 dark:border-slate-700">
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Relationship</th>
                  <th className="px-4 py-3">Our teams</th>
                  <th className="px-4 py-3">Organisations</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {tc.view.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 dark:border-slate-700/60">
                    <td className="px-4 py-3">
                      <Link to={`/championships/${r.id}`} className="font-semibold text-slate-900 hover:text-brand-600 dark:text-slate-100">
                        {r.name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {r.venue || 'Venue TBD'} · {fmtDateRange(r.start_date, r.end_date)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={REL_TONE[r.relationship] ?? 'slate'}>{r.relationship}</Badge>
                    </td>
                    {/* The number an organiser wants before the participant count:
                        how much of US is actually in this. */}
                    <td className="px-4 py-3 font-mono text-[13px] text-slate-700 dark:text-slate-300">{r.our_teams}</td>
                    <td className="px-4 py-3 font-mono text-[13px] text-slate-500">{r.participant_count}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={tc.page} pageCount={tc.pageCount} total={tc.total} pageSize={tc.pageSize} onPage={tc.setPage} />
        </>
      )}
    </div>
  );
}
