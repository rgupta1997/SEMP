import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { usePermissions } from '../../lib/permissions';
import { useApi } from '../../lib/hooks';
import { OrgTabs } from '../../components/OrgTabs';
import { InvitationsInbox } from '../../components/InvitationsInbox';
import { OutboundApplications } from '../../components/OutboundApplications';
import { EmptyState, PageHeader, Spinner, Tabs } from '../../components/ui';

// Two directions, one page: championships that invited this organisation, and
// championships this organisation applied to (FR-DIS-4). They were always two halves
// of the same question - "where do we stand with everyone?" - and only the first half
// had anywhere to live.
export function InvitationsPage() {
  const { ctx } = useAuth();
  const { orgId: routeOrgId } = useParams();
  const orgId = routeOrgId ?? ctx?.organization?.id ?? ctx?.user.organization_id ?? '';
  const canManage = usePermissions().canManageOrg(orgId);
  const [tab, setTab] = useState('inbound');
  const { data: allInvites = [], isLoading } = useApi<any[]>(canManage && orgId ? '/me/invitations' : null);
  const invites = allInvites.filter((i) => i.organization_id === orgId);

  return (
    <div>
      {orgId && <OrgTabs orgId={orgId} />}
      <PageHeader
        title="Invitations & applications"
        subtitle="Championships that invited this organization, and the ones you've applied to."
      />

      {!canManage ? (
        <EmptyState icon="✉️" title="Only owners & admins can manage invitations"
          description="Ask an owner or admin of this organization to review its championship invitations." />
      ) : (
        <>
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'inbound', label: `Invitations${invites.length ? ` (${invites.length})` : ''}` },
              { id: 'outbound', label: 'Our applications' },
            ]}
          />
          <div className="mt-4">
            {tab === 'inbound' ? (
              isLoading ? <Spinner /> : invites.length === 0 ? (
                <EmptyState icon="✉️" title="No pending invitations"
                  description="When a championship invites this organization, it’ll show up here to accept or decline." />
              ) : (
                <InvitationsInbox organizationId={orgId} />
              )
            ) : (
              <OutboundApplications orgId={orgId} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
