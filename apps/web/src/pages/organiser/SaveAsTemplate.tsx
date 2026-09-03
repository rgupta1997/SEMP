import { useState } from 'react';
import { Bookmark, Check } from 'lucide-react';
import type { TemplateShape } from '@semp/shared';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import { Button, Field, Input, Select, Textarea, toast } from '../../components/ui';

// "Keep this setup as a template."
//
// The product derives the shape - the organiser only supplies a name. That division is
// deliberate: nobody wants to describe their championship twice, and a shape captured
// from something that actually ran is more trustworthy than one typed into a form.
//
// Shown once the setup exists, so what is being kept can be listed before it is named.

export function SaveAsTemplate({ eventId, championshipName }: { eventId: string; championshipName?: string }) {
  const { ctx } = useAuth();
  const { data: shape } = useApi<TemplateShape>(`/championships/${eventId}/template-shape`);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [orgId, setOrgId] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Only organisations this person can actually save into; anything else is theirs.
  const orgs = (ctx?.organizations ?? [])
    .filter((m) => m.status === 'active' && ['owner', 'admin'].includes(m.role))
    .map((m) => ({ id: m.organization_id, name: m.organization?.name ?? 'Organisation' }));
  const draws = shape?.draws ?? [];

  if (draws.length === 0) return null;

  if (saved) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
        <Check size={16} />
        Saved as <b>{saved}</b> - it will be waiting on the first step next time you create a championship.
      </div>
    );
  }

  const save = async () => {
    setNameError(null);
    if (name.trim().length < 2) { setNameError('Give the template a name'); return; }
    setBusy(true);
    try {
      const res: any = await api('POST', `/championships/${eventId}/save-template`, {
        name: name.trim(),
        description: description.trim() || null,
        organization_id: orgId || null,
      });
      setSaved(res.name);
      toast.success('Template saved', 'You can start from it next time.');
    } catch (e: any) {
      // Almost always the duplicate-name rule (a name is this person's across every
      // scope they can save into - see templates.service.ts) - shown beside the
      // field that caused it rather than as a toast that has scrolled away by the
      // time someone looks back at the form.
      setNameError(e.message ?? 'Could not save the template');
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-brand-50 p-2 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
          <Bookmark size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold text-slate-900 dark:text-slate-100">Run this again next year?</h4>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            We have captured the shape of {championshipName ? <b>{championshipName}</b> : 'this championship'}. Give
            it a name and it becomes one of your starting points.
          </p>

          {/* What is being kept, before it is named - nobody should have to trust a
              blank box with the setup they just spent an hour on. */}
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {draws.map((d) => (
              <li key={d.sport}
                className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {d.sport}{d.disciplines.length ? ` · ${d.disciplines.length}` : ''}
              </li>
            ))}
          </ul>

          <div className="mt-4 grid gap-x-4 sm:grid-cols-2">
            <Field label="Template name">
              <Input value={name} onChange={(e) => { setName(e.target.value); setNameError(null); }}
                placeholder="e.g. Our annual inter-batch meet" maxLength={80} />
              {nameError && <span className="mt-1 block text-xs text-rose-600 dark:text-rose-400">{nameError}</span>}
            </Field>
            {orgs.length > 0 && (
              <Field label="Who can use it" hint="An organisation's templates outlive whoever saved them.">
                <Select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                  <option value="">Only me</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              </Field>
            )}
          </div>
          <Field label="Description" hint="Optional. Shown on the card when you pick it.">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Six sports over three days, scored on a medal tally." maxLength={280} />
          </Field>

          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save as template'}</Button>
        </div>
      </div>
    </div>
  );
}
