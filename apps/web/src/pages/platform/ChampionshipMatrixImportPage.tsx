import { useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { Badge, Button, Card, Field, Select, Spinner, toast } from '../../components/ui';
import { downloadCsvTemplate, readFileToMatrix } from '../../lib/import';
import { parseChampionshipMatrix, type ParsedMatrix } from '../../lib/matrixImport';

interface UnmatchedRow {
  section: string; sport: string | null; discipline: string | null; role: string; name: string; phone: string;
}
interface Credential { name: string; email: string; phone: string | null; password: string }
interface ValidateResult {
  sections: { name: string; exists: boolean }[];
  sports: { sport: string; discipline: string | null }[];
  teams: number;
  people: { total: number; matched: number; unmatched: number };
  will_create: number;
  unmatched: UnmatchedRow[];
}
interface CommitResult {
  orgs: { created: number; existing: number };
  sports: { created: number };
  disciplines: { created: number };
  draws: { created: number };
  teams: { created: number; existing: number };
  users: { created: number };
  owners_assigned: number; captains_assigned: number; pocs_assigned: number;
  people: { total: number; matched: number; unmatched: number };
  created_users: Credential[];
  unmatched: UnmatchedRow[];
}

const drawLabel = (u: { sport: string; discipline: string | null }) => (u.discipline ? `${u.sport} (${u.discipline})` : u.sport);
const unmatchedLabel = (u: UnmatchedRow) =>
  [u.section, u.sport ? drawLabel({ sport: u.sport, discipline: u.discipline }) : 'Overall', u.role].filter(Boolean).join(' · ');

function UnmatchedTable({ rows }: { rows: UnmatchedRow[] }) {
  return (
    <div className="max-h-60 overflow-auto rounded-lg border border-amber-200 dark:border-amber-900/50">
      <table className="min-w-full text-sm">
        <thead className="bg-amber-50 dark:bg-amber-900/20 text-left text-xs font-semibold uppercase text-amber-700 dark:text-amber-400">
          <tr><th className="px-3 py-2">Where</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Phone</th></tr>
        </thead>
        <tbody>
          {rows.map((u, i) => (
            <tr key={i} className="border-t border-amber-100 dark:border-amber-900/40">
              <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300">{unmatchedLabel(u)}</td>
              <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{u.name || '-'}</td>
              <td className="px-3 py-1.5 font-mono text-xs text-slate-500 dark:text-slate-400">{u.phone}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChampionshipMatrixImportPage() {
  const { data: championships = [] } = useApi<{ id: string; name: string }[]>('/championships');
  const { data: formats = [] } = useApi<{ id: string; name: string }[]>('/tournament-formats');
  const { data: organizations = [] } = useApi<{ id: string; name: string }[]>('/organizations');

  const [champId, setChampId] = useState('');
  const [formatId, setFormatId] = useState('');
  const [createOrgId, setCreateOrgId] = useState('');
  const [parsed, setParsed] = useState<ParsedMatrix | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => { setValidation(null); setResult(null); setError(null); };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    reset();
    try {
      const matrix = await readFileToMatrix(file);
      setParsed(parseChampionshipMatrix(matrix));
      setFileName(file.name);
    } catch (e: any) {
      setParsed(null);
      setError(e?.message ?? 'Could not read that file');
    }
  };

  const payload = () => ({
    default_format_id: formatId,
    create_missing_org_id: createOrgId && createOrgId !== '__section__' ? createOrgId : undefined,
    create_missing_in_section: createOrgId === '__section__' || undefined,
    sections: parsed!.sections,
    owners: parsed!.owners,
    units: parsed!.units,
  });

  const ready = !!champId && !!formatId && !!parsed && parsed.sections.length > 0;

  const run = async (commit: boolean) => {
    setError(null);
    setBusy(true);
    try {
      const path = `/championships/${champId}/matrix-import${commit ? '' : '/validate'}`;
      const res = await api<ValidateResult & CommitResult>('POST', path, payload());
      if (commit) { setResult(res as CommitResult); toast.success('Import complete'); }
      else setValidation(res as ValidateResult);
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : (e?.message ?? 'Request failed');
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold dark:text-slate-100">Import championship setup</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Upload the sections × sport/discipline matrix to build organizations, sports, teams and assign POCs/captains in one pass.
          People are matched to existing users by phone number; anyone not found is skipped and listed for you to fix.
        </p>
      </div>

      <Card className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Championship">
            <Select value={champId} onChange={(e) => { setChampId(e.target.value); reset(); }}>
              <option value="">- select championship -</option>
              {championships.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Default fixture format (applied to every sport)">
            <Select value={formatId} onChange={(e) => { setFormatId(e.target.value); reset(); }}>
              <option value="">- select format -</option>
              {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
          <Field label="Create missing users in (optional)">
            <Select value={createOrgId} onChange={(e) => { setCreateOrgId(e.target.value); reset(); }}>
              <option value="">- skip & report unmatched -</option>
              <option value="__section__">Each person's section org (created by this import)</option>
              {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          People are matched to existing users by phone. Pick an organization above to auto-create anyone not found
          (email is generated from their phone; password is <span className="font-mono">firstname@last4</span>, changed on first sign-in).
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.xlsx,.xls,.txt"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <Button variant="outline" onClick={() => fileInput.current?.click()}>Choose matrix file</Button>
          {fileName && <span className="text-sm text-slate-500 dark:text-slate-400">{fileName}</span>}
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Expected layout: a "Name / Phone Number" header row, section columns across, and "Sport (Discipline)" rows with Captain/POC plus an "Overall" block.
        </p>
      </Card>

      {parsed && (
        <Card className="space-y-3 p-5">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Parsed from file</div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="slate">{parsed.sections.length} sections</Badge>
            <Badge tone="slate">{parsed.units.length} sport/discipline draws</Badge>
            <Badge tone="slate">{parsed.owners.length} overall POC entries</Badge>
          </div>
          {parsed.sections.length > 0 && (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Sections: {parsed.sections.join(', ')} · Draws: {parsed.units.map(drawLabel).join(', ') || '-'}
            </div>
          )}
          {parsed.warnings.length > 0 && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-700 dark:text-amber-400">
              <div className="mb-1 font-semibold">{parsed.warnings.length} warning(s)</div>
              <ul className="list-disc space-y-0.5 pl-4">{parsed.warnings.slice(0, 20).map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
          <div className="flex gap-2">
            <Button disabled={!ready || busy} onClick={() => run(false)}>{busy && !result ? 'Validating…' : 'Validate'}</Button>
            {!ready && <span className="self-center text-xs text-slate-400">Select a championship and format first.</span>}
          </div>
        </Card>
      )}

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      {validation && !result && (
        <Card className="space-y-4 p-5">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Validation preview (nothing saved yet)</div>
          <div className="flex flex-wrap gap-2 text-sm">
            {validation.sections.map((s) => (
              <Badge key={s.name} tone={s.exists ? 'slate' : 'green'}>{s.name}{s.exists ? '' : ' (new)'}</Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="slate">{validation.sports.length} draws</Badge>
            <Badge tone="slate">{validation.teams} teams</Badge>
            <Badge tone="green">{validation.people.matched} people matched</Badge>
            {validation.will_create > 0 && <Badge tone="brand">{validation.will_create} new users to create</Badge>}
            {validation.people.unmatched > 0 && !createOrgId && <Badge tone="amber">{validation.people.unmatched} unmatched</Badge>}
          </div>
          {validation.unmatched.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                {createOrgId
                  ? `These phones match no existing user — they'll be created in ${createOrgId === '__section__'
                      ? "each person's section organization"
                      : `"${organizations.find((o) => o.id === createOrgId)?.name ?? 'the selected org'}"`}:`
                  : 'These phones match no existing user and will be skipped — pick a "Create missing users in" option above, or add them to Users first:'}
              </div>
              <UnmatchedTable rows={validation.unmatched} />
            </div>
          )}
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => run(true)}>{busy ? 'Importing…' : 'Confirm & import'}</Button>
            <Button variant="ghost" onClick={() => setValidation(null)}>Back</Button>
          </div>
        </Card>
      )}

      {result && (
        <Card className="space-y-4 p-5">
          <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Import complete</div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="green">{result.orgs.created} orgs created</Badge>
            <Badge tone="slate">{result.orgs.existing} existing</Badge>
            <Badge tone="green">{result.sports.created} sports</Badge>
            <Badge tone="green">{result.disciplines.created} disciplines</Badge>
            <Badge tone="green">{result.draws.created} draws</Badge>
            <Badge tone="green">{result.teams.created} teams created</Badge>
            <Badge tone="slate">{result.teams.existing} existing</Badge>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="green">{result.users.created} users created</Badge>
            <Badge tone="brand">{result.owners_assigned} owners</Badge>
            <Badge tone="brand">{result.captains_assigned} captains</Badge>
            <Badge tone="brand">{result.pocs_assigned} POCs</Badge>
            {result.people.unmatched > 0 && <Badge tone="amber">{result.people.unmatched} skipped (unmatched)</Badge>}
          </div>
          {result.created_users.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  New logins (change required on first sign-in). Share securely — email is derived from phone.
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadCsvTemplate(
                    'matrix-user-credentials.csv',
                    ['name', 'email', 'phone', 'password'],
                    result.created_users.map((c) => [c.name, c.email, c.phone ?? '', c.password]),
                  )}
                >
                  ↓ Download credentials CSV
                </Button>
              </div>
              <div className="max-h-52 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                    <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Password</th></tr>
                  </thead>
                  <tbody>
                    {result.created_users.map((c) => (
                      <tr key={c.email} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{c.name}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-slate-600 dark:text-slate-300">{c.email}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-slate-700 dark:text-slate-200">{c.password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {result.unmatched.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">Skipped — no user matched these phones:</div>
              <UnmatchedTable rows={result.unmatched} />
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => run(false)} disabled={busy}>Re-validate</Button>
            <Button variant="ghost" onClick={reset}>Done</Button>
          </div>
        </Card>
      )}

      {(championships.length === 0 || formats.length === 0) && (
        <div className="grid h-10 place-items-center"><Spinner /></div>
      )}
    </div>
  );
}
