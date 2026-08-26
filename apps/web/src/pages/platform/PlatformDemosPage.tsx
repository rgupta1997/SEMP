import { useMemo, useState } from 'react';
import {
  DEMO_DEFAULT_SPORTS, DEMO_ORG_TEMPLATES, DEMO_CHAMP_KINDS,
  type DemoChampKind, type DemoSandboxStatus,
} from '@semp/shared';
import { api } from '../../lib/api';
import { fmtDateTime, useApi, useApiMutation } from '../../lib/hooks';
import {
  Badge, Button, Card, confirmDialog, EmptyState, Field, Input, Modal, Spinner, Textarea, toast,
} from '../../components/ui';

interface DemoSandbox {
  id: string;
  client_name: string;
  slug: string;
  email_domain: string;
  brand_color?: string | null;
  visibility?: 'public' | 'private';
  status: DemoSandboxStatus;
  error?: string | null;
  organiser_email: string;
  organiser_password?: string | null;
  organiser_user_id?: string | null;
  created_at: string;
  last_seeded_at?: string | null;
  counts: { championships: number; organizations: number; teams: number; users: number; fixtures: number };
}

const BUSY: DemoSandboxStatus[] = ['seeding', 'resetting', 'deleting'];
const KIND_LABELS: Record<DemoChampKind, string> = {
  college: 'College orgs', school: 'School orgs', corporate: 'Corporate orgs', public: 'Public/club orgs',
};

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success('Copied', `${what} copied to clipboard.`),
    () => toast.error('Copy failed', 'Select and copy manually.'),
  );
}

