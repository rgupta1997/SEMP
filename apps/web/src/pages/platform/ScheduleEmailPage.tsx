import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Mail, Users, Building2, Layers, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import {
  Badge, Button, Card, Checkbox, confirmDialog, EmptyState, SearchInput, Select, Spinner, Toggle, toast,
} from '../../components/ui';

// Super-admin console: tell every entered participant that the fixtures are live.
// Pick an event, review/edit who it reaches (grouped by org, searchable/filterable,
// demo/placeholder off), then send through the same mail service as OTP. A person on
// more than one entered team shows under each org but is counted - and emailed - once.
// Backed by GET/POST /platform/schedule-email/:championshipId/{audience,send}.

interface Championship { id: string; name: string; start_date?: string; status?: string }

type Reason = 'no_email' | 'placeholder' | 'demo';
interface Person {
  userId: string; name: string; email: string | null;
  roles: string[]; emailable: boolean; reason?: Reason;
}
interface Org {
  orgId: string; orgName: string; selectedByDefault: boolean;
  emailableCount: number; people: Person[];
}
interface Audience {
  championshipId: string; eventName: string; orgs: Org[];
  totals: { people: number; emailable: number; orgs: number };
}

const REASON_LABEL: Record<Reason, string> = {
  no_email: 'no email', placeholder: 'placeholder', demo: 'demo address',
};
const titleRole = (r: string) => r.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function Stat({ icon, value, label }: { icon: ReactNode; value: number | string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-400">{icon}</span>
      <span className="text-sm"><span className="font-semibold">{value}</span>{' '}
        <span className="text-slate-500 dark:text-slate-400">{label}</span></span>
    </div>
  );
}

