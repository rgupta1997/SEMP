import { useState } from 'react';
import { Landmark } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useWorkspace } from '../lib/useWorkspace';
import { api } from '../lib/api';
import { useApiMutation } from '../lib/hooks';
import { titleCase } from '../lib/format';
import { InstitutionFormModal } from '../components/InstitutionFormModal';
import { JoinOrgModal } from '../components/JoinOrgModal';
import { Badge, Button, Card, EmptyState, PageHeader, toast } from '../components/ui';

const ADMIN_ROLES = ['owner', 'admin'];

export function OrganizationsPage() {
  const { ctx, refresh } = useAuth();
  const [creating, setCreating] = useState(false);
  const [finding, setFinding] = useState(false);

  const memberships = ctx?.organizations ?? [];
  const pending = memberships.filter((m) => m.status === 'pending');
  const current = memberships.filter((m) => m.status !== 'past' && m.status !== 'pending' && m.status !== 'rejected');
  const past = memberships.filter((m) => m.status === 'past');

  return (
    <div className="space-y-6">
      <PageHeader title="Your communities" subtitle="The organizations & groups you play for. Each fields teams per sport.">
        <Button variant="outline" onClick={() => setFinding(true)}>Join Organization</Button>
        <Button onClick={() => setCreating(true)}>+ Create organization</Button>
      </PageHeader>

      {memberships.length === 0 ? (
        <EmptyState
          icon={<Landmark size={24} />}
          title="You're not in any organizations yet"
          description="Create your own to enter teams and register for championships, or find one and request to join."
          action={(
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setFinding(true)}>Join Organization</Button>
              <Button onClick={() => setCreating(true)}>+ Create organization</Button>
            </div>
          )}
        />
      ) : (
        <>
          {pending.length > 0 && <PendingSection memberships={pending} />}
          <Section title="Current" memberships={current} />
          {past.length > 0 && <Section title="Past" memberships={past} />}
        </>
      )}

      {creating && (
        <InstitutionFormModal
          onClose={() => setCreating(false)}
          onSubmit={async (body) => {
            const org = await api('POST', '/organizations', body);
            await refresh();
            toast.success('Organization created', 'You are now its owner.');
            return org;
          }}
        />
      )}

      {finding && <JoinOrgModal onClose={() => setFinding(false)} />}
    </div>
  );
}

// Pending join requests awaiting an owner/admin's approval. The user can withdraw.
function PendingSection({ memberships }: { memberships: any[] }) {
  const { refresh } = useAuth();
  const withdraw = useApiMutation((orgId: string) => api('DELETE', `/organizations/${orgId}/join`), ['/auth/me']);
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Requested · awaiting approval</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {memberships.map((m) => (
          <Card key={m.id} className="flex items-start justify-between p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-slate-200 dark:bg-slate-700 text-sm font-black text-slate-600 dark:text-slate-300">
                {(m.organization?.short_name ?? m.organization?.name ?? '?').slice(0, 3).toUpperCase()}
              </span>
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">{m.organization?.name}</div>
                <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{m.organization?.city ?? 'Organization'}</div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge tone="amber">Pending</Badge>
              <button
                onClick={() => withdraw.mutate(m.organization_id, { onSuccess: () => { refresh(); toast.success('Request withdrawn'); }, onError: (e: any) => toast.error(e.message) })}
                disabled={withdraw.isPending}
                className="text-sm font-semibold text-slate-500 hover:text-rose-600 hover:underline dark:text-slate-400">
                Withdraw
              </button>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Section({ title, memberships }: { title: string; memberships: any[] }) {
  const ws = useWorkspace();
  const { pathname } = useLocation();

  // Opening an organisation SWITCHES CONTEXT rather than just following a link
  // (F-054). Navigating without switching leaves the sidebar showing the personal
  // nav while the page shows an organisation - the two disagree, and the person is
  // left unable to reach the rest of the org they just opened.
  const open = (orgId: string) => ws.enter(orgId, `/organizations/${orgId}/overview`, pathname);

  if (memberships.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {memberships.map((m) => {
          const canManage = ADMIN_ROLES.includes(m.role);
          return (
            <Card key={m.id} className="flex items-start justify-between p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-slate-900 text-sm font-black text-white">
                  {(m.organization?.short_name ?? m.organization?.name ?? '?').slice(0, 3).toUpperCase()}
                </span>
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{m.organization?.name}</div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {m.organization?.city ?? 'Organization'}
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge tone="brand">{titleCase(m.role)}</Badge>
                {/* Owners/admins manage; members (and other roles) can still view the org's teams + members. */}
                <button
                  onClick={() => open(m.organization_id)}
                  className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
                >
                  {canManage ? 'Manage →' : 'View →'}
                </button>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
