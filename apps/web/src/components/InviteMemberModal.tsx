import { useState } from 'react';
import { ORGANIZATION_MEMBER_ROLE } from '@semp/shared';
import { api } from '../lib/api';
import { useApi, useApiMutation } from '../lib/hooks';
import { Badge, Button, Card, CardBody, Field, Input, Modal, Select, Spinner, confirmDialog, toast } from './ui';

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired' | 'declined';
  created_at: string;
  expires_at: string | null;
  invited_by: { name: string; email: string } | null;
}

interface CreatedInvitation {
  id: string;
  email: string;
  role: string;
  accept_url: string;
  dev_token?: string;
  notified_in_app: boolean;
  outside_claimed_domain: boolean;
}

const STATUS_TONE: Record<string, 'amber' | 'green' | 'slate'> = {
  pending: 'amber', accepted: 'green', revoked: 'slate', expired: 'slate', declined: 'slate',
};

// Inviting the sports office team by email (J1-E3). The difference from "add member"
// is that the invitee sets their own password and arrives with the role stated in the
// invitation - nobody ever relays a credential.
export function InviteMemberModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [sent, setSent] = useState<CreatedInvitation | null>(null);

  const path = `/organizations/${orgId}/invitations`;
  const { data: invitations = [], isLoading } = useApi<Invitation[]>(path);
  const invite = useApiMutation((body: { email: string; role: string }) => api('POST', path, body), [path]);
  const revoke = useApiMutation((id: string) => api('DELETE', `${path}/${id}`), [path]);

  const pending = invitations.filter((i) => i.status === 'pending');

  return (
    <Modal title="Invite by email" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        They get a link to set their own password and join with the role you choose. Nobody has to relay a temporary
        password.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <Field label="Email address">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="priya@iimb.ac.in" />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {ORGANIZATION_MEMBER_ROLE.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
        </div>
        <Button className="mb-3" disabled={invite.isPending || !email.trim()}
          onClick={() => invite.mutate({ email: email.trim(), role }, {
            onSuccess: (res: any) => { setSent(res); setEmail(''); },
            onError: (e: any) => toast.error(e.message),
          })}>
          {invite.isPending ? 'Sending…' : 'Send invite'}
        </Button>
      </div>

      {sent && (
        <Card className="mb-4 border-brand-200 bg-brand-50/60 dark:border-brand-500/30 dark:bg-brand-500/10">
          <CardBody className="space-y-2">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Invitation created for {sent.email}
            </p>
            {sent.outside_claimed_domain && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Heads up: that address is outside this organisation’s claimed domains. Sent anyway — just check it’s the
                right person.
              </p>
            )}
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {sent.notified_in_app
                ? 'They already have an account, so it’s waiting in their notifications.'
                : 'They don’t have an account yet — the link is how they create one.'}
            </p>
            {/* Email delivery isn't wired yet (module 02). Until it is, handing the
                inviter the link is what makes the flow usable at all. */}
            {sent.dev_token && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Email isn’t sending yet — share this link
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-xs dark:bg-slate-900">{sent.accept_url}</code>
                  <Button size="sm" variant="outline"
                    onClick={() => { navigator.clipboard?.writeText(sent.accept_url); toast.success('Link copied'); }}>
                    Copy
                  </Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <div className="mt-2">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Invitations {pending.length > 0 && `· ${pending.length} pending`}
        </h4>
        {isLoading ? <Spinner /> : invitations.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No invitations yet.</p>
        ) : (
          <div className="max-h-56 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {invitations.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{i.email}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {i.role}{i.invited_by ? ` · invited by ${i.invited_by.name}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={STATUS_TONE[i.status] ?? 'slate'}>{i.status}</Badge>
                  {i.status === 'pending' && (
                    <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" disabled={revoke.isPending}
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: 'Revoke this invitation?',
                          message: `The link sent to ${i.email} will stop working.`,
                          confirmLabel: 'Revoke',
                          tone: 'danger',
                        });
                        if (ok) revoke.mutate(i.id, { onError: (e: any) => toast.error(e.message) });
                      }}>
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end">
        <Button variant="ghost" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}
