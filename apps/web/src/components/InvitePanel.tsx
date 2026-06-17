import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useApi, useApiMutation } from '../lib/hooks';
import { Avatar, Button, Card, Input, Spinner, StatusBadge, toast } from './ui';

interface Invitation {
  id: string;
  org_name: string;
  poc_mobile: string;
  status: string;
  organizations?: { id: string; name: string; short_name?: string | null } | null;
}

interface Org { id: string; name: string; short_name?: string | null; city?: string | null }

// Searchable picker over the master organization list (GET /organizations).
function OrgPicker({ value, onChange }: { value: Org | null; onChange: (o: Org | null) => void }) {
  const { data: orgs = [], isLoading } = useApi<Org[]>('/organizations');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on any click/tap outside the picker, plus Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orgs
      .filter((o) => !q
        || o.name.toLowerCase().includes(q)
        || (o.short_name ?? '').toLowerCase().includes(q)
        || (o.city ?? '').toLowerCase().includes(q))
      .slice(0, 50);
  }, [orgs, query]);

  const pick = (o: Org) => { onChange(o); setQuery(o.name); setOpen(false); };

  return (
    <div className="relative" ref={rootRef}>
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); onChange(null); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search organizations…"
      />
      {open && (
          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
            {isLoading ? (
              <div className="grid h-16 place-items-center"><Spinner /></div>
            ) : results.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-slate-400 dark:text-slate-500">
                {orgs.length === 0 ? 'No organizations in the master list yet.' : 'No organizations match your search.'}
              </p>
            ) : results.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => pick(o)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/60"
              >
                <Avatar name={o.name} size={28} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                    {o.name}{o.short_name ? <span className="ml-1.5 text-slate-400 dark:text-slate-500">({o.short_name})</span> : null}
                  </div>
                  {o.city && <div className="truncate text-xs text-slate-400 dark:text-slate-500">{o.city}</div>}
                </div>
                {value?.id === o.id && <span className="ml-auto text-brand-600 dark:text-brand-300">✓</span>}
              </button>
            ))}
          </div>
      )}
    </div>
  );
}

// Host-side invite manager: pick an organization from the master list and add its
// POC mobile. Reused in the create wizard's Invite step and the Invite tab.
export function InvitePanel({ eventId }: { eventId: string }) {
  const path = `/championships/${eventId}/invitations`;
  const { data: invites = [], isLoading } = useApi<Invitation[]>(path);
  const [org, setOrg] = useState<Org | null>(null);
  const [mobile, setMobile] = useState('');

  const invite = useApiMutation((body: any) => api('POST', path, body), [path], () => { setOrg(null); setMobile(''); });
  const cancel = useApiMutation((id: string) => api('DELETE', `${path}/${id}`), [path]);

  const submit = () => {
    if (!org) { toast.error('Pick an organization from the list'); return; }
    if (mobile.replace(/\D/g, '').length < 10) { toast.error('Enter a valid POC mobile number'); return; }
    invite.mutate({ org_name: org.name, poc_mobile: mobile.trim() },
      { onSuccess: () => toast.success('Invitation sent'), onError: (e: any) => toast.error(e.message) });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">Pick each org from the master list and add its POC mobile. They confirm and add their own teams — you don't enter rosters.</p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[200px] flex-1">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Organization</span>
          <OrgPicker value={org} onChange={setOrg} />
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
