import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { BadgeCheck, Download, FileText, Plus, ShieldOff, Sparkles } from 'lucide-react';
import { useApi, useApiMutation } from '../../lib/hooks';
import { api } from '../../lib/api';
import { Card, PageHeader, Skeleton, Button, Input, Select, Modal, confirmDialog, toast, cn } from '../../components/ui';

// Certificates Manager (J4-E6/E7/E8).
//
// The register and the templates are one screen because they are one job: an
// institution comes here either to issue a batch or to answer "did we issue this?".
// Splitting them made the second question a hunt.

interface Template { id: string; name: string; code: string | null; is_default: boolean }
interface Cert {
  id: string; serial: string; recipient_name: string; issued_at: string;
  revoked_at: string | null; revoked_reason: string | null; superseded_at: string | null;
  token: string; championships: { id: string; name: string } | null;
}
interface Register { rows: Cert[]; summary: { total: number; live: number; revoked: number; verification_scans: number } }
interface Champ { id: string; name: string }
interface GenerateResult { issued: number; skipped: number; note?: string; results?: Array<{ ok: boolean; serial?: string; reason?: string }> }

const KINDS: Array<{ key: 'medal' | 'placement' | 'award'; label: string; blurb: string }> = [
  { key: 'medal', label: 'Medals', blurb: 'Gold, silver and bronze' },
  { key: 'placement', label: 'Placements', blurb: 'Semi-finalist, quarter-finalist' },
  { key: 'award', label: 'Awards', blurb: 'Player of the match and the rest' },
];

