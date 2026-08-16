import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { REGIONS, REGION_LABELS } from '@semp/shared';
import { useApi, useTableControls, fmtDateRange } from '../lib/hooks';
import { Button, Card, EmptyState, Field, Input, ListToolbar, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, StatusBadge, toast } from '../components/ui';

interface Championship {
  id: string; name: string; slug: string; status: string;
  country?: string | null;
  // Derived server-side from the country. null = we don't know, which is shown as
  // "Unspecified" rather than hidden.
  region?: string | null;
  venue?: string | null; start_date: string; end_date: string;
  sports?: string[];
  visibility?: string; // private ones appear only for people already involved
  // Whether someone with no institution may enter. Organiser's call (J3-E1-S5).
  allow_individual_entry?: boolean;
}

// A draw the individual-entry flow can enter. `entry_type` decides whether a squad is
// even a question: an individual draw never asks about one.
interface EnterableDraw {
  id: string;
  entry_type: string | null;
  sport: string | null;
  discipline: string | null;
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
  // "Just me" and "a group of friends" are the same mechanism (J3-E1) - the only
  // difference is whether the squad gets a name. Neither says "organisation" anywhere,
  // which is the entire point of the epic.
  const soloAllowed = championship.allow_individual_entry !== false;
  const [mode, setMode] = useState<'solo' | 'group' | 'pick' | 'create'>(
    soloAllowed && myOrgs.length === 0 ? 'solo' : myOrgs.length ? 'pick' : 'create',
  );
  const [squadName, setSquadName] = useState('');
  const [drawId, setDrawId] = useState('');
  const solo = mode === 'solo' || mode === 'group';
  // Only fetched when it's needed - most people applying are an institution.
  const { data: draws = [] } = useApi<any[]>(solo ? `/championships/${championship.id}/draws` : null);
  const enterable: EnterableDraw[] = useMemo(() => draws.map((d: any) => ({
    id: d.id,
    // The draw's own entry_type is an OVERRIDE and is null on almost every draw;
    // the real answer lives on the discipline (team / individual / doubles /
    // relay). Reading only the override meant an individual event still asked for
    // a squad name, and a handful of draws that happened to carry the override
    // stopped asking for one they needed.
    entry_type: d.entry_type ?? d.disciplines?.entry_type ?? null,
    sport: d.tournament_sports?.sports?.name ?? null,
    discipline: d.disciplines?.name ?? null,
  })), [draws]);
  const chosenDraw = enterable.find((d) => d.id === drawId);
  // Doubles and relays are squads too - only a genuinely individual event has no
  // name to give.
  const needsSquadName = mode === 'group' && !!chosenDraw && chosenDraw.entry_type !== 'individual';
  const [orgId, setOrgId] = useState(myOrgs[0]?.organization_id ?? '');
  const [newName, setNewName] = useState('');
  const [newCity, setNewCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (solo) {
        if (!drawId) { setError('Pick what you want to enter'); setBusy(false); return; }
        // Only demanded where a squad actually exists - an individual event has no
        // name to give, and asking for one would be an unanswerable error.
        if (needsSquadName && !squadName.trim()) { setError('Give your squad a name'); setBusy(false); return; }
        await api('POST', `/championships/${championship.id}/enter-individually`, {
          draw_id: drawId,
          ...(needsSquadName ? { squad_name: squadName.trim() } : {}),
        });
        await refresh();
        await qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/me/enrollments') });
        toast.success('You\u2019re entered', 'The organiser will review your entry.');
        onClose();
        return;
      }

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
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        {soloAllowed
          ? 'Enter on your own, with a few friends, or on behalf of an organization.'
          : 'Apply as one of your organizations, or create a new one to compete under.'}
      </p>
      <div className="mb-3 flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
        {([
          ...(soloAllowed ? [['solo', 'Just me'], ['group', 'A group of friends']] as const : []),
          ...(myOrgs.length ? [['pick', 'An organization'] as const] : []),
          ['create', 'A new organization'] as const,
        ]).map(([m, label]) => (
          <button key={m} type="button" onClick={() => setMode(m as typeof mode)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${mode === m ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>
            {label}
          </button>
        ))}
      </div>
      {solo ? (
        <>
          <Field label="What do you want to enter?">
            <Select value={drawId} onChange={(e) => setDrawId(e.target.value)}>
              <option value="">- pick a sport -</option>
              {enterable.map((d) => (
                <option key={d.id} value={d.id}>
                  {[d.sport, d.discipline].filter(Boolean).join(' · ')}
                </option>
              ))}
            </Select>
          </Field>
          {/* Nothing about the squad is shown until a sport is chosen. Asking for a
              name and then taking the field away once we know the answer is worse
              than asking a moment later. */}
          {mode === 'group' && !chosenDraw && (
            <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
              Pick what you're entering and we'll ask for your squad's name.
            </p>
          )}
          {needsSquadName && (
            <Field label="Squad name" hint="This is the name that appears in fixtures and standings.">
              <Input value={squadName} autoFocus onChange={(e) => setSquadName(e.target.value)} placeholder="e.g. Sunday Ballers" />
            </Field>
          )}
          {/* An individual draw has no squad, so it is never asked about (J3-E1-S1). */}
          {mode === 'group' && chosenDraw?.entry_type === 'individual' && (
            <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
              This event is contested individually, so there\u2019s no squad to name \u2014 you\u2019ll be entered as yourself.
            </p>
          )}
        </>
      ) : mode === 'pick' ? (
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
  const [region, setRegion] = useState('');
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

  // Header stats (FR-DIS-3): countries represented, competitions actually open, and
  // how many regions are in play. Counted over everything visible, not the current
  // filter - they are there to tell you what else is out there.
  const stats = useMemo(() => {
    const countries = new Set<string>();
    const regions = new Set<string>();
    let open = 0;
    for (const c of championships) {
      if (c.country) countries.add(c.country);
      if (c.region) regions.add(c.region);
      if (c.status === 'registration_open') open += 1;
    }
    return { countries: countries.size, open, regions: regions.size };
  }, [championships]);

  // Only offer a chip for a region something is actually in, plus Unspecified when
  // some championship has no country - an empty filter is a dead end. Each chip
  // carries its own count so the row reads as a summary of what is out there, not
  // just a set of switches (J3-E4-S1).
  const regionChips = useMemo(() => {
    const tally = new Map<string, number>();
    for (const c of championships) {
      const key = c.region ?? 'unspecified';
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    const chips: { value: string; label: string; count: number }[] = [
      { value: '', label: 'All regions', count: championships.length },
    ];
    for (const r of REGIONS) if (tally.has(r)) chips.push({ value: r, label: REGION_LABELS[r], count: tally.get(r)! });
    if (tally.has('unspecified')) chips.push({ value: 'unspecified', label: 'Unspecified', count: tally.get('unspecified')! });
    return chips;
  }, [championships]);

  const filtered = useMemo(
    () => championships.filter((c) =>
      (!sport || (c.sports ?? []).includes(sport)) &&
      (!status || c.status === status) &&
      (!region || (region === 'unspecified' ? !c.region : c.region === region))),
    [championships, sport, status, region],
  );

  const chipClass = (active: boolean) => [
    'rounded-full px-3 py-1.5 text-sm font-semibold transition',
    active
      ? 'bg-brand-600 text-white'
      : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  ].join(' ');

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
        <>
          {/* What's out there, before any filter is applied (FR-DIS-3). */}
          <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
            <span><b className="text-slate-800 dark:text-slate-100">{stats.open}</b> open for registration</span>
            <span><b className="text-slate-800 dark:text-slate-100">{stats.countries}</b> countr{stats.countries === 1 ? 'y' : 'ies'}</span>
            <span><b className="text-slate-800 dark:text-slate-100">{stats.regions}</b> region{stats.regions === 1 ? '' : 's'}</span>
          </div>
          {/* Shown as soon as there is a region to name. It was previously hidden until
              two regions existed, which meant the counts - the part that tells you what
              is out there - never appeared for a single-region platform. */}
          {regionChips.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {regionChips.map((r) => (
                <button key={r.value || 'all'} type="button" onClick={() => setRegion(r.value)}
                  className={chipClass(region === r.value)}
                  aria-pressed={region === r.value}
                  aria-label={`${r.label}, ${r.count} championship${r.count === 1 ? '' : 's'}`}>
                  {r.label}
                  <span className="ml-1.5 opacity-60 tabular-nums">{r.count}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

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
