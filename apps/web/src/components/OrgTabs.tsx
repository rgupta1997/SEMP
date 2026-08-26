import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { usePermissions } from '../lib/permissions';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { InstitutionFormModal, type InstitutionFormBody } from './InstitutionFormModal';
import { BackButton, Button, cn, confirmDialog, toast } from './ui';

// Sub-navigation for an organization's management pages, plus a shared back link
// and (for owners/admins) an Edit-organization action.
export function OrgTabs({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const perms = usePermissions();
  const canManage = perms.canManageOrg(orgId);
  const canDelete = perms.isOrgOwner(orgId);
  // Open read - fetch for everyone so the organization's name/title always shows.
  const { data: org } = useApi<any>(`/organizations/${orgId}`);
  // Pending championship invitations addressed to this org → badge on the Invitations tab.
  const { data: allInvites = [] } = useApi<any[]>(canManage ? '/me/invitations' : null);
  const pendingInvites = allInvites.filter((i) => i.organization_id === orgId).length;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Delete the whole org (owner-only). The API protects completed/scored matches and
  // cascades the rest; ?cascade=true is the explicit confirmation it requires.
  async function handleDelete() {
    const ok = await confirmDialog({
      title: 'Delete this organization?',
      message: `“${org?.name ?? 'This organization'}” and its teams, rosters and championship entries will be permanently removed. This can’t be undone.`,
      confirmLabel: 'Delete organization',
      tone: 'danger',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api('DELETE', `/organizations/${orgId}?cascade=true`);
      await refresh();
      toast.success('Organization deleted');
      navigate('/organizations');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
    }
  }

  const tabs = [
    { to: `/organizations/${orgId}/overview`, label: 'Overview', badge: 0 },
    { to: `/organizations/${orgId}/teams`, label: 'Teams', badge: 0 },
    { to: `/organizations/${orgId}/members`, label: 'Members', badge: 0 },
    ...(canManage ? [{ to: `/organizations/${orgId}/invitations`, label: 'Invitations', badge: pendingInvites }] : []),
    // Only an admin can change what a role grants, so only they see the tab.
    ...(canManage ? [{ to: `/organizations/${orgId}/roles`, label: 'Roles', badge: 0 }] : []),
  ];
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-2">
        <BackButton onClick={() => navigate('/organizations')}>Back to organizations</BackButton>
        {org && (canManage || canDelete) && (
          <div className="flex items-center gap-2">
            {canManage && <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit organization</Button>}
            {canDelete && <Button size="sm" variant="danger" onClick={handleDelete} disabled={deleting}>Delete</Button>}
          </div>
        )}
      </div>
      {org && (
        <div className="mt-3 flex items-center gap-3">
          {org.logo_url
            ? <img src={org.logo_url} alt="" className="h-11 w-11 rounded-xl object-cover" />
            : <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-lg font-black text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">{org.name?.slice(0, 1) ?? '◆'}</span>}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-slate-900 dark:text-slate-100">{org.name}</h1>
            {[org.short_name, org.city].filter(Boolean).length > 0 && (
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{[org.short_name, org.city].filter(Boolean).join(' · ')}</p>
            )}
          </div>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) => cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold',
              isActive
                ? 'bg-brand-600 text-white'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
            )}
          >
            {({ isActive }) => (
              <>
                {t.label}
                {t.badge > 0 && (
                  <span className={cn(
                    'grid h-5 min-w-5 place-items-center rounded-full px-1 text-xs font-bold',
                    isActive ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
                  )}>{t.badge}</span>
                )}
              </>
            )}
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
