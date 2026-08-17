import { useMemo, useRef, useState } from 'react';
import { ORGANIZATION_MEMBER_ROLE } from '@semp/shared';
import { api } from '../lib/api';
import { useApi, useApiMutation } from '../lib/hooks';
import { downloadCsvTemplate, parseDelimitedText, readFileToMatrix } from '../lib/import';
import { titleCase } from '../lib/format';
import { Badge, Button, Card, CardBody, Field, Modal, Select, Spinner, Tabs, Textarea, confirmDialog, toast } from './ui';

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

interface BulkResult {
  sent: CreatedInvitation[];
  skipped: { email: string; reason: string }[];
}

const STATUS_TONE: Record<string, 'amber' | 'green' | 'slate'> = {
  pending: 'amber', accepted: 'green', revoked: 'slate', expired: 'slate', declined: 'slate',
};

// Anything mail-shaped, pulled out of a cell rather than matched against the whole
// of it - so "Priya Sharma <priya@iimb.ac.in>" pasted out of a mail client works as
// well as a bare address.
const EMAIL_RE = /[^\s,;<>"']+@[^\s,;<>"']+\.[^\s,;<>"']+/g;
// The extractor above is deliberately greedy so it can find an address inside
// "Priya <priya@x.com>"; this is the one that decides whether what it found is
// actually sendable. The server checks again - this only spares the round trip.
const VALID_EMAIL = /^[^\s@,;<>"']+@[^\s@,;<>"'.]+(\.[^\s@,;<>"'.]+)+$/;
const ROLES = ORGANIZATION_MEMBER_ROLE as readonly string[];
// Header cells to step over silently instead of reporting as bad addresses.
const HEADERS = new Set(['email', 'e-mail', 'email address', 'address', 'role', 'name', 'full name']);

interface ParsedInvite {
  email: string;
  role?: string;
  /** null = ready to send; otherwise why this line can't be */
  error: string | null;
}

// One parser for both sources: a pasted block and an uploaded sheet arrive here as
// the same string matrix. Per row we take every address we can find and, if one of
// the other cells names a role, that role - which is what makes a two-column
// email,role sheet and a plain list of addresses the same feature.
function parseInvites(matrix: string[][]): ParsedInvite[] {
  const out: ParsedInvite[] = [];
  const seen = new Set<string>();

  for (const row of matrix) {
    const cells = row.flatMap((c) => c.split(/[\s,;]+/)).map((c) => c.trim()).filter(Boolean);
    if (cells.length === 0) continue;

    const emails = row.join(' ').match(EMAIL_RE) ?? [];
    if (emails.length === 0) {
      // A header line, or a stray label - only shout about the ones that look like
      // somebody meant them to be an address.
      if (cells.every((c) => HEADERS.has(c.toLowerCase()) || ROLES.includes(c.toLowerCase()))) continue;
      out.push({ email: cells.join(' '), error: 'Not an email address' });
      continue;
    }

    const role = cells.map((c) => c.toLowerCase()).find((c) => ROLES.includes(c));
    for (const raw of emails) {
      const email = raw.toLowerCase();
      const error = !VALID_EMAIL.test(email) ? 'Invalid email'
        : seen.has(email) ? 'Listed more than once'
        : null;
      out.push({ email, role, error });
      seen.add(email);
    }
  }
  return out;
}