export function PlatformDemosPage() {
  const { data: items = [], isLoading } = useApi<DemoSandbox[]>('/demos', true, {
    // Poll while any sandbox is mid-job so status flips to ready/error by itself.
    refetchInterval: (q: any) =>
      ((q.state.data as DemoSandbox[] | undefined) ?? []).some((r) => BUSY.includes(r.status)) ? 3000 : false,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const reset = useApiMutation((id: string) => api('POST', `/demos/${id}/reset`), ['/demos']);
  const remove = useApiMutation((id: string) => api('DELETE', `/demos/${id}`), ['/demos']);

  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>;

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Personalized demo environments — each sandbox seeds four client-branded championships at different stages
        (completed, mid-flight, just-starting, finals) under a dedicated demo organiser login. Visible to platform admins only.
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold dark:text-slate-100">Demo Sandboxes</h2>
        <Button onClick={() => setShowCreate(true)}>New sandbox</Button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon="🧪" title="No demo sandboxes" description="Create one to spin up a fully-populated, client-branded demo in about a minute." />
      ) : (
        <Card className="overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2">Client</th>
                <th className="px-4 py-2">Organiser login</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Data</th>
                <th className="px-4 py-2">Seeded</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {items.map((r) => {
                const isBusy = BUSY.includes(r.status) || reset.isPending || remove.isPending;
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {r.brand_color && <span className="inline-block h-3.5 w-3.5 rounded-full border border-slate-200 dark:border-slate-800" style={{ background: r.brand_color }} />}
                        <span className="font-medium text-slate-700 dark:text-slate-200">{r.client_name}</span>
                        {r.visibility === 'private' && <Badge tone="violet">private</Badge>}
                      </div>
                      <div className="text-xs text-slate-400 dark:text-slate-500">{r.slug}</div>
                    </td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                      <button type="button" className="hover:underline" title="Copy email" onClick={() => copy(r.organiser_email, 'Email')}>{r.organiser_email}</button>
                      {r.organiser_password && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                          <span className="font-mono">{revealed[r.id] ? r.organiser_password : '••••••••••'}</span>
                          <button type="button" className="underline" onClick={() => setRevealed((s) => ({ ...s, [r.id]: !s[r.id] }))}>
                            {revealed[r.id] ? 'hide' : 'show'}
                          </button>
                          <button type="button" className="underline" onClick={() => copy(r.organiser_password!, 'Password')}>copy</button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {BUSY.includes(r.status) ? (
                        <Badge tone="amber"><span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />{r.status}…</Badge>
                      ) : r.status === 'ready' ? (
                        <Badge tone="green">ready</Badge>
                      ) : (
                        <Badge tone="rose">error</Badge>
                      )}
                      {r.status === 'error' && r.error && (
                        <div className="mt-1 max-w-[16rem] truncate text-xs text-rose-500" title={r.error}>{r.error}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                      {r.counts.championships} champs · {r.counts.teams} teams · {r.counts.users} users
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {r.last_seeded_at ? fmtDateTime(r.last_seeded_at) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" disabled={isBusy}
                        onClick={async () => {
                          const ok = await confirmDialog({
                            title: `Reset ${r.client_name} demo`,
                            confirmLabel: 'Reset',
                            message: 'Wipe everything in this sandbox — including anything the client created — and re-seed the identical demo? Logins stay the same.',
                          });
                          if (ok) reset.mutate(r.id, { onError: (e: any) => toast.error('Reset failed', e?.message) } as any);
                        }}>
                        Reset
                      </Button>
                      <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" disabled={isBusy}
                        onClick={async () => {
                          const ok = await confirmDialog({
                            title: `Delete ${r.client_name} demo`,
                            confirmLabel: 'Delete',
                            tone: 'danger',
                            message: 'Erase this sandbox and every trace of its data (championships, teams, users, logins)? This cannot be undone.',
                          });
                          if (ok) remove.mutate(r.id, { onError: (e: any) => toast.error('Delete failed', e?.message) } as any);
                        }}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {showCreate && <CreateSandboxModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

/* --------------------------- create form --------------------------- */

function CreateSandboxModal({ onClose }: { onClose: () => void }) {
  const { data: catalog = [] } = useApi<{ id: string; name: string; icon?: string | null }[]>('/sports');
  const [clientName, setClientName] = useState('');
  const [brandColor, setBrandColor] = useState('#2563eb');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [sports, setSports] = useState<string[]>([...DEMO_DEFAULT_SPORTS]);
  const [orgNames, setOrgNames] = useState<Partial<Record<DemoChampKind, string>>>({});
  const [customNames, setCustomNames] = useState('');
  const [organiserMode, setOrganiserMode] = useState<'create' | 'attach'>('create');
  const [attachEmail, setAttachEmail] = useState('');
  const [created, setCreated] = useState<DemoSandbox | null>(null);

  // Live default preview: org names derive from the client name until edited.
  const orgDefaults = useMemo(() => {
    const c = clientName.trim() || 'Client';
    return Object.fromEntries(
      DEMO_CHAMP_KINDS.map((k) => [k, DEMO_ORG_TEMPLATES[k].map((t) => t.replace('{c}', c)).join('\n')]),
    ) as Record<DemoChampKind, string>;
  }, [clientName]);

  const create = useApiMutation(
    (body: any) => api('POST', '/demos', body),
    ['/demos'],
    (res: DemoSandbox) => setCreated(res),
  );

  const submit = () => {
    if (clientName.trim().length < 2) { toast.error('Client name required', 'Enter at least 2 characters.'); return; }
    if (sports.length < 1) { toast.error('Pick at least 1 sport'); return; }
    if (organiserMode === 'attach' && !attachEmail.trim()) { toast.error('Organiser email required', 'Enter the existing user’s email.'); return; }
    const org_names = Object.fromEntries(
      DEMO_CHAMP_KINDS
        .filter((k) => orgNames[k] !== undefined)
        .map((k) => [k, orgNames[k]!.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8)]),
    );
    create.mutate({
      client_name: clientName.trim(),
      brand_color: brandColor,
      visibility,
      sports,
      ...(Object.keys(org_names).length ? { org_names } : {}),
      ...(customNames.trim() ? { custom_names: customNames.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 20) } : {}),
      organiser: organiserMode === 'attach' ? { mode: 'attach', email: attachEmail.trim() } : { mode: 'create' },
    }, { onError: (e: any) => toast.error('Could not create sandbox', e?.message) } as any);
  };

  if (created) {
    return (
      <Modal title="Sandbox seeding" onClose={onClose} footer={<div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>}>
        <div className="space-y-3 text-sm">
          <p className="text-slate-600 dark:text-slate-300">
            <strong>{created.client_name}</strong> is being seeded — it will be ready in a minute or two.
            Share this login with the client:
          </p>
          <Card className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div><div className="text-xs uppercase text-slate-400">Organiser email</div><div className="font-mono">{created.organiser_email}</div></div>
              <Button size="sm" variant="ghost" onClick={() => copy(created.organiser_email, 'Email')}>Copy</Button>
            </div>
            {created.organiser_password && (
              <div className="flex items-center justify-between gap-2">
                <div><div className="text-xs uppercase text-slate-400">Password</div><div className="font-mono">{created.organiser_password}</div></div>
                <Button size="sm" variant="ghost" onClick={() => copy(created.organiser_password!, 'Password')}>Copy</Button>
              </div>
            )}
          </Card>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            The credentials stay visible in the sandbox list — you can retrieve them any time.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="New demo sandbox"
      onClose={onClose}
      size="2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create sandbox'}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field label="Client name" hint="Drives all branding: Tata → Tata Strikers, rahul.sharma@tata.com, Tata Motors…">
            <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Tata" autoFocus />
          </Field>
          <Field label="Brand colour">
            <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)}
              className="h-10 w-16 cursor-pointer rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800" />
          </Field>
        </div>

        <Field label="Championship visibility" hint={visibility === 'private'
          ? 'All four championships stay hidden from Discover — great for demoing the invite-only flow.'
          : 'All four championships are listed in Discover like normal public events.'}>
          <div className="flex gap-4 text-sm text-slate-600 dark:text-slate-300">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="demo-visibility" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> Public
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="demo-visibility" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> Private (invite-only)
            </label>
          </div>
        </Field>

        <Field label="Sports" hint="Tap to select — each becomes a draw in all four championships.">
          {/* Same tap-tile grid as the championship setup's Add-sports modal. */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {(catalog.length ? catalog : [...DEMO_DEFAULT_SPORTS].map((name) => ({ id: name, name, icon: undefined as string | undefined }))).map((s) => {
              const isSel = sports.includes(s.name);
              return (
                <button key={s.id} type="button"
                  onClick={() => setSports((cur) => (isSel ? cur.filter((x) => x !== s.name) : [...cur, s.name]))}
                  className={`relative flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition ${isSel ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/15' : 'border-slate-200 hover:border-brand-300 dark:border-slate-800 dark:hover:border-brand-500/50'}`}>
                  <span className="text-2xl">{s.icon || '◇'}</span>
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{s.name}</span>
                  {isSel && <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-xs text-white">✓</span>}
                </button>
              );
            })}
          </div>
        </Field>

        <details className="rounded-lg border border-slate-200 dark:border-slate-800">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300">
            Participating organizations (defaults shown — edit if the client wants specific names)
          </summary>
          <div className="grid gap-3 p-3 sm:grid-cols-2">
            {DEMO_CHAMP_KINDS.map((k) => (
              <Field key={k} label={KIND_LABELS[k]} hint="One per line, up to 8.">
                <Textarea rows={5} value={orgNames[k] ?? orgDefaults[k]} onChange={(e) => setOrgNames((s) => ({ ...s, [k]: e.target.value }))} />
              </Field>
            ))}
          </div>
        </details>

        <Field label="Familiar names (optional)" hint="One per line. These people appear as team captains so the client spots familiar faces on rosters and podiums.">
          <Textarea rows={3} value={customNames} onChange={(e) => setCustomNames(e.target.value)} placeholder={'Ratan Mehta\nAnita Deshmukh'} />
        </Field>

        <Field label="Demo organiser">
          <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" name="demo-organiser-mode" checked={organiserMode === 'create'} onChange={() => setOrganiserMode('create')} />
              Create a dedicated demo organiser login (recommended)
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" name="demo-organiser-mode" checked={organiserMode === 'attach'} onChange={() => setOrganiserMode('attach')} />
              Attach an existing user as organiser
            </label>
            {organiserMode === 'attach' && (
              <Input type="email" value={attachEmail} onChange={(e) => setAttachEmail(e.target.value)} placeholder="existing.user@example.com" />
            )}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
