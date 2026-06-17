import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { InstitutionFormModal } from '../components/InstitutionFormModal';
import { Badge, Button, Card, EmptyState, PageHeader, toast } from '../components/ui';

const ADMIN_ROLES = ['owner', 'admin'];

export function OrganizationsPage() {
  const { ctx, refresh } = useAuth();
  const [creating, setCreating] = useState(false);

  const memberships = ctx?.organizations ?? [];
  const current = memberships.filter((m) => m.status !== 'past');
  const past = memberships.filter((m) => m.status === 'past');

  return (
    <div className="space-y-6">
      <PageHeader title="Your communities" subtitle="The organizations & groups you play for. Each fields teams per sport.">
        <Button onClick={() => setCreating(true)}>+ Create organization</Button>
      </PageHeader>

      {memberships.length === 0 ? (
        <EmptyState
          icon="🏛"
          title="You're not in any organizations yet"
          description="Create one to enter teams and register for championships, or ask an organization owner to add you."
          action={<Button onClick={() => setCreating(true)}>+ Create organization</Button>}
        />
      ) : (
        <>
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
    </div>
  );
}

function Section({ title, memberships }: { title: string; memberships: any[] }) {
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
                <Badge tone="brand">{m.role}</Badge>
                {canManage && (
                  <Link to={`/organizations/${m.organization_id}/teams`} className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300">
                    Manage →
                  </Link>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
