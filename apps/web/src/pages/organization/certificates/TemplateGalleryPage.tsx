import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BadgeCheck, Check, Plus } from 'lucide-react';
import { useApi, useApiMutation } from '../../../lib/hooks';
import { api } from '../../../lib/api';
import {
  BackButton, Button, Card, PageHeader, SearchInput, Select, Skeleton, cn, toast,
} from '../../../components/ui';
import { SheetPreview, type Preset, type Template } from './shared';

// The Template Gallery.
//
// Every tile is a live render of the design at print geometry, not a screenshot -
// so a template cannot look one way here and another way on the page somebody signs.

const CARD_W = 300;

export function TemplateGalleryPage() {
  const { orgId } = useParams();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');

  const templatesPath = orgId ? `/organizations/${orgId}/certificate-templates` : null;
  const templates = useApi<{ rows: Template[] }>(templatesPath);
  const presets = useApi<{ rows: Preset[] }>(orgId ? `/organizations/${orgId}/certificate-presets` : null);

  const adopt = useApiMutation(
    (body: { preset_id: string }) => api('POST', `${templatesPath}/from-preset`, body),
    [templatesPath],
  );

  const categories = useMemo(
    () => [...new Set((presets.data?.rows ?? []).map((p) => p.category))].sort(),
    [presets.data],
  );

  const catOf = (t: Template) => (presets.data?.rows ?? []).find((p) => p.id === t.design?.layout)?.category ?? 'Custom';
  const matches = (name: string, cat: string) =>
    (!q || name.toLowerCase().includes(q.toLowerCase())) && (!category || cat === category);

  const mine = (templates.data?.rows ?? []).filter((t) => matches(t.name, catOf(t)));
  const available = (presets.data?.rows ?? []).filter((p) => !p.in_use && matches(p.name, p.category));

  const onAdopt = async (p: Preset) => {
    try {
      const row = await adopt.mutateAsync({ preset_id: p.id }) as Template;
      toast.success(`${p.name} added`, 'Edit the wording and colour from its preview.');
      nav(`/organizations/${orgId}/certificates/templates/${row.id}`);
    } catch (e: any) { toast.error('Could not add the design', e?.message); }
  };

  return (
    <div className="grid gap-5">
      <BackButton to={`/organizations/${orgId}/certificates`}>Back to Certificates</BackButton>
      <PageHeader title="Certificate templates" subtitle="What a certificate says and how it looks. Every tile below is the real render.">
        <Button onClick={() => document.getElementById('designs')?.scrollIntoView({ behavior: 'smooth' })}>
          <Plus size={15} aria-hidden />New template
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search templates…" className="w-60" />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category" className="w-44">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Your templates</h2>
        {templates.isLoading ? <Skeleton className="h-64" /> : mine.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {q || category ? 'No template matches that.' : 'None yet — start from one of the designs below.'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {mine.map((t) => (
              <Link
                key={t.id} to={`/organizations/${orgId}/certificates/templates/${t.id}`}
                className="group grid gap-2 rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:border-brand-400 dark:border-slate-800 dark:bg-slate-900"
                style={{ width: CARD_W + 24 }}
              >
                <SheetPreview path={`/certificate-templates/${t.id}/preview?bare=1`} width={CARD_W} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">{t.name}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {catOf(t)} · Used {t.used_count} {t.used_count === 1 ? 'time' : 'times'}
                    </p>
                  </div>
                  {t.is_default && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                      <BadgeCheck size={11} aria-hidden />default
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section id="designs" className="grid gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Start from a design</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Copied into your own templates, so editing one later never changes a certificate you have already issued.
          </p>
        </div>
        {presets.isLoading ? <Skeleton className="h-64" /> : (
          <div className="flex flex-wrap gap-4">
            {available.map((p) => (
              <Card key={p.id} className={cn('grid gap-2 p-3')} style={{ width: CARD_W + 24 }}>
                <SheetPreview path={`/organizations/${orgId}/certificate-presets/${p.id}/preview?bare=1`} width={CARD_W} />
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{p.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{p.category}</p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{p.blurb}</p>
                </div>
                <Button onClick={() => onAdopt(p)} disabled={adopt.isPending} className="w-full justify-center">
                  <Plus size={14} aria-hidden />Use this design
                </Button>
              </Card>
            ))}
            {available.length === 0 && (
              <p className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
                <Check size={15} aria-hidden />You are already using every design that matches.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