export function OrgCertificatesPage() {
  const { orgId } = useParams();
  const [q, setQ] = useState('');
  const [newName, setNewName] = useState('');
  const [open, setOpen] = useState(false);
  const [champId, setChampId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [kinds, setKinds] = useState<string[]>(['medal', 'placement']);
  const [outcome, setOutcome] = useState<GenerateResult | null>(null);

  const templatesPath = orgId ? `/organizations/${orgId}/certificate-templates` : null;
  const registerPath = orgId ? `/organizations/${orgId}/certificates${q ? `?q=${encodeURIComponent(q)}` : ''}` : null;
  const templates = useApi<{ rows: Template[] }>(templatesPath);
  const register = useApi<Register>(registerPath);

  const createTemplate = useApiMutation(
    (body: { name: string }) => api('POST', templatesPath!, body),
    [templatesPath],
  );
  const revoke = useApiMutation(
    (body: { id: string; reason: string }) => api('POST', `/certificates/${body.id}/revoke`, { reason: body.reason }),
    [registerPath],
  );
  // Only championships this institution actually took part in - offering the whole
  // platform would be a picker of things that can only produce an empty batch.
  const champs = useApi<Champ[]>('/championships/mine');
  const generate = useApiMutation(
    (body: any) => api('POST', `/organizations/${orgId}/certificates/generate`, body),
    [registerPath],
  );

  const onGenerate = async () => {
    if (!champId) return;
    try {
      const r = await generate.mutateAsync({
        championship_id: champId,
        ...(templateId ? { template_id: templateId } : {}),
        kinds,
      });
      setOutcome(r as GenerateResult);
      // Deliberately NOT auto-closed. The per-match report is the point: "8 issued,
      // 3 already had one" is what tells somebody the run did what they expected.
      if ((r as GenerateResult).issued > 0) toast.success(`${(r as GenerateResult).issued} issued`);
    } catch (e: any) { toast.error('Could not generate', e?.message); }
  };

  const s = register.data?.summary;

  // Opening the artefact: fetched WITH the session, then handed to the browser as a
  // blob. A bare <a href> would send no Authorization header and get a 401, and the
  // API is on another origin in dev so a relative path would hit Vite instead.
  const openCertificate = async (c: Cert) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL ?? 'http://localhost:4000'}/api/certificates/${c.id}/render`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('semp_token') ?? ''}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener');
      // Revoked on a delay so the new tab has actually loaded it first.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) { toast.error('Could not open the certificate', e?.message); }
  };

  const onCreate = async () => {
    if (!newName.trim()) return;
    try {
      await createTemplate.mutateAsync({ name: newName.trim() });
      setNewName('');
      toast.success('Template created');
    } catch (e: any) { toast.error('Could not create the template', e?.message); }
  };

  const onRevoke = async (c: Cert) => {
    const ok = await confirmDialog({
      title: `Withdraw ${c.serial}?`,
      // The consequence, stated plainly - this is the point of the confirmation.
      message: 'It will stop verifying immediately for anyone who scans it. The record of it being issued is kept, so the register stays complete.',
      confirmLabel: 'Withdraw',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await revoke.mutateAsync({ id: c.id, reason: 'Withdrawn from the certificates register' });
      toast.success(`${c.serial} withdrawn`);
    } catch (e: any) { toast.error('Could not withdraw it', e?.message); }
  };

  return (
    <div className="grid gap-5">
      <PageHeader title="Certificates" subtitle="Issue, withdraw and verify — every one carries a signature a stranger can check.">
        <Button onClick={() => { setOutcome(null); setOpen(true); }}>
          <Sparkles size={15} aria-hidden />Generate certificates
        </Button>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Issued', value: s?.total },
          { label: 'Live', value: s?.live },
          { label: 'Withdrawn', value: s?.revoked },
          { label: 'Verification scans', value: s?.verification_scans },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{k.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{k.value ?? '—'}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Issued register</h2>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or serial…" className="w-56" aria-label="Search the register" />
          </div>
          {register.isLoading ? <Skeleton className="h-40" /> : (register.data?.rows.length ?? 0) === 0 ? (
            <div className="px-4 py-10 text-center">
              <FileText size={22} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" aria-hidden />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Nothing issued yet. Certificates are generated from locked results — never typed in by hand.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="px-4 py-2 font-medium">Serial</th>
                    <th className="px-3 py-2 font-medium">Recipient</th>
                    <th className="px-3 py-2 font-medium">Event</th>
                    <th className="px-3 py-2 font-medium">Issued</th>
                    <th className="px-4 py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {register.data!.rows.map((c) => {
                    const dead = !!c.revoked_at || !!c.superseded_at;
                    return (
                      <tr key={c.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                        <td className="px-4 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{c.serial}</td>
                        <td className="px-3 py-2 text-slate-800 dark:text-slate-200">{c.recipient_name}</td>
                        <td className="px-3 py-2 truncate text-slate-600 dark:text-slate-400">{c.championships?.name ?? '—'}</td>
                        <td className="px-3 py-2 tabular-nums text-slate-500 dark:text-slate-400">
                          {new Date(c.issued_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {dead ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                              <ShieldOff size={11} aria-hidden />{c.revoked_at ? 'Withdrawn' : 'Superseded'}
                            </span>
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <button type="button" onClick={() => openCertificate(c)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                                <Download size={11} aria-hidden />Open
                              </button>
                              <a href={`/verify/${c.token}`} target="_blank" rel="noreferrer"
                                className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">Verify</a>
                              <button type="button" onClick={() => onRevoke(c)}
                                className="text-xs font-medium text-rose-600 hover:underline dark:text-rose-400">Withdraw</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="h-fit p-0">
          <div className="border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Templates</h2>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {(templates.data?.rows ?? []).map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                <span className="flex-1 truncate text-slate-800 dark:text-slate-200">{t.name}</span>
                {t.code && <span className="font-mono text-xs text-slate-400">{t.code}</span>}
                {t.is_default && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    <BadgeCheck size={11} aria-hidden />default
                  </span>
                )}
              </li>
            ))}
            {(templates.data?.rows.length ?? 0) === 0 && (
              <li className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                No templates yet. The first one you create becomes the default.
              </li>
            )}
          </ul>
          <div className="flex gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Template name" aria-label="New template name" />
            <Button onClick={onCreate} disabled={!newName.trim() || createTemplate.isPending}>
              <Plus size={15} aria-hidden />
            </Button>
          </div>
        </Card>
      </div>

      {open && (
        <Modal
          title="Generate certificates"
          onClose={() => setOpen(false)}
          // Not dismissible by backdrop: a stray click must not discard the report of a
          // run that has already issued documents.
          dismissible={false}
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>{outcome ? 'Done' : 'Cancel'}</Button>
              <Button onClick={onGenerate} disabled={!champId || kinds.length === 0 || generate.isPending}>
                {generate.isPending ? 'Generating…' : outcome ? 'Run again' : 'Generate'}
              </Button>
            </div>
          }
        >
          <div className="grid gap-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Certificates are produced from <b>locked results only</b>. Anyone who already has one for the
              same honour is skipped, so running this twice is safe.
            </p>

            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-300">Championship</span>
              <Select value={champId} onChange={(e) => setChampId(e.target.value)}>
                <option value="">Choose a championship…</option>
                {(champs.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </label>

            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-300">Template</span>
              <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Default template</option>
                {(templates.data?.rows ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </label>

            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium text-slate-700 dark:text-slate-300">What to certify</legend>
              {KINDS.map((k) => (
                <label key={k.key} className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox" className="mt-0.5" checked={kinds.includes(k.key)}
                    onChange={(e) => setKinds((cur) => e.target.checked ? [...cur, k.key] : cur.filter((x) => x !== k.key))}
                  />
                  <span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">{k.label}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{k.blurb}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {outcome && (
              <div className={cn('rounded-lg border p-3 text-sm',
                outcome.issued > 0
                  ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
                  : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60')}>
                <div className="font-medium text-slate-800 dark:text-slate-200">
                  {outcome.issued} issued{outcome.skipped ? `, ${outcome.skipped} skipped` : ''}
                </div>
                {outcome.note && <p className="mt-1 text-slate-600 dark:text-slate-400">{outcome.note}</p>}
                {/* The per-row reasons, because "3 skipped" without saying why is not a report. */}
                {(outcome.results ?? []).some((r) => !r.ok) && (
                  <ul className="mt-2 grid gap-0.5 text-xs text-slate-600 dark:text-slate-400">
                    {[...new Set((outcome.results ?? []).filter((r) => !r.ok).map((r) => r.reason))]
                      .map((reason) => (
                        <li key={reason}>
                          {(outcome.results ?? []).filter((r) => r.reason === reason).length} × {reason}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
