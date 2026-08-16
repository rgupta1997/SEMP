import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { usePermissions } from '../../lib/permissions';
import { useApi } from '../../lib/hooks';
import { OrgTabs } from '../../components/OrgTabs';
import { EmptyState, PageHeader, Pagination, SearchInput, Select, Spinner } from '../../components/ui';

// The organisation's audit trail (J6-E3-S3): who did what, when, in reverse order.
//
// Entries are append-only and denormalised at write time, so a line still names the
// person and the thing even after either has been deleted - which is why this page
// renders `actor_label` and `target_label` rather than joining to live rows.

interface AuditRow {
  id: string;
  at: string;
  actor_user_id: string | null;
  actor_label: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  target_label: string | null;
  summary: string | null;
  diff: Record<string, { from: unknown; to: unknown }> | null;
}

// Action families, for the filter. The value is a prefix - the API matches on it.
const FAMILIES: Array<{ value: string; label: string }> = [
  { value: '', label: 'All activity' },
  { value: 'org.member', label: 'Members' },
  { value: 'org.', label: 'Organisation' },
  { value: 'org_domain.', label: 'Email domains' },
  { value: 'auth.', label: 'Sign-in' },
  { value: 'registration.', label: 'Registrations' },
  { value: 'championship.', label: 'Championships' },
];

// The trail only ever grows, so it is read a page at a time rather than in one
// capped fetch - a ceiling would quietly hide the oldest entries, which is the
// opposite of what an audit trail is for.
const PAGE_SIZE = 25;

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000_000], ['month', 2_592_000_000], ['day', 86_400_000],
  ['hour', 3_600_000], ['minute', 60_000],
];

function ago(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  for (const [unit, ms] of UNITS) {
    if (delta >= ms) return RELATIVE.format(-Math.floor(delta / ms), unit);
  }
  return 'just now';
}

// "org.member.role_changed" -> "member role changed"
function actionLabel(action: string): string {
  return action.split('.').slice(1).join(' ').replace(/_/g, ' ');
}

function DiffList({ diff }: { diff: AuditRow['diff'] }) {
  const entries = Object.entries(diff ?? {}).filter(([key]) => key !== '*');
  if (entries.length === 0) return null;
  const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
      {entries.slice(0, 6).map(([field, change]) => (
        <span key={field} className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
          {field}: <span className="line-through opacity-70">{show(change.from)}</span>
          {' → '}
          <span className="text-slate-700 dark:text-slate-200">{show(change.to)}</span>
        </span>
      ))}
    </div>
  );
}

export function OrgActivityPage() {
  const { ctx } = useAuth();
  const { orgId: routeOrgId } = useParams();
  const orgId = routeOrgId ?? ctx?.organization?.id ?? ctx?.user.organization_id ?? '';
  const canManage = usePermissions().canManageOrg(orgId);

  const [family, setFamily] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState(''); // debounced `query`, the value actually sent
  const [page, setPage] = useState(0);

  // Debounce typing so each keystroke doesn't hit the DB. Narrowing the trail also
  // returns you to its start - page 4 of the old result set means nothing here.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(query.trim()); setPage(0); }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // Filtering and paging both happen on the server: free text is matched against the
  // whole trail, not just the page in hand.
  const path = canManage && orgId
    ? `/organizations/${orgId}/audit?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`
      + (family ? `&action=${encodeURIComponent(family)}` : '')
      + (search ? `&q=${encodeURIComponent(search)}` : '')
    : null;
  const { data, isLoading, isFetching } = useApi<{ rows: AuditRow[]; total: number }>(path, true, { keepPrevious: true });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {orgId && <OrgTabs orgId={orgId} />}
      <PageHeader
        title="Activity"
        subtitle="Every privileged action taken in this organisation. Entries can never be edited or removed."
      />

      {!canManage ? (
        <EmptyState icon="🔏" title="Only owners & admins can read the audit trail"
          description="Ask an owner or admin of this organisation if you need to know what changed." />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <SearchInput value={query} onChange={setQuery} placeholder="Search this timeline…" className="w-64" />
            <Select
              value={family}
              onChange={(e) => { setFamily(e.target.value); setPage(0); }}
              className="w-48"
            >
              {FAMILIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {total} entr{total === 1 ? 'y' : 'ies'}
            </span>
          </div>

          {isLoading ? (
            <Spinner />
          ) : rows.length === 0 ? (
            search || family ? (
              <EmptyState icon="🔍" title="No matching activity"
                description="Nothing in this trail matches that search and filter. Try widening either." />
            ) : (
              <EmptyState icon="🕰" title="Nothing recorded yet"
                description="Approvals, role changes, domain edits and verification all land here as they happen." />
            )
          ) : (
            <ol className={`overflow-hidden rounded-xl bg-white shadow ring-1 ring-slate-200 transition-opacity dark:bg-slate-900 dark:ring-slate-800${isFetching ? ' opacity-60' : ''}`}>
              {rows.map((r) => (
                <li key={r.id} className="flex gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 dark:border-slate-800">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                    {(r.actor_label ?? 'System').slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800 dark:text-slate-200">
                      {r.summary ?? `${actionLabel(r.action)} · ${r.target_label ?? r.target_type}`}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {/* A null actor is the product acting on its own behalf. */}
                      {r.actor_label ?? 'System'} · <span className="font-mono">{r.action}</span> · <time dateTime={r.at} title={new Date(r.at).toLocaleString()}>{ago(r.at)}</time>
                    </p>
                    <DiffList diff={r.diff} />
                  </div>
                </li>
              ))}
            </ol>
          )}

          <Pagination page={page} pageCount={pageCount} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
        </>
      )}
    </div>
  );
}
