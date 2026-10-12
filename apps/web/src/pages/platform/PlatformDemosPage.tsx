import { useMemo, useState } from 'react';
import { Plus, Trash2, Copy, Users, Trophy, CalendarDays, Building2 } from 'lucide-react';
import type { DemoSandboxStatus, SeedBlueprint } from '@semp/shared';
import { api } from '../../lib/api';
import { fmtDateTime, useApi, useApiMutation } from '../../lib/hooks';
import {
  Badge, Button, Card, CardBody, CardHeader, confirmDialog, EmptyState, Field,
  Input, PageHeader, Select, Spinner, StatCard, toast,
} from '../../components/ui';

// The super-admin demo builder. One blueprint in, one fully-populated championship
// out - people, squads, fixtures, results and the records behind them.
//
// Replaces the fixed four-championship sandbox recipe. Builds made by the old
// recipe still appear in the list and still reset; the server tells them apart by
// whether their config carries `draws`.

interface Build {
  id: string;
  client_name: string;
  slug: string;
  email_domain: string;
  status: DemoSandboxStatus;
  error?: string | null;
  organiser_email: string;
  organiser_password?: string | null;
  created_at: string;
  last_seeded_at?: string | null;
  counts: { championships: number; organizations: number; teams: number; users: number; fixtures: number };
  result?: {
    championship_id: string;
    slug: string;
    start_date: string;
    end_date: string;
    counts: Record<string, number>;
    logins: Array<{ role: string; workspace: string; name: string; email: string; detail?: string }>;
  } | null;
}

interface Catalogue {
  sports: Array<{ name: string; disciplines: string[]; kind: 'single' | 'tie' | 'event' }>;
  formats: string[];
}

const BUSY: DemoSandboxStatus[] = ['seeding', 'resetting', 'deleting'];

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success('Copied', `${what} copied to clipboard.`),
    () => toast.error('Copy failed', 'Select and copy manually.'),
  );
}

type OrgRow = { name: string; short: string; city?: string };
type DrawRow = { sport: string; discipline: string; format: string; squad?: number };

const BLANK: {
  label: string; bp: Omit<SeedBlueprint, 'organizations' | 'draws'> & { organizations: OrgRow[]; draws: DrawRow[] };
} = {
  label: '',
  bp: {
    championship: {
      name: '', venue: '', city: '', description: '', visibility: 'public',
      days: 3, fixed_start: null, played_through_day: 2, live_finals: 6,
    },
    host_organization: '',
    organizations: [],
    participants_per_organization: 200,
    draws: [],
    officials: 4,
    password: 'Demo@2026',
    email_domain: 'demo.local',
    accounts: {
      organiser: { name: '', email: '' },
      player: { name: '', email: '', organization: '' },
      institution_admin: { name: '', email: '', organization: '' },
    },
    derive_records: true,
  } as any,
};

