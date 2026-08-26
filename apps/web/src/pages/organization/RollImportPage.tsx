import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Upload, ShieldAlert, KeyRound } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useWorkspace } from '../../lib/useWorkspace';
import { CapabilityLock } from '../../components/CapabilityLock';
import { downloadCsvTemplate, matrixToRows, readFileToMatrix, type ImportColumn } from '../../lib/import';
import {
  Badge, BackButton, Button, Card, CardBody, CardHeader, PageHeader, Spinner, toast, INSET,} from '../../components/ui';

// Bulk-import the student roll (J1-E5).
//
// Validate first, always. The upload button does not exist until a dry run has
// come back, because the whole point of the epic is that a coordinator fixes a
// 2,000-row spreadsheet BEFORE committing it rather than discovering the
// problems afterwards. The server re-validates on apply regardless - this is the
// affordance, not the guarantee.

const COLUMNS: ImportColumn[] = [
  { key: 'name', aliases: ['full name', 'student name'] },
  { key: 'email', aliases: ['email address', 'e-mail'] },
  { key: 'phone', aliases: ['mobile', 'phone number', 'contact'] },
  { key: 'programme', aliases: ['program', 'course', 'department'] },
  { key: 'batch', aliases: ['year', 'batch year', 'class'] },
  { key: 'member_code', aliases: ['roll number', 'roll no', 'student id', 'code'] },
  { key: 'gender', aliases: ['sex'] },
  { key: 'date_of_birth', aliases: ['dob', 'birth date'] },
  { key: 'scholarship', aliases: ['scholarship status', 'aided'] },
];

const TEMPLATE_HEADERS = COLUMNS.map((c) => c.key);
const TEMPLATE_SAMPLE = [[
  'Asha Rao', 'asha@iimb.ac.in', '9876543210', 'Computer Science', '2024', 'CS-2024-017',
  'female', '2005-04-03', 'yes',
]];

interface RowResult {
  index: number;
  verdict: 'create' | 'match' | 'update' | 'reject';
  message: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}
interface Credential { name: string; email: string; phone: string | null; password: string }

interface Report {
  rows: RowResult[];
  summary: { total: number; create: number; match: number; update: number; reject: number };
  applied?: number;
  /** Sign-ins for accounts this import created. Returned once, never stored. */
  credentials?: Credential[];
}

const VERDICT_TONE = {
  create: 'green', match: 'info', update: 'amber', reject: 'rose',
} as const;

const VERDICT_LABEL = {
  create: 'New', match: 'Matched', update: 'Update', reject: 'Rejected',
} as const;

