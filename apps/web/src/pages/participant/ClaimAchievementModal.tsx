import { useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { useApi, useApiMutation } from '../../lib/hooks';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, Input, Modal, Select, Textarea, cn, toast } from '../../components/ui';

// Claiming an achievement earned elsewhere (J4-E5-S1).
//
// The evidence is the whole point of the form: a validator deciding on a title alone is
// guessing. So the file picker sits with the fields rather than behind an "advanced"
// disclosure, and the copy says who will read it.

const MAX_BYTES = 3 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf';

interface Sport { id: string; name: string }

/** Read a File as the base64 payload the API expects. */
const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^;]+;base64,/, ''));
  r.onerror = () => reject(new Error('Could not read that file'));
  r.readAsDataURL(file);
});

export function ClaimAchievementModal({ onClose, invalidate }: { onClose: () => void; invalidate: (string | null)[] }) {
  const { ctx } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);

  // Only institutions this person actually belongs to - the API enforces it too, but
  // a picker that offers a rejection is a picker that wastes somebody's time. A
  // personal workspace is an implementation detail of solo entry and has nobody in it
  // to review anything, so it is never a candidate.
  const orgs = (ctx?.organizations ?? []).filter((m) => m.organization?.kind !== 'personal');
  const [orgIdRaw, setOrgId] = useState('');
  const orgId = orgIdRaw || (orgs.length === 1 ? orgs[0].organization_id : '');

  const [title, setTitle] = useState('');
  const [occurredOn, setOccurredOn] = useState('');
  const [sportId, setSportId] = useState('');
  const [detail, setDetail] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const sports = useApi<Sport[] | { rows: Sport[] }>('/sports');
  const sportRows: Sport[] = Array.isArray(sports.data) ? sports.data : sports.data?.rows ?? [];

  const submit = useApiMutation((body: any) => api('POST', '/claims', body), invalidate);

  const addFiles = (picked: FileList | null) => {
    if (!picked) return;
    const next: File[] = [];
    for (const f of Array.from(picked)) {
      if (f.size > MAX_BYTES) { toast.error(`${f.name} is over 3MB`, 'Try a smaller scan or a photo.'); continue; }
      next.push(f);
    }
    setFiles((cur) => [...cur, ...next].slice(0, 5));
  };

  const onSubmit = async () => {
    if (!orgId || !title.trim() || !occurredOn) return;
    setBusy(true);
    try {
      const claim = await submit.mutateAsync({
        organization_id: orgId,
        title: title.trim(),
        occurred_on: occurredOn,
        detail: detail.trim() || null,
        sport_id: sportId || null,
      }) as { id: string };

      // Files go up one at a time after the claim exists. A partial upload therefore
      // leaves a real claim with some evidence on it, which a validator can still act
      // on - better than losing the whole submission to one bad file.
      const failed: string[] = [];
      for (const f of files) {
        try {
          await api('POST', `/claims/${claim.id}/evidence`, {
            filename: f.name, mime: f.type, data: await toBase64(f),
          });
        } catch { failed.push(f.name); }
      }

      if (failed.length) toast.error(`Claim submitted, but ${failed.length} file(s) did not attach`, failed.join(', '));
      else toast.success('Claim submitted', 'Your institution will review it and you will be told either way.');
      onClose();
    } catch (e: any) {
      toast.error('Could not submit the claim', e?.message);
    } finally { setBusy(false); }
  };

  const ready = !!orgId && title.trim().length >= 3 && !!occurredOn;

  return (
    <Modal
      title="Claim an achievement"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} disabled={!ready || busy}>{busy ? 'Submitting…' : 'Submit for review'}</Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          For something you won <b>outside</b> this platform. Your institution reviews it, and if they
          vouch for it, it joins your record marked as a validated claim — never as a locked result.
        </p>

        {orgs.length > 1 && (
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">Which institution should review it?</span>
            <Select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              <option value="">Choose…</option>
              {orgs.map((m) => (
                <option key={m.organization_id} value={m.organization_id}>{m.organization?.name ?? 'Unnamed institution'}</option>
              ))}
            </Select>
          </label>
        )}

        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-300">What did you achieve?</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Gold — State Aquatics Championship, 200m freestyle" />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">When</span>
            <Input type="date" value={occurredOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setOccurredOn(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-300">Sport <span className="font-normal text-slate-400">(optional)</span></span>
            <Select value={sportId} onChange={(e) => setSportId(e.target.value)}>
              <option value="">Not listed / not applicable</option>
              {sportRows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </label>
        </div>

        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-300">Anything the reviewer should know <span className="font-normal text-slate-400">(optional)</span></span>
          <Textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Where it was, who ran it, what the result was." />
        </label>

        <div className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Evidence</span>
          <input
            ref={fileInput} type="file" accept={ACCEPT} multiple className="sr-only"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
          <button
            type="button" onClick={() => fileInput.current?.click()}
            className={cn('flex items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-4 text-sm transition-colors',
              'border-slate-300 text-slate-600 hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:text-slate-400')}
          >
            <Paperclip size={15} aria-hidden />
            {files.length ? 'Add another file' : 'Attach your certificate or photo'}
          </button>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Images or PDF, up to 3MB each, five at most. Only you and the people who review claims at
            your institution can open them.
          </p>
          {files.length > 0 && (
            <ul className="grid gap-1.5">
              {files.map((f, i) => (
                <li key={`${f.name}${i}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60">
                  <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-300">{f.name}</span>
                  <span className="shrink-0 text-slate-400">{Math.round(f.size / 1024)}KB</span>
                  <button
                    type="button" aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                    className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700"
                  ><X size={12} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