export function PlatformDemosPage() {
  const { data: items = [], isLoading, refetch } = useApi<Build[]>('/demos', true, {
    // Poll while any build is mid-job so status flips to ready/error by itself.
    refetchInterval: (q: any) =>
      ((q.state.data as Build[] | undefined) ?? []).some((r) => BUSY.includes(r.status)) ? 3000 : false,
  });
  const { data: catalogue } = useApi<Catalogue>('/demos/catalogue', true);

  const [open, setOpen] = useState(false);
  /** Which tab each ready build is showing. Keyed by build so opening one list
   *  does not switch every other card with it. */
  const [tab, setTab] = useState<Record<string, 'Key accounts' | 'All logins'>>({});
  const [form, setForm] = useState(structuredClone(BLANK));
  const bp = form.bp;

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const setBp = (patch: Partial<typeof bp>) => setForm((f) => ({ ...f, bp: { ...f.bp, ...patch } }));
  const setChamp = (patch: Partial<typeof bp.championship>) =>
    setForm((f) => ({ ...f, bp: { ...f.bp, championship: { ...f.bp.championship, ...patch } } }));
  const setAcct = (which: 'organiser' | 'player' | 'institution_admin', patch: any) =>
    setForm((f) => ({ ...f, bp: { ...f.bp, accounts: { ...f.bp.accounts, [which]: { ...(f.bp.accounts as any)[which], ...patch } } } }));

  const create = useApiMutation(
    async (body: any) => {
      try {
        return await api('POST', '/demos/builds', body);
      } catch (e: any) {
        // useApiMutation takes no onError, so the toast is raised here and the
        // error rethrown so the mutation still settles as failed.
        toast.error('Could not start the build', e?.message ?? 'Check the form and try again.');
        throw e;
      }
    },
    ['/demos'],
    () => {
      toast.success('Build started', 'This runs in the background - the card updates as it goes.');
      setOpen(false);
      setForm(structuredClone(BLANK));
      refetch();
    },
  );

  // What this blueprint will actually produce. Shown while filling the form because
  // a build is minutes, not seconds - the cost of a number is worth knowing before
  // you commit to it rather than after.
  const projection = useMemo(() => {
    const kindOf = (sport: string) => catalogue?.sports.find((s) => s.name === sport)?.kind ?? 'single';
    const teamDraws = bp.draws.filter((d) => kindOf(d.sport) !== 'event');
    const orgs = bp.organizations.length;
    const people = orgs * bp.participants_per_organization + orgs + bp.officials + 1;
    const teams = teamDraws.length * orgs;
    // Byes + quarters + two semis + final + third place, per team draw.
    const perDraw = Math.max(0, Math.min(4, Math.max(0, orgs - 4))) + Math.max(0, 4 - Math.max(0, orgs - 4)) + 4;
    const fixtures = teamDraws.length * perDraw + (bp.draws.length - teamDraws.length);
    const played = Math.round(fixtures * 0.75);
    // Measured: ~0.35s per played fixture batched eight at a time, plus the rows.
    const seconds = Math.round(people / 400 + teams / 40 + (bp.derive_records ? played * 0.35 : 0));
    return { orgs, people, teams, fixtures, played, seconds };
  }, [bp, catalogue]);

  const addOrg = () => setBp({ organizations: [...bp.organizations, { name: '', short: '', city: '' }] });
  const setOrg = (i: number, patch: Partial<OrgRow>) =>
    setBp({ organizations: bp.organizations.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const delOrg = (i: number) => setBp({ organizations: bp.organizations.filter((_, j) => j !== i) });

  const addDraw = () => {
    const first = catalogue?.sports[0];
    setBp({ draws: [...bp.draws, { sport: first?.name ?? '', discipline: first?.disciplines[0] ?? 'Mixed', format: 'Knockout' }] });
  };
  const setDraw = (i: number, patch: Partial<DrawRow>) =>
    setBp({ draws: bp.draws.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const delDraw = (i: number) => setBp({ draws: bp.draws.filter((_, j) => j !== i) });

  const orgNames = bp.organizations.map((o) => o.name).filter(Boolean);
  const problems: string[] = [];
  if (!form.label.trim()) problems.push('Give the build a label');
  if (!bp.championship.name.trim()) problems.push('Name the championship');
  if (bp.organizations.length < 2) problems.push('At least two organizations');
  if (bp.organizations.some((o) => !o.name.trim() || !o.short.trim())) problems.push('Every organization needs a name and a short name');
  if (!orgNames.includes(bp.host_organization)) problems.push('Pick a host from the organizations');
  if (!bp.draws.length) problems.push('Add at least one draw');
  if (!bp.accounts.organiser.email || !bp.accounts.player.email || !bp.accounts.institution_admin.email) problems.push('All three demo accounts need an email');
  if (bp.championship.played_through_day > bp.championship.days) problems.push('Cannot play through more days than the championship has');

  const submit = () => {
    if (problems.length) { toast.error('Not ready yet', problems[0]); return; }
    create.mutate({
      label: form.label.trim(),
      blueprint: {
        ...bp,
        championship: {
          ...bp.championship,
          venue: bp.championship.venue || undefined,
          city: bp.championship.city || undefined,
          description: bp.championship.description || undefined,
          fixed_start: bp.championship.fixed_start || null,
        },
        organizations: bp.organizations.map((o) => ({ name: o.name.trim(), short: o.short.trim(), city: o.city?.trim() || undefined })),
      },
    });
  };

  const reset = async (b: Build) => {
    if (!(await confirmDialog({
      title: `Rebuild ${b.client_name}?`,
      message: 'Everything this build made is deleted and rebuilt from the same blueprint - including anything changed during a demo. The logins stay the same.',
      confirmLabel: 'Rebuild',
    }))) return;
    try { await api('POST', `/demos/${b.id}/reset`); refetch(); }
    catch (e: any) { toast.error('Could not rebuild', e?.message ?? 'Try again.'); }
  };

  const remove = async (b: Build) => {
    if (!(await confirmDialog({
      title: `Delete ${b.client_name}?`,
      message: 'Every organization, person, team, fixture and record this build created is permanently removed. This cannot be undone.',
      confirmLabel: 'Delete', tone: 'danger',
    }))) return;
    try { await api('DELETE', `/demos/${b.id}`); refetch(); }
    catch (e: any) { toast.error('Could not delete', e?.message ?? 'Try again.'); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Demo builder"
        subtitle="Build a complete championship to a specification - people, squads, fixtures, results and the records behind them."
      >
        {!open && <Button onClick={() => setOpen(true)}><Plus size={15} /> New build</Button>}
      </PageHeader>

      {open && (
        <Card>
          <CardHeader title="New build" subtitle="Everything below is stored with the build, so a rebuild reproduces it exactly." />
          <CardBody>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 260px', gap: 24, alignItems: 'start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

                <Section title="The championship">
                  <Grid>
                    <Field label="Build label" hint="How it appears in this list">
                      <Input value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="IIMK demo" />
                    </Field>
                    <Field label="Championship name">
                      <Input value={bp.championship.name} onChange={(e) => setChamp({ name: e.target.value })} placeholder="Inter IIM - 2026" />
                    </Field>
                    <Field label="Venue">
                      <Input value={bp.championship.venue ?? ''} onChange={(e) => setChamp({ venue: e.target.value })} placeholder="IIM Kozhikode" />
                    </Field>
                    <Field label="City">
                      <Input value={bp.championship.city ?? ''} onChange={(e) => setChamp({ city: e.target.value })} placeholder="Kozhikode" />
                    </Field>
                    <Field label="Days">
                      <Input type="number" min={1} max={14} value={bp.championship.days}
                        onChange={(e) => setChamp({ days: Number(e.target.value) || 1 })} />
                    </Field>
                    <Field label="Played through day" hint="The rest are still to play">
                      <Input type="number" min={0} max={bp.championship.days} value={bp.championship.played_through_day}
                        onChange={(e) => setChamp({ played_through_day: Number(e.target.value) || 0 })} />
                    </Field>
                    <Field label="Finals left live" hint="Mid-match, for the live-scoring demo">
                      <Input type="number" min={0} max={40} value={bp.championship.live_finals}
                        onChange={(e) => setChamp({ live_finals: Number(e.target.value) || 0 })} />
                    </Field>
                    <Field label="Start date" hint="Blank = the last day is today, always mid-event">
                      <Input type="date" value={bp.championship.fixed_start ?? ''}
                        onChange={(e) => setChamp({ fixed_start: e.target.value || null })} />
                    </Field>
                    <Field label="Visibility">
                      <Select value={bp.championship.visibility} onChange={(e) => setChamp({ visibility: e.target.value as any })}>
                        <option value="public">Public</option>
                        <option value="private">Private - invite only</option>
                      </Select>
                    </Field>
                  </Grid>
                </Section>

                <Section title="Organizations" action={<Button variant="ghost" onClick={addOrg}><Plus size={14} /> Add</Button>}>
                  {bp.organizations.length === 0 && <Muted>No organizations yet. A championship needs at least two.</Muted>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {bp.organizations.map((o, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 1fr 32px', gap: 8, alignItems: 'center' }}>
                        <Input value={o.name} onChange={(e) => setOrg(i, { name: e.target.value })} placeholder="IIM Bangalore" />
                        <Input value={o.short} onChange={(e) => setOrg(i, { short: e.target.value })} placeholder="IIMB" />
                        <Input value={o.city ?? ''} onChange={(e) => setOrg(i, { city: e.target.value })} placeholder="Bengaluru" />
                        <Button variant="ghost" onClick={() => delOrg(i)} aria-label="Remove"><Trash2 size={14} /></Button>
                      </div>
                    ))}
                  </div>
                  <Grid>
                    <Field label="Host organization" hint="Runs the championship">
                      <Select value={bp.host_organization} onChange={(e) => setBp({ host_organization: e.target.value })}>
                        <option value="">Choose…</option>
                        {orgNames.map((n) => <option key={n} value={n}>{n}</option>)}
                      </Select>
                    </Field>
                    <Field label="Participants each" hint="Every one is a real account with a login">
                      <Input type="number" min={4} max={500} value={bp.participants_per_organization}
                        onChange={(e) => setBp({ participants_per_organization: Number(e.target.value) || 4 })} />
                    </Field>
                    <Field label="Officials">
                      <Input type="number" min={0} max={20} value={bp.officials}
                        onChange={(e) => setBp({ officials: Number(e.target.value) || 0 })} />
                    </Field>
                  </Grid>
                </Section>

                <Section title="Draws" action={<Button variant="ghost" onClick={addDraw}><Plus size={14} /> Add</Button>}>
                  {bp.draws.length === 0 && <Muted>No draws yet. Each one becomes a bracket with every organization entered.</Muted>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {bp.draws.map((d, i) => {
                      const sport = catalogue?.sports.find((s) => s.name === d.sport);
                      return (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 96px 32px', gap: 8, alignItems: 'center' }}>
                          <Select value={d.sport} onChange={(e) => {
                            const next = catalogue?.sports.find((s) => s.name === e.target.value);
                            setDraw(i, { sport: e.target.value, discipline: next?.disciplines[0] ?? 'Mixed' });
                          }}>
                            {(catalogue?.sports ?? []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                          </Select>
                          <Select value={d.discipline} onChange={(e) => setDraw(i, { discipline: e.target.value })}>
                            {(sport?.disciplines ?? ['Mixed']).map((x) => <option key={x} value={x}>{x}</option>)}
                          </Select>
                          <Select value={d.format} onChange={(e) => setDraw(i, { format: e.target.value })}>
                            {(catalogue?.formats ?? ['Knockout']).map((f) => <option key={f} value={f}>{f}</option>)}
                          </Select>
                          {sport?.kind === 'event'
                            ? <Badge tone="slate">individual</Badge>
                            : (
                              <Input type="number" min={1} max={30} value={d.squad ?? ''} placeholder="auto"
                                title="Squad size. Blank uses the sport's real minimum."
                                onChange={(e) => setDraw(i, { squad: e.target.value ? Number(e.target.value) : undefined })} />
                            )}
                          <Button variant="ghost" onClick={() => delDraw(i)} aria-label="Remove"><Trash2 size={14} /></Button>
                        </div>
                      );
                    })}
                  </div>
                  <Muted>Squad blank uses the sport&rsquo;s real minimum - a Cricket XI, a Basketball five. How a sport is scored is decided by the sport, not here.</Muted>
                </Section>

                <Section title="Accounts">
                  <Muted>Three logins, one per workspace. Everything else is generated.</Muted>
                  {([
                    ['organiser', 'Organiser · Events Space', false],
                    ['player', 'Player · Personal Space', true],
                    ['institution_admin', 'Institution admin · Org Space', true],
                  ] as const).map(([key, label, needsOrg]) => (
                    <div key={key} style={{ display: 'grid', gridTemplateColumns: needsOrg ? '1fr 1.3fr 1fr' : '1fr 1.3fr', gap: 8, alignItems: 'end' }}>
                      <Field label={label}>
                        <Input value={(bp.accounts as any)[key].name} onChange={(e) => setAcct(key, { name: e.target.value })} placeholder="Full name" />
                      </Field>
                      <Field label="Email">
                        <Input value={(bp.accounts as any)[key].email} onChange={(e) => setAcct(key, { email: e.target.value })} placeholder={`name@${bp.email_domain}`} />
                      </Field>
                      {needsOrg && (
                        <Field label="Organization">
                          <Select value={(bp.accounts as any)[key].organization} onChange={(e) => setAcct(key, { organization: e.target.value })}>
                            <option value="">Choose…</option>
                            {orgNames.map((n) => <option key={n} value={n}>{n}</option>)}
                          </Select>
                        </Field>
                      )}
                    </div>
                  ))}
                  <Grid>
                    <Field label="Email domain" hint="Every generated login sits on this">
                      <Input value={bp.email_domain} onChange={(e) => setBp({ email_domain: e.target.value })} placeholder="interiim.demo" />
                    </Field>
                    <Field label="Password" hint="Shared by every seeded account">
                      <Input value={bp.password} onChange={(e) => setBp({ password: e.target.value })} />
                    </Field>
                  </Grid>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5 }}>
                    <input type="checkbox" checked={bp.derive_records} style={{ marginTop: 3 }}
                      onChange={(e) => setBp({ derive_records: e.target.checked })} />
                    <span>
                      <strong>Build the records behind the results.</strong>
                      <br />
                      <span style={{ color: 'var(--muted)' }}>
                        Runs the product&rsquo;s own derivations over every played match, so players have lifetime
                        timelines, medals and statistics rather than a scoreline and nothing behind it. This is most
                        of the build time.
                      </span>
                    </span>
                  </label>
                </Section>
              </div>

              <div style={{ position: 'sticky', top: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Card>
                  <CardBody>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>This will build</div>
                    <Line icon={<Building2 size={14} />} label="Organizations" value={projection.orgs} />
                    <Line icon={<Users size={14} />} label="People" value={projection.people.toLocaleString()} />
                    <Line icon={<Trophy size={14} />} label="Teams" value={projection.teams} />
                    <Line icon={<CalendarDays size={14} />} label="Fixtures" value={projection.fixtures} />
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)', fontSize: 12.5, color: 'var(--muted)' }}>
                      Roughly <strong>{projection.seconds < 90 ? `${projection.seconds}s` : `${Math.ceil(projection.seconds / 60)} min`}</strong> to build.
                      It runs in the background - you can leave this page.
                    </div>
                  </CardBody>
                </Card>

                {problems.length > 0 && (
                  <Card>
                    <CardBody>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Before you build</div>
                      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                        {problems.map((p) => <li key={p}>{p}</li>)}
                      </ul>
                    </CardBody>
                  </Card>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <Button onClick={submit} disabled={create.isPending || problems.length > 0} style={{ flex: 1 }}>
                    {create.isPending ? 'Starting…' : 'Build it'}
                  </Button>
                  <Button variant="ghost" onClick={() => { setOpen(false); setForm(structuredClone(BLANK)); }}>Cancel</Button>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {isLoading ? <Spinner /> : items.length === 0 ? (
        <EmptyState title="No builds yet" description="Build a championship to demo from. It runs in the background and takes a few minutes." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((b) => {
            const busy = BUSY.includes(b.status);
            return (
              <Card key={b.id}>
                <CardHeader
                  title={b.client_name}
                  subtitle={`${b.email_domain} · created ${fmtDateTime(b.created_at)}`}
                  action={(
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Badge tone={b.status === 'ready' ? 'green' : b.status === 'error' ? 'rose' : 'amber'}>
                        {busy && b.error ? b.error : b.status}
                      </Badge>
                      <Button variant="ghost" disabled={busy} onClick={() => reset(b)}>Rebuild</Button>
                      <Button variant="ghost" disabled={busy} onClick={() => remove(b)} aria-label="Delete"><Trash2 size={14} /></Button>
                    </div>
                  )}
                />
                <CardBody>
                  {b.status === 'error' && !busy && (
                    <div style={{ color: 'var(--danger-ink)', fontSize: 13, marginBottom: 10 }}>{b.error}</div>
                  )}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: b.result ? 14 : 0 }}>
                    <StatCard label="Organizations" value={b.counts.organizations} />
                    <StatCard label="People" value={b.counts.users} />
                    <StatCard label="Teams" value={b.counts.teams} />
                    <StatCard label="Fixtures" value={b.counts.fixtures} />
                  </div>

                  {b.status === 'ready' && (
                    <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--line)' }}>
                      {(['Key accounts', 'All logins'] as const).map((t) => {
                        const active = (tab[b.id] ?? 'Key accounts') === t;
                        return (
                          <button key={t} type="button" onClick={() => setTab((s) => ({ ...s, [b.id]: t }))}
                            style={{
                              appearance: 'none', background: 'none', cursor: 'pointer', fontSize: 13,
                              padding: '6px 12px', border: 'none', fontWeight: active ? 700 : 500,
                              color: active ? 'var(--ink)' : 'var(--muted)',
                              borderBottom: `2px solid ${active ? 'var(--brand)' : 'transparent'}`,
                              marginBottom: -1,
                            }}>
                            {t}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {b.status === 'ready' && (tab[b.id] ?? 'Key accounts') === 'All logins' && (
                    <LoginsPanel buildId={b.id} />
                  )}

                  {b.status === 'ready' && (tab[b.id] ?? 'Key accounts') === 'Key accounts' && (
                    <>
                      {b.result && (
                        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
                          {b.result.start_date} → {b.result.end_date}
                        </div>
                      )}
                      {/* Everyone who runs or administers something - organiser, the
                          institution owners, officials, POCs and captains. The same
                          endpoint as All logins, minus the plain players. */}
                      <LoginsPanel buildId={b.id} keyOnly />
                    </>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- every login a build made ----------------------------------------------

interface LoginRow {
  name: string; email: string; role: string;
  organization: string | null; short: string | null;
  member_code: string | null; team: string | null;
}

// Roles in the order someone demoing actually reaches for them, not alphabetical.
const ROLE_ORDER = ['Organiser', 'Institution admin', 'Org admin', 'Official', 'POC', 'Captain', 'Player'];

/** Rendered in chunks: a build is well over a thousand rows and the browser should
 *  not lay them all out to show the first twenty. */
const PAGE = 60;

function LoginsPanel({ buildId, keyOnly = false }: { buildId: string; keyOnly?: boolean }) {
  // Both tabs come from the same endpoint so they can never disagree about who
  // exists. `key=1` just trims the players out server-side rather than shipping a
  // thousand rows the summary will not show.
  const { data, isLoading } = useApi<{ password: string | null; total: number; rows: LoginRow[] }>(
    `/demos/${buildId}/logins${keyOnly ? '?key=1' : ''}`, true,
  );
  const [q, setQ] = useState('');
  const [role, setRole] = useState<string>('All');
  const [shown, setShown] = useState(PAGE);

  const rows = data?.rows ?? [];
  const roles = useMemo(() => {
    const present = new Set(rows.map((r) => r.role));
    return ['All', ...ROLE_ORDER.filter((r) => present.has(r))];
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      (role === 'All' || r.role === role)
      && (!needle
        || r.name.toLowerCase().includes(needle)
        || r.email.toLowerCase().includes(needle)
        || (r.organization ?? '').toLowerCase().includes(needle)
        || (r.team ?? '').toLowerCase().includes(needle)
        || (r.member_code ?? '').toLowerCase().includes(needle)),
    );
  }, [rows, q, role]);

  const exportCsv = () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const body = [
      ['Name', 'Email', 'Password', 'Role', 'Organization', 'Roll', 'Team'].join(','),
      ...filtered.map((r) => [
        r.name, r.email, data?.password ?? '', r.role,
        r.organization ?? '', r.member_code ?? '', r.team ?? '',
      ].map((v) => esc(String(v))).join(',')),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `logins-${buildId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <Spinner />;
  if (!rows.length) return <Muted>No accounts recorded for this build.</Muted>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Input value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
          placeholder="Search name, email, organization, team or roll number" style={{ flex: '1 1 260px' }} />
        <Select value={role} onChange={(e) => { setRole(e.target.value); setShown(PAGE); }} style={{ width: 160 }}>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
        <Button variant="ghost" onClick={exportCsv}>Export CSV</Button>
      </div>

      <Muted>
        {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} accounts
        {data?.password ? <> · password for every one: <code>{data.password}</code></> : null}
      </Muted>

      <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-1)' }}>
            <tr>
              {['Role', 'Name', 'Email', 'Organization', 'Roll / Team', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '7px 10px', color: 'var(--muted)', fontWeight: 600, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid var(--line)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, shown).map((r) => (
              <tr key={r.email} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                  <Badge tone={r.role === 'Player' ? 'slate' : r.role === 'Official' ? 'violet' : 'brand'}>{r.role}</Badge>
                </td>
                <td style={{ padding: '6px 10px' }}>{r.name}</td>
                <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace' }}>{r.email}</td>
                <td style={{ padding: '6px 10px', color: 'var(--muted)' }}>{r.short ?? r.organization ?? '—'}</td>
                <td style={{ padding: '6px 10px', color: 'var(--muted)' }}>{r.team ?? r.member_code ?? '—'}</td>
                <td style={{ padding: '6px 10px' }}>
                  <Button variant="ghost" onClick={() => copy(r.email, 'Email')} aria-label="Copy email"><Copy size={12} /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {shown < filtered.length && (
        <Button variant="ghost" onClick={() => setShown((n) => n + PAGE * 4)}>
          Show more ({(filtered.length - shown).toLocaleString()} left)
        </Button>
      )}
    </div>
  );
}

// ---- small layout helpers, local to this page ------------------------------

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>{children}</div>
);

const Muted = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>{children}</div>
);

function Line({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--muted)', display: 'flex' }}>{icon}</span>
      <span style={{ color: 'var(--muted)', flex: 1 }}>{label}</span>
      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
    </div>
  );
}