export function RollImportPage() {
  const { orgId } = useParams();
  const ws = useWorkspace();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);

  const reset = () => { setReport(null); setApplied(false); };

  const onFile = async (file: File) => {
    try {
      const parsed = matrixToRows(await readFileToMatrix(file), COLUMNS);
      // Blank trailing lines are what a spreadsheet leaves behind; rejecting
      // them as "name required" would bury the real problems.
      const meaningful = parsed.filter((r) => Object.values(r).some((v) => v.trim()));
      setRows(meaningful);
      setFileName(file.name);
      reset();
      if (meaningful.length === 0) toast.error('That file has no data rows.');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not read that file');
    }
  };

  const run = async (apply: boolean) => {
    setBusy(true);
    try {
      const path = `/organizations/${orgId}/people/import${apply ? '' : '/validate'}`;
      const res = await api<Report>('POST', path, { rows });
      setReport(res);
      if (apply) {
        setApplied(true);
        const made = res.credentials?.length ?? 0;
        toast.success(
          `Imported ${res.applied ?? 0} ${res.applied === 1 ? 'person' : 'people'}`,
          made > 0 ? `${made} new sign-in${made === 1 ? '' : 's'} to share — download them before leaving.` : undefined,
        );
      }
    } catch (e: any) {
      toast.error(e instanceof ApiError ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const importable = report ? report.summary.total - report.summary.reject : 0;
  const credentials = report?.credentials ?? [];

  // Reuses the same CSV writer the template download uses, so the file the
  // coordinator gets back opens in the spreadsheet they started from.
  const downloadCredentials = () => downloadCsvTemplate(
    `${fileName?.replace(/\.[^.]+$/, '') || 'student-roll'}-sign-ins.csv`,
    ['name', 'email', 'phone', 'temporary_password'],
    credentials.map((c) => [c.name, c.email, c.phone ?? '', c.password]),
  );

  // The server refuses the import without this capability, so the file picker is
  // replaced rather than left to fail on submit. Adding people one at a time is
  // never gated - only the bulk route to them.
  if (!ws.loading && !ws.granted.has('bulk_player_upload')) {
    return (
      <div className="space-y-5">
        <PageHeader title="Import the student roll" />
        <CapabilityLock capability="bulk_player_upload" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Import the student roll"
        subtitle="Upload a CSV or Excel file. Nothing is written until you have seen what the import will do."
      >
        <BackButton to={`/organizations/${orgId}/students`} className="mb-0">Players</BackButton>
      </PageHeader>

      <Card>
        <CardHeader
          title="1 · Choose a file"
          subtitle="Column headers are matched by name, so the order does not matter. Programmes and batches must already exist under Structure."
          action={<Button variant="outline" size="sm" onClick={() => downloadCsvTemplate('student-roll-template.csv', TEMPLATE_HEADERS, TEMPLATE_SAMPLE)}>Download template</Button>}
        />
        <CardBody className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <span className="flex items-center gap-2"><Upload size={16} aria-hidden /> Choose file</span>
            </Button>
            {fileName && <span className="text-sm text-slate-600 dark:text-slate-300">{fileName} · {rows.length} rows</span>}
          </div>

          {/* Said before they upload, not after. Gender, DOB and scholarship
              status are collected here and are never shown against a name
              anywhere in the product (J1-E5-S4). */}
          <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Gender, date of birth and scholarship status are optional. When supplied they are stored for
              aggregate reporting only — they are never displayed against a named person, in the directory,
              on a profile, or in any export. “Prefer not to say” is kept as its own answer rather than
              treated as missing.
            </span>
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="2 · Check what will happen" subtitle="A dry run. Nothing is written." />
        <CardBody className="space-y-3">
          <Button disabled={rows.length === 0 || busy} onClick={() => run(false)}>
            {busy && !applied ? 'Checking…' : 'Validate'}
          </Button>

          {busy && <Spinner />}

          {report && (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge tone="slate">{report.summary.total} rows</Badge>
                <Badge tone="green">{report.summary.create} new</Badge>
                <Badge tone="info">{report.summary.match} matched</Badge>
                <Badge tone="amber">{report.summary.update} update</Badge>
                <Badge tone="rose">{report.summary.reject} rejected</Badge>
              </div>

              <div className={`max-h-96 overflow-auto ${INSET}`}>
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Person</th>
                      <th className="px-3 py-2">Outcome</th>
                      <th className="px-3 py-2">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {report.rows.map((r) => (
                      <tr key={r.index} className={r.verdict === 'reject' ? 'bg-rose-50/50 dark:bg-rose-500/5' : undefined}>
                        <td className="px-3 py-2 text-slate-400 tnum">{r.index + 2}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{r.name ?? '—'}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{[r.email, r.phone].filter(Boolean).join(' · ') || '—'}</div>
                        </td>
                        <td className="px-3 py-2"><Badge tone={VERDICT_TONE[r.verdict]}>{VERDICT_LABEL[r.verdict]}</Badge></td>
                        <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">{r.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {/* Only reachable once a dry run exists. */}
      {report && !applied && (
        <Card>
          <CardHeader
            title="3 · Import"
            subtitle={
              report.summary.reject > 0
                ? `${importable} rows will be imported. The ${report.summary.reject} rejected rows are skipped — fix them and upload again.`
                : `${importable} rows will be imported.`
            }
          />
          <CardBody>
            <Button disabled={busy || importable === 0} onClick={() => run(true)}>
              {busy ? 'Importing…' : `Import ${importable} ${importable === 1 ? 'person' : 'people'}`}
            </Button>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Everyone imported starts as <strong>pending verification</strong>. Running the same file again
              changes nothing.
            </p>
          </CardBody>
        </Card>
      )}

      {applied && report && (
        <Card>
          <CardBody>
            <p className="text-sm">
              Imported <strong>{report.applied}</strong> {report.applied === 1 ? 'person' : 'people'}.
              {report.summary.reject > 0 && ` ${report.summary.reject} rows were rejected and not imported.`}
            </p>
          </CardBody>
        </Card>
      )}

      {/* Shown once, on this screen, and never again - the passwords are not stored
          anywhere in readable form. Leaving without downloading means resetting them
          one at a time, so the warning is blunt rather than polite. */}
      {applied && credentials.length > 0 && (
        <Card>
          <CardHeader
            title={`Sign-ins for ${credentials.length} new ${credentials.length === 1 ? 'account' : 'accounts'}`}
            subtitle="Share these with the people concerned. They are shown only now — once you leave this page they cannot be retrieved, only reset."
            action={<Button size="sm" onClick={downloadCredentials}>Download CSV</Button>}
          />
          <CardBody className="space-y-3">
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <KeyRound size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                Each person is asked to choose their own password the first time they sign in.
                Until they do, anyone who knows their name and phone number can work out this
                one — so hand them out directly rather than posting the list somewhere shared.
              </span>
            </p>
            <div className={`max-h-80 overflow-auto ${INSET}`}>
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Sign in with</th>
                    <th className="px-3 py-2">Temporary password</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {credentials.map((c) => (
                    <tr key={c.email}>
                      <td className="px-3 py-2">{c.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{c.email}{c.phone ? ` · ${c.phone}` : ''}</td>
                      <td className="px-3 py-2 font-mono text-xs font-semibold">{c.password}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