// Inviting the sports office team by email (J1-E3). The difference from "add member"
// is that the invitee sets their own password and arrives with the role stated in the
// invitation - nobody ever relays a credential.
//
// One address or two hundred is the same flow: the box takes a pasted list and the
// other tab takes the CSV/Excel an institution already keeps its staff list in, both
// through the same parser, both through POST /invitations/bulk. A batch reports per
// address, so an already-registered member doesn't cost the rest their invitation.
export function InviteMemberModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const [tab, setTab] = useState('paste');
  const [text, setText] = useState('');
  const [matrix, setMatrix] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [role, setRole] = useState('member');
  const [result, setResult] = useState<BulkResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const path = `/organizations/${orgId}/invitations`;
  const { data: invitations = [], isLoading } = useApi<Invitation[]>(path);
  const invite = useApiMutation((body: { invites: { email: string; role?: string }[]; role: string }) =>
    api('POST', `${path}/bulk`, body), [path]);
  const revoke = useApiMutation((id: string) => api('DELETE', `${path}/${id}`), [path]);

  const pending = invitations.filter((i) => i.status === 'pending');

  const parsed = useMemo(() => {
    const src = tab === 'file' ? matrix : (text.trim() ? parseDelimitedText(text) : null);
    return src ? parseInvites(src) : [];
  }, [tab, text, matrix]);
  const ready = parsed.filter((p) => !p.error);
  const bad = parsed.length - ready.length;

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setFileError(null);
    try {
      setMatrix(await readFileToMatrix(file));
      setFileName(file.name);
    } catch (e: any) {
      setFileError(e?.message ?? 'Could not read that file');
    }
  };

  const send = () => {
    if (ready.length === 0) return;
    invite.mutate(
      { invites: ready.map((p) => ({ email: p.email, ...(p.role ? { role: p.role } : {}) })), role },
      {
        onSuccess: (res: BulkResult) => {
          setResult(res);
          setText(''); setMatrix(null); setFileName('');
          if (res.sent.length) toast.success(`${res.sent.length} invitation${res.sent.length === 1 ? '' : 's'} sent`);
        },
        onError: (e: any) => toast.error(e.message),
      },
    );
  };

  const links = (result?.sent ?? []).filter((s) => s.dev_token);
  const copyAll = () => {
    navigator.clipboard?.writeText(links.map((s) => `${s.email}\t${s.accept_url}`).join('\n'));
    toast.success('All links copied');
  };

  return (
    <Modal title="Invite by email" onClose={onClose} wide>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Each person gets a link to set their own password and join with the role you choose. Invite one address or paste
        the whole list - nobody has to relay a temporary password.
      </p>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="w-44">
          <Field label="Role for this batch">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {ORGANIZATION_MEMBER_ROLE.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
            </Select>
          </Field>
        </div>
        <p className="mb-3 max-w-xs text-xs text-slate-400 dark:text-slate-500">
          Applies to every address without its own role. Add a <span className="font-medium">role</span> column to set
          them individually.
        </p>
      </div>

      <div className="mb-3">
        <Tabs active={tab} onChange={setTab} tabs={[{ id: 'paste', label: 'Type or paste' }, { id: 'file', label: 'Upload CSV / Excel' }]} />
      </div>

      {tab === 'paste' ? (
        <div>
          <Textarea
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'priya@iimb.ac.in\nrahul@iimb.ac.in, admin\nkiran@iimb.ac.in'}
          />
          <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
            One per line, or separated by commas. Add a role after an address to override the batch role.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileInput} type="file" accept=".csv,.xlsx,.xls,.txt" className="hidden"
              onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
            <Button variant="outline" onClick={() => fileInput.current?.click()}>Choose a file</Button>
            <Button variant="ghost" size="sm"
              onClick={() => downloadCsvTemplate('invite-emails-sample.csv', ['email', 'role'], [
                ['priya@iimb.ac.in', 'admin'],
                ['rahul@iimb.ac.in', 'captain'],
                ['kiran@iimb.ac.in', ''],
              ])}>
              ↓ Download sample CSV
            </Button>
            {fileName && <span className="text-sm text-slate-500 dark:text-slate-400">{fileName}</span>}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            An <span className="font-medium">email</span> column is all that's required; a <span className="font-medium">role</span> column
            is optional. A header row is fine either way.
          </p>
          {fileError && <p className="text-sm text-rose-600 dark:text-rose-400">{fileError}</p>}
        </div>
      )}

      {parsed.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
            <span className="text-emerald-600 dark:text-emerald-400">{ready.length} to invite</span>
            {bad > 0 && <span className="text-rose-600 dark:text-rose-400"> · {bad} skipped</span>}
          </div>
          <div className="max-h-44 divide-y divide-slate-100 overflow-auto rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {parsed.map((p, i) => (
              <div key={`${p.email}-${i}`} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                <span className={`truncate ${p.error ? 'text-slate-400 line-through dark:text-slate-500' : 'text-slate-700 dark:text-slate-300'}`}>
                  {p.email}
                </span>
                <span className="shrink-0 text-xs">
                  {p.error
                    ? <span className="text-rose-600 dark:text-rose-400">{p.error}</span>
                    : <span className="text-slate-500 dark:text-slate-400">{titleCase(p.role ?? role)}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button disabled={ready.length === 0 || invite.isPending} onClick={send}>
          {invite.isPending ? 'Sending…' : `Send ${ready.length || ''} invitation${ready.length === 1 ? '' : 's'}`}
        </Button>
      </div>

      {result && (
        <Card className="mt-4 border-brand-200 bg-brand-50/60 dark:border-brand-500/30 dark:bg-brand-500/10">
          <CardBody className="space-y-3 pt-4">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {result.sent.length} invitation{result.sent.length === 1 ? '' : 's'} sent
              {result.skipped.length > 0 && ` · ${result.skipped.length} skipped`}
            </p>

            {result.sent.some((s) => s.outside_claimed_domain) && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Some of those addresses are outside this organisation’s claimed domains. Sent anyway — just check they’re
                the right people.
              </p>
            )}

            {result.skipped.length > 0 && (
              <div className="space-y-1">
                {result.skipped.map((s) => (
                  <p key={s.email} className="text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-medium">{s.email}</span> — {s.reason}
                  </p>
                ))}
              </div>
            )}

            {/* Email delivery isn't wired yet (module 02). Until it is, handing the
                inviter the links is what makes the flow usable at all. */}
            {links.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Email isn’t sending yet — share these links
                  </p>
                  {links.length > 1 && <Button size="sm" variant="outline" onClick={copyAll}>Copy all</Button>}
                </div>
                <div className="max-h-40 space-y-1 overflow-auto">
                  {links.map((s) => (
                    <div key={s.id} className="flex items-center gap-2">
                      <span className="w-40 shrink-0 truncate text-xs text-slate-600 dark:text-slate-300">{s.email}</span>
                      <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-xs dark:bg-slate-900">{s.accept_url}</code>
                      <Button size="sm" variant="ghost"
                        onClick={() => { navigator.clipboard?.writeText(s.accept_url); toast.success('Link copied'); }}>
                        Copy
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <div className="mt-5">
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
