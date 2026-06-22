import { useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { usePermissions } from '../../lib/permissions';
import { useApi } from '../../lib/hooks';
import { OrgTabs } from '../../components/OrgTabs';
import { InvitationsInbox } from '../../components/InvitationsInbox';
import { EmptyState, PageHeader, Spinner } from '../../components/ui';

// The org's "Invitations" tab - every championship invitation addressed to this
// organization, in one place. Accepting auto-approves the org for that championship
// so it can immediately enter teams.
export function InvitationsPage() {
  const { ctx } = useAuth();
  const { orgId: routeOrgId } = useParams();
  const orgId = routeOrgId ?? ctx?.organization?.id ?? ctx?.user.organization_id ?? '';
  const canManage = usePermissions().canManageOrg(orgId);
  const { data: allInvites = [], isLoading } = useApi<any[]>(canManage && orgId ? '/me/invitations' : null);
  const invites = allInvites.filter((i) => i.organization_id === orgId);

  return (
    <div>
      {orgId && <OrgTabs orgId={orgId} />}
      <PageHeader title="Invitations" subtitle="Championships that have invited this organization. Accept to join and start entering teams." />

      {!canManage ? (
        <EmptyState icon="✉️" title="Only owners & admins can manage invitations"
          description="Ask an owner or admin of this organization to review its championship invitations." />
      ) : isLoading ? (
        <Spinner />
      ) : invites.length === 0 ? (
        <EmptyState icon="✉️" title="No pending invitations"
          description="When a championship invites this organization, it’ll show up here to accept or decline." />
      ) : (
        <InvitationsInbox organizationId={orgId} />
      )}
    </div>
  );
}
