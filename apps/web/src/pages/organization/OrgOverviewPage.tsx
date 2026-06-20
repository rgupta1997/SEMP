import { useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { usePermissions } from '../../lib/permissions';
import { usePocOnboarding } from '../../lib/onboarding';
import { OrgTabs } from '../../components/OrgTabs';
import { GettingStarted } from '../../components/onboarding/GettingStarted';
import { EmptyState } from '../../components/ui';

// Organization landing tab. Hosts the getting-started checklist for managers so a
// newly-created organization opens onto "what to do next", with the other tabs
// (Teams, Members, Invitations) one click away.
export function OrgOverviewPage() {
  const { ctx } = useAuth();
  const { orgId: routeOrgId } = useParams();
  const orgId = routeOrgId ?? ctx?.organization?.id ?? ctx?.user.organization_id ?? '';
  const canManage = usePermissions().canManageOrg(orgId);
  const onboarding = usePocOnboarding(orgId, canManage);

  return (
    <div>
      {orgId && <OrgTabs orgId={orgId} />}
      {canManage ? (
        <GettingStarted
          title="Get your organization match-ready"
          subtitle="A few steps to go from sign-up to a locked roster."
          state={onboarding}
          storageKey={`onboarding-poc-${orgId}`}
          completeNote="That covered one team. If your organization fields multiple teams, repeat these steps for each — create another team, enter it into a championship, then build and lock its roster."
        />
      ) : (
        <EmptyState icon="◎" title="Organization overview" description="Find this organization’s teams, members and championships in the tabs above." />
      )}
    </div>
  );
}
