import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useWorkspace } from '../lib/useWorkspace';
import { api } from '../lib/api';
import { useApi, useTableControls, fmtDateRange } from '../lib/hooks';
import { Button, EmptyState, Field, Input, ListToolbar, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, StatusBadge, SURFACE, toast } from '../components/ui';

interface Championship {
  id: string; name: string; slug: string; status: string;
  venue?: string | null; start_date: string; end_date: string;
  sports?: string[];
  visibility?: string; // private ones appear only for people already involved
}

/** One of the user's organisation memberships, as the auth context carries it. */
interface OrgMembership {
  organization_id: string;
  status: string;
  role: string;
  organization?: { name?: string; short_name?: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', registration_open: 'Registration open', ongoing: 'Live', completed: 'Completed',
};

/**
 * Who may enter an organisation into an event: an active owner or admin.
 *
 * The same test the enroll guard makes on the server, mirrored here for the UX - an
 * org role GRANT (Sports Admin) is not a membership role, so it opens Discover
 * without opening this.
 */
const canEnter = (m: OrgMembership) => m.status === 'active' && (m.role === 'owner' || m.role === 'admin');

const orgLabel = (m?: OrgMembership) => m?.organization?.short_name ?? m?.organization?.name ?? 'your organisation';

/**
 * Everything that goes stale the moment an application exists.
 *
 * Query keys are full URLs; refresh every /me/enrollments* variant (the Discover list
 * uses ?scope=all) so the CTA flips to "Your application" immediately.
 *
 * These calls go straight through api() rather than useApiMutation(), so they never
 * reach the app-wide MutationCache fallback in main.tsx that normally auto-invalidates
 * everything (including notifications) after a mutation with no explicit
 * meta.invalidate. Enrolling can make an already-existing notification (e.g.
 * "Registration is open", posted before this org had any relationship to the
 * championship) newly visible to this user, so the bell badge needs an explicit nudge
 * here too, or it silently sits stale until something unrelated happens to open the
 * notification drawer and invalidate it as a side effect.
 */
async function refreshAfterEnroll(qc: QueryClient) {
  await qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/me/enrollments') });
  await qc.invalidateQueries({ queryKey: ['notifications'] });
}

// Apply to participate FROM MY SPACE - pick which of your organizations to apply as,
// or create one on the fly. Players with no organization land straight in "create"
// mode, so anyone can apply directly to a championship.
//
// This popup only exists in personal space. An organisation workspace has already
// answered the question it asks.
function ApplyModal({ championship, onClose }: {
  championship: Championship;
  onClose: () => void;
}) {
  const { ctx, refresh } = useAuth();
  const qc = useQueryClient();
  const myOrgs = useMemo(
    () => ((ctx?.organizations ?? []) as OrgMembership[]).filter(canEnter),
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
      await refreshAfterEnroll(qc);
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
//
// WHO IS ENTERING IS THE WORKSPACE'S QUESTION (F-052), not this page's. The listing is
// the same either way; the CTA is not:
//
//   My Space  - you are here as yourself, so Register opens the popup, and that popup
//               is where the organisation to compete under is picked or created.
//   An org    - you chose that organisation when you entered its workspace. Register
//               enters it, and no popup asks a question already answered.
//
// An "entering as" selector above the list used to ask it a third time, and then had
// to hand its answer down into the popup to stop it being asked twice.
export function DiscoverPage() {
  const ws = useWorkspace();
  const { ctx } = useAuth();
  const qc = useQueryClient();
  const { data: championships = [], isLoading } = useApi<Championship[]>('/championships');
  // scope=all so an application made under ANY of the user's orgs (incl. one just
  // created via the apply flow) flips the card's CTA to "Your application".
  const { data: enrollments = [] } = useApi<any[]>('/me/enrollments?scope=all');
  const [sport, setSport] = useState('');
  const [status, setStatus] = useState('');
  const [applying, setApplying] = useState<Championship | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // The organisation this Discover belongs to, if any. Undefined in personal space,
  // and in an event or assignment workspace - neither of which enters anybody.
  const activeOrg = useMemo(() => {
    if (ws.active?.kind !== 'org') return undefined;
    const id = ws.active.id;
    return ((ctx?.organizations ?? []) as OrgMembership[]).find((m) => m.organization_id === id);
  }, [ws.active, ctx]);
  const mayEnter = !activeOrg || canEnter(activeOrg);

  // In an organisation, only ITS application counts: one made under another of your
  // organisations is not this one's, and reporting it here would tell an org it had
  // applied when it had not.
  const enrollmentStatusFor = (eventId: string) =>
    enrollments.find((e) =>
      e.championship_id === eventId && (!activeOrg || e.organization_id === activeOrg.organization_id),
    )?.status as string | undefined;

  const registerActiveOrg = async (c: Championship) => {
    if (!activeOrg) return;
    setBusyId(c.id);
    try {
      await api('POST', `/championships/${c.id}/enroll`, { organization_id: activeOrg.organization_id });
      await refreshAfterEnroll(qc);
      toast.success('Application submitted', `${orgLabel(activeOrg)} has applied to ${c.name}. You can enter teams once the organiser approves.`);
    } catch (e: any) {
      toast.error('Could not register', e.message);
    } finally {
      setBusyId(null);
    }
  };

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
      <PageHeader
        title="Discover"
        subtitle={activeOrg
          ? `Championships open to ${activeOrg.organization?.name ?? 'your organisation'} - registering enters this organisation.`
          : 'Championships open to you - to play in yourself, or to enter an organisation into.'}
      />

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
          <div className={`overflow-x-auto ${SURFACE}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left font-mono text-[9px] uppercase tracking-[0.13em] text-slate-500 dark:border-slate-800">
                  <th className="px-4 py-3">Championship</th>
                  <th className="px-4 py-3">Sports</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="w-px whitespace-nowrap px-4 py-3 text-right">Entry</th>
                </tr>
              </thead>
              <tbody>
                {tc.view.map((c) => {
                  const sports = c.sports ?? [];
                  const applied = enrollmentStatusFor(c.id);
                  return (
                    <tr key={c.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                      <td className="px-4 py-3">
                        <Link to={`/championships/${c.id}`} className="font-semibold text-slate-900 hover:text-brand-600 dark:text-slate-100">
                          {c.name}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {c.venue || 'Venue TBD'} · {fmtDateRange(c.start_date, c.end_date)}
                        </div>
                      </td>
                      {/* Sports were the card's third line; as a column they stay
                          scannable down the list instead of per-tile. */}
                      <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                        {sports.length === 0 ? (
                          <span className="text-slate-400 dark:text-slate-600">—</span>
                        ) : (
                          <span title={sports.join(', ')}>
                            {sports.slice(0, 3).join(' · ')}{sports.length > 3 ? ` +${sports.length - 3}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {c.visibility === 'private' && <StatusBadge status="private" label="Private" />}
                          <StatusBadge status={c.status} />
                        </div>
                      </td>
                      {/* Every state in this cell is one right-aligned, nowrap row of
                          the same height - a button, a badge, or a link. The column
                          shrinks to its content (w-px) so the name column keeps the
                          slack, and nothing here reflows as the page filters. */}
                      <td className="w-px whitespace-nowrap px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {applied ? (
                            <>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {activeOrg ? orgLabel(activeOrg) : 'You'}
                              </span>
                              <StatusBadge status={applied} />
                            </>
                          ) : c.status !== 'registration_open' ? (
                            <Link to={`/championships/${c.id}`} className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300">
                              View →
                            </Link>
                          ) : activeOrg ? (
                            // Discover reaches Sports Admin, who holds the org by grant
                            // rather than by membership - the server would refuse the
                            // application, so name who can make it instead of offering a
                            // button that fails.
                            !mayEnter ? (
                              <span className="text-xs text-slate-400 dark:text-slate-500" title={`An owner or admin of ${orgLabel(activeOrg)} can enter it into this championship.`}>
                                Owner or admin only
                              </span>
                            ) : (
                              <Button size="sm" disabled={busyId === c.id} title={`Register ${orgLabel(activeOrg)}`} onClick={() => registerActiveOrg(c)}>
                                {busyId === c.id ? 'Registering…' : 'Register'}
                              </Button>
                            )
                          ) : (
                            <Button size="sm" onClick={() => setApplying(c)}>Register</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={tc.page} pageCount={tc.pageCount} total={tc.total} pageSize={tc.pageSize} onPage={tc.setPage} />
        </>
      )}

      {applying && <ApplyModal championship={applying} onClose={() => setApplying(null)} />}
    </div>
  );
}
