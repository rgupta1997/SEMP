import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { usePermissions } from '../lib/permissions';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { InstitutionFormModal, type InstitutionFormBody } from './InstitutionFormModal';
import { BackButton, Button, confirmDialog, toast } from './ui';

// The organisation's identity strip: who you are looking at, and the two actions
// that belong to the organisation as a whole rather than to any one page.
//
// It used to carry a tab rail as well. That rail is gone, and deliberately: the
// sidebar now navigates the organisation (Dashboard, Players, Teams, Events...)
// and Administration owns the settings surfaces its own rail lists. Two navs over
// one workspace, with different names for the same destinations, teaches people
// that neither one is complete.
export function OrgHeader({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const perms = usePermissions();
  const canManage = perms.canManageOrg(orgId);
  const canDelete = perms.isOrgOwner(orgId);
  // Open read - fetch for everyone so the organization's name/title always shows.
  const { data: org } = useApi<any>(`/organizations/${orgId}`);
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
