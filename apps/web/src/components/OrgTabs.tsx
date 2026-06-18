import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { usePermissions } from '../lib/permissions';
import { api } from '../lib/api';
import { InstitutionFormModal, type InstitutionFormBody } from './InstitutionFormModal';
import { BackButton, Button, cn, toast } from './ui';

// Sub-navigation for an organization's management pages, plus a shared back link
// and (for owners/admins) an Edit-organization action.
export function OrgTabs({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const canManage = usePermissions().canManageOrg(orgId);
  const { data: org } = useApi<any>(canManage ? `/organizations/${orgId}` : null);
  const [editing, setEditing] = useState(false);

  const tabs = [
    { to: `/organizations/${orgId}/teams`, label: 'Teams' },
    { to: `/organizations/${orgId}/members`, label: 'Members' },
  ];
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-2">
        <BackButton onClick={() => navigate('/organizations')}>Back to organizations</BackButton>
        {canManage && org && <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit organization</Button>}
      </div>
      <div className="mt-3 flex gap-2">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) => cn(
              'rounded-lg px-3 py-1.5 text-sm font-semibold',
              isActive
                ? 'bg-brand-600 text-white'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
            )}
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      {editing && org && (
        <InstitutionFormModal
          mode="edit"
          initial={org}
          onClose={() => setEditing(false)}
          onSubmit={async (body: InstitutionFormBody) => {
            const updated = await api('PATCH', `/organizations/${orgId}`, body);
            toast.success('Organization updated');
            return updated;
          }}
        />
      )}
    </div>
  );
}
