import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useApi, useTableControls, fmtDateRange } from '../lib/hooks';
import { Button, Card, EmptyState, Field, Input, ListToolbar, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, StatusBadge, toast } from '../components/ui';

interface Championship {
  id: string; name: string; slug: string; status: string;
  venue?: string | null; start_date: string; end_date: string;
  sports?: string[];
  visibility?: string; // private ones appear only for people already involved
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', registration_open: 'Registration open', ongoing: 'Live', completed: 'Completed',
};

// Apply to participate - pick which of your organizations to apply as, or create one
// on the fly. Players with no organization land straight in "create" mode, so anyone
// can apply directly to a championship.
function ApplyModal({ championship, onClose }: { championship: Championship; onClose: () => void }) {
  const { ctx, refresh } = useAuth();
  const qc = useQueryClient();
  const myOrgs = useMemo(
    () => (ctx?.organizations ?? []).filter((m) => m.status === 'active' && (m.role === 'owner' || m.role === 'admin')),
    [ctx],
  );
  const [mode, setMode] = useState<'pick' | 'create'>(myOrgs.length ? 'pick' : 'create');
  const [orgId, setOrgId] = useState(myOrgs[0]?.organization_id ?? '');
  const [newName, setNewName] = useState('');
  const [newCity, setNewCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      let applyOrgId = orgId;
      if (mode === 'create') {
        if (!newName.trim()) { setError('Organization name is required'); setBusy(false); return; }
        const org: any = await api('POST', '/organizations', { name: newName.trim(), city: newCity || undefined });
        applyOrgId = org.id;
        await refresh(); // pick the new org up in context (so the user can manage it)
      }
      if (!applyOrgId) { setError('Pick an organization to apply as'); setBusy(false); return; }
      await api('POST', `/championships/${championship.id}/enroll`, { organization_id: applyOrgId });
      // Query keys are full URLs; refresh every /me/enrollments* variant (the Discover
      // list uses ?scope=all) so the CTA flips to "Your application" immediately.
      await qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/me/enrollments') });
      toast.success('Application submitted', 'You can enter teams once the organiser approves you.');
      onClose();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Participate in ${championship.name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Apply as one of your organizations, or create a new one to compete under.</p>
      {myOrgs.length > 0 && (
        <div className="mb-3 inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {(['pick', 'create'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${mode === m ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>
              {m === 'pick' ? 'Existing organization' : 'New organization'}
            </button>
          ))}
        </div>
      )}
      {mode === 'pick' ? (
        <Field label="Apply as">
          <Select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            {myOrgs.map((m) => <option key={m.organization_id} value={m.organization_id}>{m.organization?.name}</option>)}
          </Select>
        </Field>
      ) : (
        <>
          <Field label="Organization name"><Input value={newName} autoFocus onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Rohit Sports Club" /></Field>
          <Field label="City (optional)"><Input value={newCity} onChange={(e) => setNewCity(e.target.value)} placeholder="Mumbai" /></Field>
        </>
      )}
      {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Apply to participate'}</Button>
      </div>
    </Modal>
  );
}

// Discover - every championship on the platform, open to any signed-in user.
// Searchable and filterable by sport / status so the list never dumps everything.
// Anyone can apply to participate via the per-card CTA (choosing or creating an org).
export function DiscoverPage() {
  const { data: championships = [], isLoading } = useApi<Championship[]>('/championships');
  // scope=all so an application made under ANY of the user's orgs (incl. one just
  // created via the apply flow) flips the card's CTA to "Your application".
  const { data: enrollments = [] } = useApi<any[]>('/me/enrollments?scope=all');
  const [sport, setSport] = useState('');
  const [status, setStatus] = useState('');
  const [applying, setApplying] = useState<Championship | null>(null);

  const enrollmentStatusFor = (eventId: string) =>
    enrollments.find((e) => e.championship_id === eventId)?.status as string | undefined;

  const sportOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of championships) for (const s of c.sports ?? []) set.add(s);
    return [...set].sort();
  }, [championships]);
  const statusOptions = useMemo(
    () => [...new Set(championships.map((c) => c.status))].sort(),
    [championships],
  );

  const filtered = useMemo(
    () => championships.filter((c) =>
      (!sport || (c.sports ?? []).includes(sport)) &&
      (!status || c.status === status)),
    [championships, sport, status],
  );

  const tc = useTableControls(filtered, {
    search: (c) => `${c.name} ${c.venue ?? ''} ${(c.sports ?? []).join(' ')}`,
    sorts: {
      start: (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime(),
      name: (a, b) => String(a.name).localeCompare(String(b.name)),
    },
    initialSort: 'start',
    pageSize: 12,
  });

  return (
    // pb-20 keeps the bottom pagination clear of the floating Feedback button.
    <div className="pb-20">
      <PageHeader title="Find your next game" subtitle="Championships, organizations & teams looking for players." />
      {championships.length > 0 && (
        <ListToolbar>
          <SearchInput value={tc.query} onChange={tc.setQuery} placeholder="Search championships…" className="w-full sm:w-72" />
          <Select value={sport} onChange={(e) => setSport(e.target.value)} className="w-auto" aria-label="Filter by sport">
            <option value="">All sports</option>
            {sportOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Filter by status">
            <option value="">All statuses</option>
            {statusOptions.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
          </Select>
        </ListToolbar>
      )}
      {isLoading ? <Spinner /> : tc.total === 0 ? (
        <EmptyState
          icon="◈"
          title={championships.length === 0 ? 'No championships yet' : 'No championships match'}
          description={championships.length === 0
            ? 'When an organiser hosts a championship it will show up here.'
            : 'Try a different sport, status or search term.'}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tc.view.map((c) => (
              <Card key={c.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-lg font-black text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">{c.name.slice(0, 1)}</span>
                  <div className="flex items-center gap-1.5">
                    {c.visibility === 'private' && <StatusBadge status="private" label="Private" />}
                    <StatusBadge status={c.status} />
                  </div>
                </div>
                <h3 className="mt-3 font-semibold text-slate-900 dark:text-slate-100">{c.name}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">{c.venue || 'Venue TBD'} · {fmtDateRange(c.start_date, c.end_date)}</p>
                {(c.sports ?? []).length > 0 && (
                  <p className="mt-2 truncate text-xs text-slate-400 dark:text-slate-500" title={(c.sports ?? []).join(', ')}>
                    {(c.sports ?? []).slice(0, 4).join(' · ')}{(c.sports ?? []).length > 4 ? ` +${(c.sports ?? []).length - 4}` : ''}
                  </p>
                )}
                <div className="mt-4 flex-1" />
                {(() => {
                  const applied = enrollmentStatusFor(c.id);
                  if (applied) {
                    return (
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Your application</span>
                        <StatusBadge status={applied} />
                      </div>
                    );
                  }
                  if (c.status === 'registration_open') {
                    return (
                      <Button className="mb-2 w-full" onClick={() => setApplying(c)}>Apply to participate</Button>
                    );
                  }
                  return null;
                })()}
                <Link to={`/championships/${c.id}`} className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300">View details →</Link>
              </Card>
            ))}
          </div>
          <Pagination page={tc.page} pageCount={tc.pageCount} total={tc.total} pageSize={tc.pageSize} onPage={tc.setPage} />
        </>
      )}

      {applying && <ApplyModal championship={applying} onClose={() => setApplying(null)} />}
    </div>
  );
}
