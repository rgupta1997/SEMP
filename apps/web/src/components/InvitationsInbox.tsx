import { api } from '../lib/api';
import { useApi, useApiMutation, fmtDateRange } from '../lib/hooks';
import { Button, Card, toast } from './ui';

interface Invite {
  id: string;
  org_name: string;
  organization_id: string;
  championship_id: string;
  championship_name: string;
  championship_status: string;
  start_date: string;
  end_date: string;
  venue: string | null;
}

// Shown to an owner/admin of an organization that's been invited to a championship.
// Accepting auto-approves that org for the championship. Pass `organizationId` to scope
// the inbox to a single org (e.g. on that org's manage view); omit it for the global
// "all your invitations" inbox.
export function InvitationsInbox({ organizationId, className = '' }: { organizationId?: string; className?: string } = {}) {
  const { data: allInvites = [] } = useApi<Invite[]>('/me/invitations');
  const invites = organizationId ? allInvites.filter((i) => i.organization_id === organizationId) : allInvites;

  const accept = useApiMutation(
    (id: string) => api('POST', `/invitations/${id}/accept`),
    // Auto-approved on accept (the host invited them) - refresh enrollments too so the
    // org immediately shows as approved and can enter teams.
    ['/me/invitations', '/championships/mine', '/me/enrollments'],
  );
  const decline = useApiMutation((id: string) => api('POST', `/invitations/${id}/decline`), ['/me/invitations']);

  if (invites.length === 0) return null;

  return (
    <Card className={`border-brand-200 bg-brand-50/50 p-4 dark:border-brand-500/30 dark:bg-brand-500/5 ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">✉️</span>
        <h2 className="font-semibold text-slate-900 dark:text-slate-100">You're invited{invites.length > 1 ? ` · ${invites.length}` : ''}</h2>
      </div>
      <div className="space-y-2">
        {invites.map((inv) => (
          <div key={inv.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3 dark:bg-slate-900">
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 dark:text-slate-100">{inv.championship_name}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Invited as <span className="font-medium">{inv.org_name}</span> · {inv.venue || 'Venue TBD'} · {fmtDateRange(inv.start_date, inv.end_date)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={accept.isPending}
                onClick={() => accept.mutate(inv.id,
                  { onSuccess: () => toast.success('Joined the championship', 'You can enter teams now.'), onError: (e: any) => toast.error(e.message) })}>
                Accept
              </Button>
              <Button size="sm" variant="ghost" disabled={decline.isPending}
                onClick={() => decline.mutate(inv.id, { onSuccess: () => toast.success('Invitation declined'), onError: (e: any) => toast.error(e.message) })}>
                Decline
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