export function ScheduleEmailPage() {
  const { data: championships = [], isLoading: loadingList } = useApi<Championship[]>('/championships');
  const [champId, setChampId] = useState('');
  const audiencePath = champId ? `/platform/schedule-email/${champId}/audience` : null;
  const { data: audience, isLoading: loadingAud } = useApi<Audience>(audiencePath);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [emailableOnly, setEmailableOnly] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Seed selection from the server default (emailable people in real orgs) on each
  // fresh audience; reset the view controls so a new event starts clean.
  useEffect(() => {
    if (!audience) return;
    const next = new Set<string>();
    for (const o of audience.orgs) if (o.selectedByDefault) for (const p of o.people) if (p.emailable) next.add(p.userId);
    setSelected(next);
    setSearch(''); setRoleFilter(''); setCollapsed(new Set());
  }, [audience]);

  // Unique-person views: a person on teams in several orgs appears once per org in the
  // data but is one recipient. These keep every count and the send honest.
  const { personOrgCount, uniqueEmailable, roleOptions } = useMemo(() => {
    const orgCount = new Map<string, number>();
    const emailable = new Set<string>();
    const roles = new Set<string>();
    for (const o of audience?.orgs ?? []) for (const p of o.people) {
      orgCount.set(p.userId, (orgCount.get(p.userId) ?? 0) + 1);
      if (p.emailable) emailable.add(p.userId);
      for (const r of p.roles) roles.add(r);
    }
    return { personOrgCount: orgCount, uniqueEmailable: emailable, roleOptions: [...roles].sort() };
  }, [audience]);

  // Orgs with their filtered people. Role + emailable filters always apply; the text
  // search matches a person by name/email, OR keeps the whole org when the org name
  // matches. Empty orgs drop out of the view.
  const view = useMemo(() => {
    const q = search.trim().toLowerCase();
    const passesFilters = (p: Person) =>
      (!emailableOnly || p.emailable) && (!roleFilter || p.roles.includes(roleFilter));
    const textHit = (p: Person) =>
      !q || p.name.toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q);
    return (audience?.orgs ?? []).map((o) => {
      const orgHit = !!q && o.orgName.toLowerCase().includes(q);
      const shown = o.people.filter((p) => passesFilters(p) && (orgHit || textHit(p)));
      const emailableShown = shown.filter((p) => p.emailable);
      const selectedShown = emailableShown.filter((p) => selected.has(p.userId)).length;
      return { ...o, shown, emailableShown, selectedShown };
    }).filter((o) => o.shown.length > 0);
  }, [audience, search, roleFilter, emailableOnly, selected]);

  const selectedCount = selected.size;
  const selectedOrgs = useMemo(() => {
    let n = 0;
    for (const o of audience?.orgs ?? []) if (o.people.some((p) => p.emailable && selected.has(p.userId))) n++;
    return n;
  }, [audience, selected]);
  const multiOrgSelected = useMemo(
    () => [...selected].filter((id) => (personOrgCount.get(id) ?? 0) > 1).length,
    [selected, personOrgCount],
  );

  const togglePerson = (p: Person) => {
    if (!p.emailable) return;
    setSelected((s) => { const n = new Set(s); n.has(p.userId) ? n.delete(p.userId) : n.add(p.userId); return n; });
  };
  const setMany = (ids: string[], on: boolean) =>
    setSelected((s) => { const n = new Set(s); for (const id of ids) on ? n.add(id) : n.delete(id); return n; });

  const toggleOrg = (people: Person[]) => {
    const ids = people.filter((p) => p.emailable).map((p) => p.userId);
    const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
    setMany(ids, !allOn);
  };
  const selectAllShown = () => setMany(view.flatMap((o) => o.emailableShown.map((p) => p.userId)), true);
  const toggleCollapse = (orgId: string) =>
    setCollapsed((s) => { const n = new Set(s); n.has(orgId) ? n.delete(orgId) : n.add(orgId); return n; });

  const send = async () => {
    if (!audience || selectedCount === 0) return;
    const ok = await confirmDialog({
      title: 'Send the schedule email?',
      message: `This emails ${selectedCount} ${selectedCount === 1 ? 'person' : 'people'} across ${selectedOrgs} ${selectedOrgs === 1 ? 'org' : 'orgs'} for "${audience.eventName}".`
        + (multiOrgSelected ? ` ${multiOrgSelected} of them are in more than one org and each gets a single email.` : '')
        + ' Re-sending never double-mails anyone.',
      confirmLabel: `Send to ${selectedCount}`,
    });
    if (!ok) return;
    setSending(true);
    try {
      const res = await api('POST', `/platform/schedule-email/${champId}/send`, { userIds: [...selected] });
      const skipped = res.skipped?.length ?? 0;
      toast.success(`Queued ${res.accepted} email${res.accepted === 1 ? '' : 's'}`
        + (res.rejected ? ` · ${res.rejected} rejected` : '')
        + (skipped ? ` · ${skipped} skipped` : ''));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed');
    } finally { setSending(false); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-28">
      <div>
        <h1 className="text-xl font-semibold">Schedule email</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Tell every entered participant the fixtures are live. Pick an event, edit who it reaches, then send — one email per person.
        </p>
      </div>

      <Card className="p-4">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Championship</label>
        {loadingList ? <Spinner /> : (
          <Select className="w-full" value={champId} onChange={(e) => setChampId(e.target.value)}>
            <option value="">Select a championship…</option>
            {championships.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        )}
      </Card>

      {champId && loadingAud && <div className="grid h-40 place-items-center"><Spinner /></div>}

      {champId && !loadingAud && audience && (
        audience.orgs.length === 0
          ? <EmptyState title="No one entered yet" description="This championship has no approved orgs with entered participants." />
          : (
            <>
              {/* Summary */}
              <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
                <Stat icon={<Mail size={16} />} value={`${selectedCount}/${uniqueEmailable.size}`} label="recipients selected" />
                <Stat icon={<Building2 size={16} />} value={`${selectedOrgs}/${audience.totals.orgs}`} label="orgs" />
                <Stat icon={<Users size={16} />} value={audience.totals.people} label="entered" />
                {multiOrgSelected > 0 && (
                  <Stat icon={<Layers size={16} />} value={multiOrgSelected} label="in multiple orgs (emailed once)" />
                )}
              </Card>

              {/* Toolbar */}
              <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
                <SearchInput value={search} onChange={setSearch} placeholder="Search name, email or org…" className="w-56" />
                <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                  <option value="">All roles</option>
                  {roleOptions.map((r) => <option key={r} value={r}>{titleRole(r)}</option>)}
                </Select>
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <Toggle checked={emailableOnly} onChange={setEmailableOnly} /> Emailable only
                </label>
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="ghost" onClick={selectAllShown}>Select shown</Button>
                  <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
                </div>
              </div>

              {view.length === 0
                ? <EmptyState title="No matches" description="No participants match the current search and filters." />
                : (
                  <div className="space-y-3">
                    {view.map((o) => {
                      const isOpen = !collapsed.has(o.orgId) || !!search;
                      const ids = o.emailableShown.map((p) => p.userId);
                      const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
                      return (
                        <Card key={o.orgId} className="overflow-hidden">
                          <div className="flex items-center gap-3 p-4">
                            <Checkbox checked={allOn} indeterminate={o.selectedShown > 0 && !allOn}
                              onChange={() => toggleOrg(o.shown)} />
                            <button type="button" onClick={() => toggleCollapse(o.orgId)}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left">
                              <ChevronDown size={16}
                                className={`shrink-0 text-slate-400 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                              <span className="min-w-0">
                                <span className="block truncate font-medium">{o.orgName}</span>
                                <span className="text-xs text-slate-500">
                                  {o.selectedShown}/{o.emailableShown.length} selected
                                  {o.shown.length > o.emailableShown.length && ` · ${o.shown.length - o.emailableShown.length} not emailable`}
                                </span>
                              </span>
                            </button>
                            {!o.selectedByDefault && <Badge tone="slate">demo / no email</Badge>}
                          </div>
                          {isOpen && (
                            <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                              {o.shown.map((p) => {
                                const inN = personOrgCount.get(p.userId) ?? 1;
                                return (
                                  <label key={p.userId}
                                    className={`flex items-center gap-3 px-4 py-2 text-sm ${p.emailable ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50' : ''}`}>
                                    <Checkbox checked={selected.has(p.userId)} onChange={() => togglePerson(p)} />
                                    <span className="min-w-0 flex-1">
                                      <span className={p.emailable ? 'font-medium' : 'text-slate-400 line-through'}>{p.name}</span>
                                      {p.roles.map((r) => (
                                        <span key={r} className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">{titleRole(r)}</span>
                                      ))}
                                      {inN > 1 && (
                                        <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                                          <Layers size={10} /> in {inN} orgs · 1 email
                                        </span>
                                      )}
                                    </span>
                                    <span className="shrink-0 text-xs text-slate-400">
                                      {p.emailable ? p.email
                                        : <span className="inline-flex items-center gap-1 text-slate-400"><AlertTriangle size={11} /> {p.reason ? REASON_LABEL[p.reason] : 'not emailable'}</span>}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                )}
            </>
          )
      )}

      {champId && audience && audience.orgs.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
            <div className="text-sm">
              <span className="font-semibold">{selectedCount}</span> {selectedCount === 1 ? 'recipient' : 'recipients'}
              <span className="text-slate-400"> · {selectedOrgs} {selectedOrgs === 1 ? 'org' : 'orgs'}</span>
              {multiOrgSelected > 0 && <span className="text-slate-400"> · {multiOrgSelected} multi-org</span>}
            </div>
            <Button onClick={send} disabled={selectedCount === 0 || sending}>
              {sending ? 'Sending…' : 'Send schedule email'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
