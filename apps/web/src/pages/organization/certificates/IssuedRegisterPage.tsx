import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download, FileText, Sparkles } from 'lucide-react';
import { useApi } from '../../../lib/hooks';
import {
  BackButton, Button, Card, EmptyState, PageHeader, Pagination, SearchInput, Select, Skeleton,
  Table, TD, TH, THead, TR,
} from '../../../components/ui';
import { GenerateModal } from './GenerateModal';
import { CertStatus, openDoc, shortDate, type Cert, type Template } from './shared';

// The Issued Register: the answer to "did we issue this, and is it still good?".

interface Champ { id: string; name: string }
interface RegisterResponse {
  rows: Cert[];
  page: { page: number; page_size: number; matching: number; pages: number };
  summary: { total: number; live: number; revoked: number; verification_scans: number };
}

const PAGE_SIZE = 25;

export function IssuedRegisterPage() {
  const { orgId } = useParams();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [sport, setSport] = useState('');
  const [champ, setChamp] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [gen, setGen] = useState(false);

  // One query string for the table and the export, so the CSV is exactly what is on
  // screen. An Export button that quietly ignores the filters is a trap.
  const filters = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (sport) p.set('sport', sport);
    if (champ) p.set('championship_id', champ);
    if (status) p.set('status', status);
    return p;
  }, [q, sport, champ, status]);

  const listParams = new URLSearchParams(filters);
  listParams.set('page', String(page + 1));
  listParams.set('page_size', String(PAGE_SIZE));

  const registerPath = orgId ? `/organizations/${orgId}/certificates?${listParams}` : null;
  const register = useApi<RegisterResponse>(registerPath);
  const templates = useApi<{ rows: Template[] }>(orgId ? `/organizations/${orgId}/certificate-templates` : null);
  const champs = useApi<Champ[]>('/championships/mine');

  // The sport list comes from what has actually been issued, not the global catalogue -
  // a filter offering forty sports that return nothing is not a filter.
  const sports = useMemo(
    () => [...new Set((register.data?.rows ?? []).map((r) => r.sport).filter(Boolean) as string[])].sort(),
    [register.data],
  );

  const reset = (fn: () => void) => { fn(); setPage(0); };
  const p = register.data?.page;

  return (
    <div className="grid gap-5">
      <BackButton to={`/organizations/${orgId}/certificates`}>Back to Certificates</BackButton>
      <PageHeader title="Issued register" subtitle="Every certificate this institution has ever issued, including the withdrawn ones.">
        <Button variant="ghost" onClick={() => openDoc(
          `/organizations/${orgId}/certificates/export?${filters}`,
          { download: `certificates-${new Date().toISOString().slice(0, 10)}.csv` },
        )}>
          <Download size={15} aria-hidden />Export
        </Button>
        <Button onClick={() => setGen(true)}><Sparkles size={15} aria-hidden />Generate certificates</Button>
      </PageHeader>

      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <SearchInput value={q} onChange={(v) => reset(() => setQ(v))} placeholder="Search name or serial…" className="w-60" />
          <Select value={sport} onChange={(e) => reset(() => setSport(e.target.value))} aria-label="Filter by sport" className="w-40">
            <option value="">All sports</option>
            {sports.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select value={champ} onChange={(e) => reset(() => setChamp(e.target.value))} aria-label="Filter by event" className="w-52">
            <option value="">All events</option>
            {(champs.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={status} onChange={(e) => reset(() => setStatus(e.target.value))} aria-label="Filter by status" className="w-40">
            <option value="">All statuses</option>
            <option value="live">Live</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="superseded">Superseded</option>
          </Select>
        </div>

        {register.isLoading ? <Skeleton className="h-64" /> : (register.data?.rows.length ?? 0) === 0 ? (
          <EmptyState
            icon={<FileText size={28} />}
            title={filters.toString() ? 'Nothing matches those filters' : 'Nothing issued yet'}
            description={filters.toString()
              ? 'Clear a filter to widen the search.'
              : 'Certificates are generated from locked results — never typed in by hand.'}
            action={filters.toString()
              ? <Button variant="ghost" onClick={() => reset(() => { setQ(''); setSport(''); setChamp(''); setStatus(''); })}>Clear filters</Button>
              : <Button onClick={() => setGen(true)}><Sparkles size={15} aria-hidden />Generate certificates</Button>}
          />
        ) : (
          <div className="px-4 pb-4">
            <Table>
              <THead>
                <TR>
                  <TH>Certificate ID</TH><TH>Recipient</TH><TH>Event</TH><TH>Sport</TH>
                  <TH>Issue date</TH><TH>Status</TH><TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <tbody>
                {register.data!.rows.map((c) => (
                  <TR key={c.id} onClick={() => nav(`/organizations/${orgId}/certificates/${c.id}`)}>
                    <TD className="font-mono text-xs">{c.serial}</TD>
                    <TD className="font-medium text-slate-800 dark:text-slate-200">{c.recipient_name}</TD>
                    <TD className="text-slate-600 dark:text-slate-400">{c.championships?.name ?? '—'}</TD>
                    <TD className="text-slate-600 dark:text-slate-400">{c.sport ?? '—'}</TD>
                    <TD className="tabular-nums text-slate-500 dark:text-slate-400">{shortDate(c.issued_at)}</TD>
                    <TD><CertStatus status={c.status} /></TD>
                    <TD className="text-right">
                      <div className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => openDoc(`/certificates/${c.id}/render`)}
                          className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">Open</button>
                        <Link to={`/organizations/${orgId}/certificates/${c.id}`}
                          className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">Details</Link>
                      </div>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            {p && <Pagination page={page} pageCount={p.pages} total={p.matching} pageSize={p.page_size} onPage={setPage} />}
          </div>
        )}
      </Card>

      {gen && orgId && (
        <GenerateModal orgId={orgId} templates={templates.data?.rows ?? []} onClose={() => setGen(false)} invalidate={[registerPath]} />
      )}
    </div>
  );
}
