import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Award, Check, ChevronRight, Copy, Lock, ShieldOff } from 'lucide-react';
import { ARCHIVED_READ_ONLY_MESSAGE } from '@semp/shared';
import { api } from '../../lib/api';
import { useApi, useApiMutation } from '../../lib/hooks';
import { useWorkspace } from '../../lib/useWorkspace';
import { usePermissions } from '../../lib/permissions';
import { GenerateModal } from '../organization/certificates/GenerateModal';
import type { Template } from '../organization/certificates/shared';
import { EmptyState, PILL_PICK, SearchInput, cn, toast } from '../../components/ui';
import { PickList } from '../../components/PickList';
import { useUrlState } from '../../components/primitives';
import { HEAD_ROW } from '../../components/GroupTables';
import { SportsDecor } from '../../features/schedule/ScheduleParts';
import { useEvent } from './EventLayout';

// Certificates for one event.
//
// Certificates are ISSUED BY an organisation, not by an event - the signature on
// one is an institution's, and a stranger checking it is checking that institution.
// So this page is the event's view onto its host organisation's register, filtered
// to this event, rather than a second issuing system.
//
// When an event has no host organisation - an individual running a local fixture -
// the page says so plainly instead of offering a button that cannot work.

interface Cert {
  id: string; serial: string; recipient_name: string;
  issued_at: string; revoked_at: string | null; superseded_at: string | null;
  /** What it was awarded for ("Gold", "Organising Committee Member") and, for results, the sport. */
  title?: string | null; sport?: string | null;
}
type State = 'valid' | 'superseded' | 'withdrawn';
const stateOf = (c: Cert): State => (c.revoked_at ? 'withdrawn' : c.superseded_at ? 'superseded' : 'valid');
/** How each state reads: a label, the pill on a row, the dot in the hero. */
const STATE_LOOK: Record<State, { label: string; pill: string; dot: string }> = {
  valid: { label: 'Valid', pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', dot: 'bg-emerald-300' },
  superseded: { label: 'Superseded', pill: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300', dot: 'bg-amber-300' },
  withdrawn: { label: 'Withdrawn', pill: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300', dot: 'bg-rose-300' },
};
// Recipient · Serial · Issued · State · open
const GRID = 'minmax(0,1.4fr) minmax(0,1fr) 7.5rem 7rem 1.5rem';
const fmtIssued = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

/** The page's blue header; the body below changes with what this person can see. */
function CertHero({ count, sub, children, action }: { count: ReactNode; sub: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-4 text-white shadow-sm sm:p-5">
      <SportsDecor />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">Certificates</div>
          <div className="mt-1 flex items-baseline gap-2">{count}</div>
          <p className="mt-0.5 text-sm text-white/75">{sub}</p>
          {children}
        </div>
        {action}
      </div>
    </section>
  );
}

/** The serial, in mono, with a one-tap copy for pasting into a verification check. */
function Serial({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { toast.error('Could not copy'); }
  };
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded-lg bg-slate-50 py-0.5 pl-2 pr-0.5 dark:bg-slate-800/60">
      <span className="truncate font-mono text-[12px] text-slate-600 dark:text-slate-300">{value}</span>
      <button type="button" onClick={copy} aria-label={`Copy ${value}`} title={copied ? 'Copied' : 'Copy serial'}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-white hover:text-brand-600 dark:hover:bg-slate-700">
        {copied ? <Check size={12} className="text-emerald-600" aria-hidden /> : <Copy size={12} aria-hidden />}
      </button>
    </span>
  );
}

export function EventCertificatesPage() {
  const { championship, eventId, canManage } = useEvent();
  // A sport organiser issues for the sports they run; the server enforces the same.
  const scope = usePermissions().organiserScope(eventId);
  const sportScope = Array.isArray(scope) ? scope : undefined;
  const canIssue = canManage || !!sportScope?.length;
  const host = (championship as any).host_organization as { id: string; name: string } | null;
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState('');
  const [stateRaw, setStateFilter] = useUrlState<string>('state', '');
  const stateFilter = (['valid', 'superseded', 'withdrawn'] as const).includes(stateRaw as never) ? stateRaw as State : '';
  // Refused by the server too; disabled here so nobody walks the wizard first.
  const archived = !!championship.archived_at;
  const generateButton = (onBlue: boolean) => (
    <button type="button" disabled={archived} title={archived ? ARCHIVED_READ_ONLY_MESSAGE : undefined} onClick={() => setGenerating(true)}
      className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-bold shadow-sm transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60',
        onBlue ? 'bg-white text-brand-700 shadow-lg hover:bg-brand-50 focus-visible:ring-white/70' : 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-400 dark:bg-brand-500')}>
      <Award size={15} aria-hidden />Generate certificates
    </button>
  );

  // Same standing the server itself requires to name a host (assertMayHost -
  // owner or org_admin) - offering an org here that would just come back a 403
  // is worse than sending the person to Settings empty-handed.
  const ws = useWorkspace();
  // An archived organisation can't host - the server refuses it too.
  const hostable = ws.contexts.filter(
    (c) => c.kind === 'org' && !c.archived && c.roleCodes.some((r) => r === 'owner' || r === 'org_admin'),
  );
  const [hostPick, setHostPick] = useState('');
  const setHost = useApiMutation(
    (organizationId: string) => api('PATCH', `/championships/${eventId}`, { host_organization_id: organizationId }),
    [`/championships/${eventId}`],
  );

  // The API pages at 25 by default; ask for its maximum so a big event is not cut short.
  const listPath = host ? `/organizations/${host.id}/certificates?championship_id=${eventId}&page_size=200` : null;
  const { data, isLoading, error } = useApi<{ rows: Cert[]; access?: 'issuer' | 'event' | 'sports' } | Cert[]>(listPath);
  // Fetched only once the generate dialog is open. Asking earlier is a request that
  // can only fail for anybody who is not an issuer here, which is most organisers.
  const templates = useApi<{ rows: Template[] }>(
    host && generating ? `/organizations/${host.id}/certificate-templates?championship_id=${eventId}` : null,
  );

  const rows: Cert[] = Array.isArray(data) ? data : data?.rows ?? [];
  // The certificate's own page is in the institution's workspace, for its issuers.
  const issuer = !Array.isArray(data) && data?.access === 'issuer';
  // Organising an event and administering the institution behind it are different
  // jobs, and often different people. The register belongs to the institution, so
  // an organiser without standing there is told whose permission they need rather
  // than shown an empty table that looks like "nothing issued".
  const notIssuer = (error as any)?.status === 403;

  if (!host) {
    // canManage says nothing about standing at any particular organisation, so
    // this only offers a choice when there's a real one to make: `hostable` is
    // exactly the set assertMayHost would accept, and picking from it here beats
    // sending somebody to Settings with no idea which field to look for.
    const canPickHost = canManage && hostable.length > 0;
    return (
      <div className="space-y-5 pb-16">
        <CertHero count={<span className="text-xl font-black">No issuing organisation yet</span>} sub="Certificates carry an institution's signature." />
        <EmptyState
          icon={<ShieldOff size={24} />}
          title="This event has no issuing organisation"
          description={canPickHost
            ? "A certificate carries an institution's signature, so one has to be behind it. Choose which of your organisations is hosting this event, and its certificates can be generated here."
            : "A certificate carries an institution's signature, so one has to be behind it. Set a host organisation for this event in Settings, and its certificates can be generated here."}
          action={canPickHost ? (
            <div className="flex w-full max-w-md flex-wrap items-center justify-center gap-2">
              <PickList value={hostPick} onChange={setHostPick} ariaLabel="Host organisation" placeholder="Choose an organisation"
                options={hostable.map((o) => ({ value: o.id, label: o.name }))} className={cn(PILL_PICK, 'w-full sm:w-64')} />
              <button type="button" className="bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                disabled={!hostPick || setHost.isPending}
                onClick={() => setHost.mutate(hostPick, {
                  onSuccess: () => toast.success('Host organisation set', `Certificates for this event are now signed by ${hostable.find((o) => o.id === hostPick)?.name ?? 'this organisation'}.`),
                  onError: (e: any) => toast.error(e.message),
                })}>
                {setHost.isPending ? 'Setting…' : 'Set as host'}
              </button>
            </div>
          ) : undefined}
        />
      </div>
    );
  }

  if (notIssuer) {
    return (
      <div className="space-y-5 pb-16">
        <CertHero count={<span className="text-xl font-black">Issued by {host.name}</span>} sub="Read and issued inside that organisation." />
        <EmptyState
          icon={<Lock size={24} />}
          title="You cannot see this institution's register"
          description={`Certificates for this event carry ${host.name}'s signature, so they are issued and read inside that organisation. Ask an owner or administrator there for permission to issue certificates.`}
        />
      </div>
    );
  }

  const counts: Record<State, number> = { valid: 0, superseded: 0, withdrawn: 0 };
  rows.forEach((c) => { counts[stateOf(c)] += 1; });
  const q = search.trim().toLowerCase();
  const shown = rows.filter((c) => (!stateFilter || stateOf(c) === stateFilter)
    && (!q || `${c.recipient_name} ${c.serial} ${c.title ?? ''} ${c.sport ?? ''}`.toLowerCase().includes(q)));

  return (
    <div className="space-y-5 pb-16">
      <CertHero
        count={<>
          <span className="text-3xl font-black tabular-nums">{isLoading ? '…' : rows.length}</span>
          <span className="text-sm font-semibold text-white/80">{rows.length === 1 ? 'certificate' : 'certificates'} issued</span>
        </>}
        sub={sportScope ? `Signed by ${host.name}, for the sports you organise` : `Signed by ${host.name}`}
        action={canIssue ? generateButton(true) : undefined}>
        {rows.length > 0 && (
          // The tally doubles as a filter.
          <div className="mt-3 flex flex-wrap gap-2">
            {(Object.keys(STATE_LOOK) as State[]).map((s) => {
              const on = stateFilter === s;
              return (
                <button key={s} type="button" aria-pressed={on} onClick={() => setStateFilter(on ? '' : s)}
                  className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-semibold ring-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white',
                    on ? 'bg-white text-brand-700 shadow-lg ring-white' : 'bg-white/10 text-white ring-white/15 hover:bg-white/15')}>
                  <span className={cn('h-2 w-2 rounded-full', STATE_LOOK[s].dot)} aria-hidden />{STATE_LOOK[s].label}
                  <span className={cn('rounded-full px-1.5 text-[11px] font-black tabular-nums', on ? 'bg-brand-50' : 'bg-white/15')}>{counts[s]}</span>
                </button>
              );
            })}
          </div>
        )}
      </CertHero>

      {isLoading ? (
        <div className="space-y-2" aria-label="Loading">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-14 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Award size={24} />}
          title="Nothing issued for this event yet"
          description="Issue them to winners, special award winners, participants, the organising team, officials and coaches. Winners' certificates come from locked results, so lock a scorecard first; the rest can be issued any time."
          action={canIssue ? generateButton(false) : undefined}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput pill value={search} onChange={setSearch} placeholder="Search by name, award or serial…" className="w-full sm:w-80" />
            <span className="text-xs font-semibold text-slate-400 sm:ml-auto">{shown.length} of {rows.length} shown</span>
          </div>
          {shown.length === 0 ? (
            <EmptyState icon={<Award size={24} />} title="Nothing matches" description="Try another name, award or serial, or clear the state filter." />
          ) : (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className={cn('hidden items-center gap-x-4 px-4 py-2 md:grid', HEAD_ROW)} style={{ gridTemplateColumns: GRID }}>
                <span>Recipient</span><span>Serial</span><span>Issued</span><span>State</span><span />
              </div>
              <ul>
                {shown.map((c) => {
                  const st = stateOf(c);
                  const name = (
                    <span className="flex min-w-0 items-center gap-3">
                      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl',
                        st === 'valid' ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-slate-100 text-slate-400 dark:bg-slate-800')} aria-hidden>
                        <Award size={17} />
                      </span>
                      <span className="min-w-0">
                        {issuer
                          ? <Link to={`/organizations/${host.id}/certificates/${c.id}`} className="block truncate font-semibold text-slate-900 hover:text-brand-600 dark:text-slate-100 dark:hover:text-brand-300">{c.recipient_name}</Link>
                          : <span className="block truncate font-semibold text-slate-900 dark:text-slate-100">{c.recipient_name}</span>}
                        {/* What it was awarded for, straight from the certificate itself. */}
                        {(c.title || c.sport) && (
                          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                            {c.title && <span className="truncate" title={c.title}>{c.title}</span>}
                            {c.sport && <span className="shrink-0 rounded-full bg-brand-50 px-1.5 py-px text-[10px] font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">{c.sport}</span>}
                          </span>
                        )}
                      </span>
                    </span>
                  );
                  const pill = <span className={cn('inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-bold', STATE_LOOK[st].pill)}>{STATE_LOOK[st].label}</span>;
                  const open = issuer
                    ? <Link to={`/organizations/${host.id}/certificates/${c.id}`} aria-label={`Open ${c.recipient_name}'s certificate`} className="text-slate-300 hover:text-brand-500 dark:text-slate-600"><ChevronRight size={16} /></Link>
                    : <span />;
                  return (
                    <li key={c.id} className="border-t border-slate-100 transition-colors first:border-t-0 hover:bg-slate-50/60 md:first:border-t dark:border-slate-800 dark:hover:bg-slate-800/30">
                      {/* Desktop: aligned columns. */}
                      <div className="hidden items-center gap-x-4 px-4 py-2.5 md:grid" style={{ gridTemplateColumns: GRID }}>
                        {name}<span className="min-w-0"><Serial value={c.serial} /></span>
                        <span className="text-sm text-slate-500 dark:text-slate-400">{fmtIssued(c.issued_at)}</span>
                        {pill}{open}
                      </div>
                      {/* Phone: name and state, then serial and date. */}
                      <div className="space-y-2 px-4 py-3 md:hidden">
                        <div className="flex items-center justify-between gap-2">{name}{pill}</div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-12">
                          <Serial value={c.serial} /><span className="text-xs text-slate-500 dark:text-slate-400">{fmtIssued(c.issued_at)}</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      {generating && (
        <GenerateModal
          orgId={host.id}
          championship={{ id: eventId, name: championship.name }}
          templates={templates.data?.rows ?? []}
          templatesLoading={!templates.data}
          onClose={() => setGenerating(false)}
          invalidate={[listPath]}
          sportScope={sportScope}
        />
      )}
    </div>
  );
}
