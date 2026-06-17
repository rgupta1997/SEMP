import { useState } from 'react';
import { api } from '../lib/api';
import { useApi, useApiMutation } from '../lib/hooks';
import { Button, Card, Input, Spinner, StatusBadge, toast } from './ui';

interface Invitation {
  id: string;
  org_name: string;
  poc_mobile: string;
  status: string;
  organizations?: { id: string; name: string; short_name?: string | null } | null;
}

// Host-side invite manager: invite organizations to a championship by name + POC
// mobile. Reused in the create wizard's Invite step and the Invite tab.
export function InvitePanel({ eventId }: { eventId: string }) {
  const path = `/championships/${eventId}/invitations`;
  const { data: invites = [], isLoading } = useApi<Invitation[]>(path);
  const [orgName, setOrgName] = useState('');
  const [mobile, setMobile] = useState('');

  const invite = useApiMutation((body: any) => api('POST', path, body), [path], () => { setOrgName(''); setMobile(''); });
  const cancel = useApiMutation((id: string) => api('DELETE', `${path}/${id}`), [path]);

  const submit = () => {
    if (!orgName.trim()) { toast.error('Enter an organization name'); return; }
    if (mobile.replace(/\D/g, '').length < 10) { toast.error('Enter a valid POC mobile number'); return; }
    invite.mutate({ org_name: orgName.trim(), poc_mobile: mobile.trim() },
      { onSuccess: () => toast.success('Invitation sent'), onError: (e: any) => toast.error(e.message) });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">Add each org and its POC mobile. They confirm and add their own teams — you don't enter rosters.</p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[200px] flex-1">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Organization</span>
          <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g. Acme Corp" />
        </label>
        <label className="min-w-[160px]">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">POC mobile</span>
          <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="+91 …" />
        </label>
        <Button onClick={submit} disabled={invite.isPending}>{invite.isPending ? 'Inviting…' : '+ Invite'}</Button>
      </div>

      {isLoading ? <Spinner /> : invites.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          No organizations yet. Add at least two to auto-generate fixtures — or invite them later.
        </div>
      ) : (
        <div className="space-y-2">
          {invites.map((inv) => (
            <Card key={inv.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-800 dark:text-slate-200">{inv.organizations?.name ?? inv.org_name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{inv.poc_mobile}</div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={inv.status} label={inv.status === 'accepted' ? 'Accepted' : undefined} />
                {inv.status === 'pending' && (
                  <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400"
                    onClick={() => cancel.mutate(inv.id, { onSuccess: () => toast.success('Invitation cancelled'), onError: (e: any) => toast.error(e.message) })}
                    disabled={cancel.isPending}>
                    Cancel
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
