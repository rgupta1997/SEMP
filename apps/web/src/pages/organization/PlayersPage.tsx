import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Upload, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useApi, useTableControls } from '../../lib/hooks';
import { usePermissions } from '../../lib/permissions';
import { api } from '../../lib/api';
import { OrgHeader } from '../../components/OrgHeader';
import {
  Avatar, Badge, Button, EmptyState, ListToolbar, PageHeader, Pagination,
  SearchInput, Spinner, confirmDialog, toast,
} from '../../components/ui';

// The player directory (PG-21).
//
// One row per person, not per team. The Teams page already answers "who is in this
// squad"; this answers "who do we have", which is a different question and the one
// an administrator asks when somebody has to be found, verified or chased.
//
// The Sportagon ID is on every row deliberately. It is what makes this person the
// same person at their next institution, and an administrator who never sees it
// has no way to understand why a transfer keeps their record.

interface Person {
  id: string;
  user_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  member_code: string | null;
  verification: string;
  org_unit_name: string | null;
  sportagon_id: string | null;
  sports: number;
  events: number;
}

const VERIFY_TONE: Record<string, 'green' | 'amber' | 'rose' | 'slate'> = {
  verified: 'green', pending: 'amber', rejected: 'rose', unverified: 'slate',
};

const FILTERS = [
  { key: 'all', label: 'Everyone' },
  { key: 'pending', label: 'Awaiting verification' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
] as const;

export function PlayersPage() {
  const { ctx } = useAuth();
  const navigate = useNavigate();
  const { orgId: routeOrgId } = useParams();
  const orgId = routeOrgId ?? ctx?.organization?.id ?? ctx?.user.organization_id ?? '';
  const canManage = usePermissions().canManageOrg(orgId);

  const { data: people = [], isLoading, refetch } = useApi<Person[]>(orgId ? `/organizations/${orgId}/people` : null);
  const [filter, setFilter] = useState<string>('all');
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => ({
    all: people.length,
    pending: people.filter((p) => p.verification === 'pending').length,
    verified: people.filter((p) => p.verification === 'verified').length,
    rejected: people.filter((p) => p.verification === 'rejected').length,
  }), [people]);

  const rows = useMemo(
    () => people.filter((p) => filter === 'all' || p.verification === filter),
    [people, filter],
  );

  const tc = useTableControls(rows, {
    search: (p) => [p.name, p.email, p.phone, p.member_code, p.sportagon_id, p.org_unit_name]
      .filter(Boolean).join(' '),
    sorts: { name: (a, b) => (a.name ?? '').localeCompare(b.name ?? '') },
    initialSort: 'name',
    pageSize: 20,
  });

  async function verify(person: Person, verification: 'verified' | 'rejected') {
    const ok = await confirmDialog({
      title: verification === 'verified' ? 'Verify this person?' : 'Reject this person?',
      message: verification === 'verified'
        ? `“${person.name ?? 'This person'}” will be confirmed as belonging to your organisation. Every verification is recorded against your name.`
        : `“${person.name ?? 'This person'}” will be marked as not belonging to your organisation. They keep their account and their record; they simply are not yours.`,
      confirmLabel: verification === 'verified' ? 'Verify' : 'Reject',
      tone: verification === 'verified' ? 'primary' : 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api('POST', `/organizations/${orgId}/people/verify`, {
        member_ids: [person.id], verification,
      });
      toast.success(verification === 'verified' ? 'Verified' : 'Rejected');
      await refetch();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <Spinner />;

  return (
    <div className="pb-20">
      {orgId && <OrgHeader orgId={orgId} />}
      <PageHeader title="Players" subtitle="Everyone who belongs to this organisation, and what they have played.">
        {canManage && (
          <>
            <Button variant="outline" onClick={() => navigate(`/organizations/${orgId}/students/import`)}>
              <Upload size={15} /> Bulk upload
            </Button>
            <Button onClick={() => navigate(`/organizations/${orgId}/members`)}>
              <UserPlus size={15} /> Add player
            </Button>
          </>
        )}
      </PageHeader>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold ${filter === f.key ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'}`}
          >
            {f.label}
            <span className={`font-mono text-[11px] ${filter === f.key ? 'text-white/75' : 'text-slate-400'}`}>
              {counts[f.key as keyof typeof counts]}
            </span>
          </button>
        ))}
      </div>

      {people.length === 0 ? (
        <EmptyState
          icon={<Users size={24} />}
          title="Nobody here yet"
          description="Import a roll, or add people one at a time. Anyone signing up on your email domain lands here too."
          action={canManage ? <Button onClick={() => navigate(`/organizations/${orgId}/students/import`)}>Import a roll</Button> : undefined}
        />
      ) : tc.total === 0 ? (
        <EmptyState icon={<Users size={24} />} title="Nobody matches" description="Try another filter, or a different search." />
      ) : (
        <>
          <ListToolbar>
            <SearchInput
              value={tc.query}
              onChange={tc.setQuery}
              placeholder="Search by name, ID, email or roll number…"
              className="w-full sm:w-96"
            />
          </ListToolbar>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left font-mono text-[9px] uppercase tracking-[0.13em] text-slate-500 dark:border-slate-700">
                  <th className="px-4 py-3">Player</th>
                  <th className="px-4 py-3">Sportagon ID</th>
                  <th className="px-4 py-3">Programme</th>
                  <th className="px-4 py-3 text-right">Sports</th>
                  <th className="px-4 py-3 text-right">Events</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {tc.view.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0 dark:border-slate-700/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={p.name ?? '?'} size={32} />
                        <div className="min-w-0">
                          <Link
                            to={`/organizations/${orgId}/people/${p.user_id}`}
                            className="truncate font-semibold text-slate-900 hover:text-brand-600 dark:text-slate-100"
                          >
                            {p.name ?? 'Unnamed'}
                          </Link>
                          <div className="truncate text-xs text-slate-500">
                            {p.member_code ? `${p.member_code} · ` : ''}{p.email ?? p.phone ?? 'No contact'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-slate-600 dark:text-slate-300">
                      {p.sportagon_id ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {p.org_unit_name ?? <span className="text-slate-400">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[13px] text-slate-700 dark:text-slate-300">{p.sports}</td>
                    <td className="px-4 py-3 text-right font-mono text-[13px] text-slate-700 dark:text-slate-300">{p.events}</td>
                    <td className="px-4 py-3">
                      <Badge tone={VERIFY_TONE[p.verification] ?? 'slate'}>{p.verification}</Badge>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {p.verification === 'pending' ? (
                          <>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => verify(p, 'verified')}>Verify</Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => verify(p, 'rejected')}>Reject</Button>
                          </>
                        ) : null}
                      </td>
                    )}
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
