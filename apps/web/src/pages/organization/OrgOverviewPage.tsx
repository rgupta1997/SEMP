import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useApi, fmtDateRange } from '../../lib/hooks';
import { usePermissions } from '../../lib/permissions';
import { usePocOnboarding } from '../../lib/onboarding';
import { OrgTabs } from '../../components/OrgTabs';
import { GettingStarted } from '../../components/onboarding/GettingStarted';
import { Card, CardBody, CardHeader, EmptyState, StatusBadge } from '../../components/ui';

// Organization landing tab. Hosts the getting-started checklist for managers so a
// newly-created organization opens onto "what to do next", plus the championships this
// org has been approved into (so an accepted invitation shows up right here).
export function OrgOverviewPage() {
  const { ctx } = useAuth();
  const navigate = useNavigate();
  const { orgId: routeOrgId } = useParams();
  const orgId = routeOrgId ?? ctx?.organization?.id ?? ctx?.user.organization_id ?? '';
  const canManage = usePermissions().canManageOrg(orgId);
  const onboarding = usePocOnboarding(orgId, canManage);
  // Enrollments scoped to THIS org; an accepted (approved) invitation should appear here.
  const { data: enrollments = [] } = useApi<any[]>(orgId ? `/me/enrollments?organization_id=${orgId}` : null);
  const approved = enrollments.filter((e) => e.status === 'approved');

  return (
    <div>
      {orgId && <OrgTabs orgId={orgId} />}
      {canManage ? (
        <GettingStarted
          title="Get your organization match-ready"
          subtitle="A few steps to go from sign-up to a locked roster."
          state={onboarding}
          storageKey={`onboarding-poc-${orgId}`}
          completeNote="That covered one team. If your organization fields multiple teams, repeat these steps for each - create another team, enter it into a championship, then build and lock its roster."
        />
      ) : (
        <EmptyState icon="◎" title="Organization overview" description="Find this organization’s teams, members and championships in the tabs above." />
      )}

      {approved.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Championships" subtitle={`Approved into ${approved.length} championship${approved.length === 1 ? '' : 's'}.`} />
          <CardBody>
            <div className="space-y-2">
              {approved.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => navigate(`/organizations/${orgId}/teams?championship=${e.championship_id}`)}
                  className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-left transition hover:bg-brand-50 dark:bg-slate-800/60 dark:hover:bg-brand-950/30"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">{e.championships?.name ?? 'Championship'}</div>
                    {fmtDateRange(e.championships?.start_date, e.championships?.end_date) && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">{fmtDateRange(e.championships?.start_date, e.championships?.end_date)}</div>
                    )}
                  </div>
                  <StatusBadge status={e.championships?.status ?? 'approved'} />
                </button>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
