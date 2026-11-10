import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import {
  Badge, Button, Card, Checkbox, confirmDialog, EmptyState, Select, Spinner, toast,
} from '../../components/ui';

// Super-admin console: tell every entered participant that the fixtures are live.
// Pick an event, review/edit who it goes to (grouped by org, demo/placeholder off),
// then send through the same mail service as OTP. Backed by
// GET/POST /platform/schedule-email/:championshipId/{audience,send}.

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
  no_email: 'no email on file',
  placeholder: 'placeholder email',
  demo: 'demo address',
};

export function ScheduleEmailPage() {
  const { data: championships = [], isLoading: loadingList } = useApi<Championship[]>('/championships');
  const [champId, setChampId] = useState('');
  const audiencePath = champId ? `/platform/schedule-email/${champId}/audience` : null;
  const { data: audience, isLoading: loadingAud } = useApi<Audience>(audiencePath);

  // Selected user ids. Seeded from the server's default (emailable people in real
  // orgs) whenever a fresh audience loads, then the operator edits it.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!audience) return;
    const next = new Set<string>();
    for (const o of audience.orgs) {
      if (!o.selectedByDefault) continue;
      for (const p of o.people) if (p.emailable) next.add(p.userId);
    }
    setSelected(next);
  }, [audience]);

  const emailableByOrg = useMemo(() => {
    const m = new Map<string, Person[]>();
    for (const o of audience?.orgs ?? []) m.set(o.orgId, o.people.filter((p) => p.emailable));
    return m;
  }, [audience]);

  const selectedCount = selected.size;
  const selectedOrgs = useMemo(() => {
    let n = 0;
    for (const o of audience?.orgs ?? []) {
      if ((emailableByOrg.get(o.orgId) ?? []).some((p) => selected.has(p.userId))) n++;
    }
    return n;
  }, [audience, emailableByOrg, selected]);

  const togglePerson = (userId: string) =>
    setSelected((s) => { const n = new Set(s); n.has(userId) ? n.delete(userId) : n.add(userId); return n; });

  const toggleOrg = (org: Org) => setSelected((s) => {
    const n = new Set(s);
    const people = emailableByOrg.get(org.orgId) ?? [];
    const allOn = people.length > 0 && people.every((p) => n.has(p.userId));
    for (const p of people) allOn ? n.delete(p.userId) : n.add(p.userId);
    return n;
  });

  const send = async () => {
    if (!audience || selectedCount === 0) return;
    const ok = await confirmDialog({
      title: 'Send the schedule email?',
      message: `This emails ${selectedCount} ${selectedCount === 1 ? 'person' : 'people'} across ${selectedOrgs} ${selectedOrgs === 1 ? 'org' : 'orgs'} for "${audience.eventName}". Each gets one email even if re-sent.`,
      confirmLabel: `Send to ${selectedCount}`,
    });
    if (!ok) return;
    setSending(true);
    try {
      const res = await api('POST', `/platform/schedule-email/${champId}/send`, { userIds: [...selected] });
      const skipped = res.skipped?.length ?? 0;
      toast.success(`Queued ${res.accepted} email${res.accepted === 1 ? '' : 's'}` +
        (res.rejected ? ` · ${res.rejected} rejected` : '') +
        (skipped ? ` · ${skipped} skipped` : ''));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-28">
      <div>
        <h1 className="text-xl font-semibold">Schedule email</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Tell every entered participant that the fixtures are live. Pick an event, edit who it reaches, then send.
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
            <div className="space-y-3">
              {audience.orgs.map((o) => {
                const people = emailableByOrg.get(o.orgId) ?? [];
                const on = people.filter((p) => selected.has(p.userId)).length;
                const allOn = people.length > 0 && on === people.length;
                return (
                  <Card key={o.orgId} className="p-4">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={allOn}
                        indeterminate={on > 0 && !allOn}
                        onChange={() => toggleOrg(o)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{o.orgName}</div>
                        <div className="text-xs text-slate-500">
                          {on}/{o.emailableCount} selected
                          {o.people.length > o.emailableCount && ` · ${o.people.length - o.emailableCount} not emailable`}
                        </div>
                      </div>
                      {!o.selectedByDefault && <Badge tone="slate">demo / no email</Badge>}
                    </div>
                    <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 dark:border-slate-800">
                      {o.people.map((p) => (
                        <div key={p.userId} className="flex items-center gap-3 text-sm">
                          <Checkbox
                            checked={selected.has(p.userId)}
                            onChange={() => p.emailable && togglePerson(p.userId)}
                          />
                          <div className="min-w-0 flex-1">
                            <span className={p.emailable ? '' : 'text-slate-400 line-through'}>{p.name}</span>
                            {p.roles.length > 0 && (
                              <span className="ml-2 text-xs text-slate-400">{p.roles.join(', ')}</span>
                            )}
                          </div>
                          <div className="shrink-0 text-xs text-slate-400">
                            {p.emailable ? p.email : (p.reason ? REASON_LABEL[p.reason] : 'not emailable')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          )
      )}

      {champId && audience && audience.orgs.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
            <div className="text-sm">
              <span className="font-semibold">{selectedCount}</span> {selectedCount === 1 ? 'person' : 'people'}
              <span className="text-slate-400"> · {selectedOrgs} {selectedOrgs === 1 ? 'org' : 'orgs'}</span>
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
