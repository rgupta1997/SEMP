import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BadgeCheck, Save, Trash2 } from 'lucide-react';
import { useApi, useApiMutation } from '../../../lib/hooks';
import { api } from '../../../lib/api';
import {
  BackButton, Button, Card, Input, PageHeader, Skeleton, Textarea, confirmDialog, toast,
} from '../../../components/ui';
import { SheetPreview, type Template } from './shared';

// Template preview and edit.
//
// The preview is the live render, refreshed after each save rather than after each
// keystroke: an institution is approving a document, and a preview that flickers as
// you type is a worse basis for approval than one that settles.

const LAYOUTS = [
  { id: 'classic', name: 'Classic Laurel' },
  { id: 'minimal', name: 'Modern Minimal' },
  { id: 'athletic', name: 'Athletic Banner' },
  { id: 'ornate', name: 'Ornate Frame' },
  { id: 'institutional', name: 'Institutional Letterhead' },
  { id: 'ribbon', name: 'Participation Ribbon' },
];

export function TemplatePreviewPage() {
  const { orgId, templateId } = useParams();
  const nav = useNavigate();
  const templatesPath = orgId ? `/organizations/${orgId}/certificate-templates` : null;
  const { data, isLoading } = useApi<{ rows: Template[] }>(templatesPath);
  const tpl = data?.rows.find((t) => t.id === templateId);

  const [form, setForm] = useState<{ name: string; design: Record<string, any> } | null>(null);
  // Bumped on save so the iframe refetches; without it the browser serves the render
  // it already has and the preview silently lies about what was just saved.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (tpl && !form) setForm({ name: tpl.name, design: { ...tpl.design } });
  }, [tpl, form]);

  const save = useApiMutation(
    (body: any) => api('PATCH', `/certificate-templates/${templateId}`, body),
    [templatesPath],
  );
  const remove = useApiMutation(
    () => api('DELETE', `/certificate-templates/${templateId}`),
    [templatesPath],
  );

  if (isLoading || !form) return <Skeleton className="h-96" />;
  if (!tpl) return null;

  const set = (k: string, v: string) => setForm((f) => ({ ...f!, design: { ...f!.design, [k]: v } }));

  const onSave = async (extra: Record<string, unknown> = {}) => {
    try {
      await save.mutateAsync({ name: form.name, design: form.design, ...extra });
      setVersion((v) => v + 1);
      toast.success('Template saved');
    } catch (e: any) { toast.error('Could not save it', e?.message); }
  };

  const onDelete = async () => {
    const ok = await confirmDialog({
      title: `Archive ${tpl.name}?`,
      // Certificates already issued from it keep their own frozen copy of the facts,
      // so archiving a template never disturbs a document somebody is holding.
      message: tpl.used_count > 0
        ? `${tpl.used_count} certificate${tpl.used_count === 1 ? '' : 's'} were issued from it. Those are unaffected — they keep the wording they were issued with. You just cannot issue new ones from this template.`
        : 'It has not been used yet, so nothing is affected.',
      confirmLabel: 'Archive',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(undefined as any);
      toast.success(`${tpl.name} archived`);
      nav(`/organizations/${orgId}/certificates/templates`);
    } catch (e: any) { toast.error('Could not archive it', e?.message); }
  };

  return (
    <div className="grid gap-5">
      <BackButton to={`/organizations/${orgId}/certificates/templates`}>Back to templates</BackButton>
      <PageHeader title={tpl.name} subtitle={`${tpl.used_count} certificate${tpl.used_count === 1 ? '' : 's'} issued from this template`}>
        <Button variant="ghost" onClick={onDelete}><Trash2 size={15} aria-hidden />Archive</Button>
        {!tpl.is_default && (
          <Button variant="ghost" onClick={() => onSave({ is_default: true })}>
            <BadgeCheck size={15} aria-hidden />Make default
          </Button>
        )}
        <Button onClick={() => onSave()} disabled={save.isPending}>
          <Save size={15} aria-hidden />{save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Card className="grid place-items-center overflow-x-auto p-4">
          <SheetPreview key={version} path={`/certificate-templates/${templateId}/preview?v=${version}`} width={720} />
        </Card>

        <div className="grid h-fit gap-5">
          <Card className="p-0">
            <div className="border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Design</h2>
            </div>
            <div className="grid gap-3 p-4">
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-300">Template name</span>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>

              <fieldset className="grid gap-1.5">
                <legend className="text-sm font-medium text-slate-700 dark:text-slate-300">Layout</legend>
                <div className="grid grid-cols-2 gap-1.5">
                  {LAYOUTS.map((l) => (
                    <button
                      key={l.id} type="button" onClick={() => set('layout', l.id)}
                      aria-pressed={form.design.layout === l.id}
                      className={`rounded-lg border px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                        form.design.layout === l.id
                          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:text-slate-400'}`}
                    >{l.name}</button>
                  ))}
                </div>
              </fieldset>

              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-300">Accent colour</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color" value={form.design.accent ?? '#0C5A63'} onChange={(e) => set('accent', e.target.value)}
                    className="h-9 w-12 shrink-0 cursor-pointer rounded border border-slate-300 bg-white dark:border-slate-800"
                    aria-label="Accent colour"
                  />
                  <Input value={form.design.accent ?? '#0C5A63'} onChange={(e) => set('accent', e.target.value)} className="font-mono text-xs" />
                </div>
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-300">Heading</span>
                <Input value={form.design.heading ?? ''} onChange={(e) => set('heading', e.target.value)} placeholder="Certificate of Achievement" />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-300">Body</span>
                <Textarea rows={3} value={form.design.body ?? ''} onChange={(e) => set('body', e.target.value)}
                  placeholder="is hereby recognised for the achievement below…" />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-300">Signatory</span>
                <Input value={form.design.signatory_name ?? ''} onChange={(e) => set('signatory_name', e.target.value)} placeholder="Defaults to the institution's name" />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-300">Signatory title</span>
                <Input value={form.design.signatory_title ?? ''} onChange={(e) => set('signatory_title', e.target.value)} placeholder="Director of Sport" />
              </label>
            </div>
          </Card>

          <Card className="p-4 text-xs text-slate-600 dark:text-slate-400">
            <p className="mb-1 font-semibold text-slate-800 dark:text-slate-200">What is fixed</p>
            <p>
              The recipient, the achievement, the serial number and the QR code come from the locked
              result and cannot be edited here. A certificate whose facts can be typed over would not
              be worth verifying.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
