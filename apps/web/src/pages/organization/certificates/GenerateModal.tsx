import { useState } from 'react';
import { useApi, useApiMutation } from '../../../lib/hooks';
import { api } from '../../../lib/api';
import { Button, Modal, Select, cn, toast } from '../../../components/ui';
import type { Template } from './shared';

// Bulk generation (J4-E7).

interface Champ { id: string; name: string }
interface GenerateResult { issued: number; skipped: number; note?: string; results?: Array<{ ok: boolean; serial?: string; reason?: string }> }

const KINDS: Array<{ key: 'medal' | 'placement' | 'award'; label: string; blurb: string }> = [
  { key: 'medal', label: 'Medals', blurb: 'Gold, silver and bronze' },
  { key: 'placement', label: 'Placements', blurb: 'Semi-finalist, quarter-finalist' },
  { key: 'award', label: 'Awards', blurb: 'Player of the match and the rest' },
];

export function GenerateModal({ orgId, templates, onClose, invalidate }: {
  orgId: string; templates: Template[]; onClose: () => void; invalidate: (string | null)[];
}) {
  const [champId, setChampId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [kinds, setKinds] = useState<string[]>(['medal', 'placement']);
  const [outcome, setOutcome] = useState<GenerateResult | null>(null);

  // Only championships this institution actually took part in - offering the whole
  // platform would be a picker of things that can only produce an empty batch.
  const champs = useApi<Champ[]>('/championships/mine');
  const generate = useApiMutation(
    (body: any) => api('POST', `/organizations/${orgId}/certificates/generate`, body),
    invalidate,
  );

  const onGenerate = async () => {
    if (!champId) return;
    try {
      const r = await generate.mutateAsync({
        championship_id: champId,
        ...(templateId ? { template_id: templateId } : {}),
        kinds,
      }) as GenerateResult;
      setOutcome(r);
      if (r.issued > 0) toast.success(`${r.issued} issued`);
    } catch (e: any) { toast.error('Could not generate', e?.message); }
  };

  return (
    <Modal
      title="Generate certificates"
      onClose={onClose}
      // Not dismissible by backdrop: a stray click must not discard the report of a
      // run that has already issued documents.
      dismissible={false}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{outcome ? 'Done' : 'Cancel'}</Button>
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
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
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
              : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60')}>
            <div className="font-medium text-slate-800 dark:text-slate-200">
              {outcome.issued} issued{outcome.skipped ? `, ${outcome.skipped} skipped` : ''}
            </div>
            {outcome.note && <p className="mt-1 text-slate-600 dark:text-slate-400">{outcome.note}</p>}
            {/* The per-row reasons, because "3 skipped" without saying why is not a report. */}
            {(outcome.results ?? []).some((r) => !r.ok) && (
              <ul className="mt-2 grid gap-0.5 text-xs text-slate-600 dark:text-slate-400">
                {[...new Set((outcome.results ?? []).filter((r) => !r.ok).map((r) => r.reason))].map((reason) => (
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
  );
}
