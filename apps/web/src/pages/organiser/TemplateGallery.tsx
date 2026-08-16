import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { ChampionshipTemplate } from '@semp/shared';
import { Card, Checkbox, SearchInput, Spinner, cn } from '../../components/ui';

// Choosing what to start a championship from.
//
// A gallery rather than a list: the thing an organiser is picking is a *structure*, and
// a structure is easier to recognise than to read. Each card carries a diagram of the
// format, the sports it will set up by name, and what it adds up to - so "6 sports" is
// never the whole story, which was the complaint that started this.
//
// Nothing here is hardcoded. The built-ins arrive from the API as is_system rows
// alongside anything this organiser has saved from their own events.

const FROM_SCRATCH = '__scratch__';

export interface TemplateGalleryProps {
  templates: ChampionshipTemplate[];
  loading?: boolean;
  value: string | null;
  onChange: (templateId: string | null) => void;
  onDelete?: (t: ChampionshipTemplate) => void;
}

export function TemplateGallery({ templates, loading, value, onChange, onDelete }: TemplateGalleryProps) {
  const [q, setQ] = useState('');
  const [sports, setSports] = useState<string[]>([]);
  const [formats, setFormats] = useState<string[]>([]);

  // The filter rail is built from what is actually in the library, so it never offers
  // a sport nobody has a template for.
  const allSports = useMemo(
    () => [...new Set(templates.flatMap((t) => t.shape?.draws?.map((d) => d.sport) ?? []))].sort(),
    [templates],
  );
  const allFormats = useMemo(
    () => [...new Set(templates.flatMap((t) => t.summary?.formats ?? []))].sort(),
    [templates],
  );

  const shown = useMemo(() => templates.filter((t) => {
    const drawSports = t.shape?.draws?.map((d) => d.sport) ?? [];
    if (sports.length && !sports.some((s) => drawSports.includes(s))) return false;
    if (formats.length && !formats.some((f) => (t.summary?.formats ?? []).includes(f))) return false;
    if (q.trim()) {
      const hay = `${t.name} ${t.description ?? ''} ${drawSports.join(' ')}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  }), [templates, sports, formats, q]);

  const toggle = (list: string[], set: (v: string[]) => void, item: string) =>
    set(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const mine = shown.filter((t) => !t.is_system);
  const builtIn = shown.filter((t) => t.is_system);

  return (
    <div className="grid gap-5 lg:grid-cols-[200px_1fr]">
      <aside className="h-fit space-y-5 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
        <SearchInput value={q} onChange={setQ} placeholder="Search templates…" />
        <FilterGroup label="Sport" options={allSports} selected={sports} onToggle={(s) => toggle(sports, setSports, s)} />
        <FilterGroup label="Format" options={allFormats} selected={formats} onToggle={(f) => toggle(formats, setFormats, f)} />
        {(sports.length > 0 || formats.length > 0 || q) && (
          <button type="button" onClick={() => { setSports([]); setFormats([]); setQ(''); }}
            className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
            Clear filters
          </button>
        )}
      </aside>

      <div>
        {loading ? <Card className="p-10"><Spinner label="Loading templates" /></Card> : (
          <div className="space-y-6">
            {mine.length > 0 && (
              <Section title="Saved by you" hint="Captured from championships you have already run.">
                {mine.map((t) => (
                  <TemplateCard key={t.id} t={t} selected={value === t.id} onSelect={() => onChange(t.id)}
                    onDelete={onDelete ? () => onDelete(t) : undefined} />
                ))}
              </Section>
            )}
            <Section title={mine.length ? 'Standard structures' : 'Choose a structure'}
              hint="Common shapes you can adapt. Everything a template sets can be changed afterwards.">
              {builtIn.map((t) => (
                <TemplateCard key={t.id} t={t} selected={value === t.id} onSelect={() => onChange(t.id)} />
              ))}
              <ScratchCard selected={value === null} onSelect={() => onChange(null)} />
            </Section>
            {shown.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                No template matches those filters. Start from scratch instead - you can save the result as a
                template when you are done.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const Section = ({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) => (
  <section>
    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h4>
    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    <div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
  </section>
);

function FilterGroup({ label, options, selected, onToggle }: {
  label: string; options: string[]; selected: string[]; onToggle: (v: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div>
      <h5 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</h5>
      <ul className="space-y-1.5">
        {options.map((o) => (
          <li key={o}>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <Checkbox checked={selected.includes(o)} onChange={() => onToggle(o)} />
              <span className="truncate">{o}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The card. Hovering (or focusing) reveals the full contents - every sport with its
// disciplines - because the summary on the face of the card is deliberately short.
function TemplateCard({ t, selected, onSelect, onDelete }: {
  t: ChampionshipTemplate; selected: boolean; onSelect: () => void; onDelete?: () => void;
}) {
  const draws = t.shape?.draws ?? [];
  const chips = [...new Set([...(t.summary?.formats ?? [])])];

  return (
    <div className="group relative">
      <button type="button" onClick={onSelect} aria-pressed={selected}
        className={cn(
          'flex h-full w-full flex-col rounded-xl border p-3 text-left transition',
          selected
            ? 'border-brand-500 ring-2 ring-brand-500/60 dark:border-brand-400'
            : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
        )}>
        <StructureDiagram formats={t.summary?.formats ?? []} sports={draws.length} />

        <div className="mt-3 flex flex-wrap gap-1.5">
          {draws.length === 1
            ? <Chip>{draws[0].sport}</Chip>
            : <Chip>{draws.length} sports</Chip>}
          {chips.map((c) => <Chip key={c}>{c}</Chip>)}
          {!t.is_system && <Chip tone="brand">{t.organization ? t.organization.name : 'Yours'}</Chip>}
        </div>

        <h5 className="mt-2 font-bold text-slate-900 dark:text-slate-100">{t.name}</h5>
        {t.description && (
          <p className="mt-1 line-clamp-3 text-sm text-slate-500 dark:text-slate-400">{t.description}</p>
        )}

        <dl className="mt-auto grid grid-cols-2 gap-2 border-t border-slate-200 pt-3 text-left dark:border-slate-800"
          style={{ marginTop: 'auto', paddingTop: '0.75rem' }}>
          <Stat label="Sports" value={t.summary?.sports ?? draws.length} />
          <Stat label="Draws" value={t.summary?.draws ?? draws.length} />
        </dl>
      </button>

      {onDelete && (
        <button type="button" onClick={onDelete} title="Delete this template"
          className="absolute right-2 top-2 rounded-lg bg-white/90 p-1.5 text-slate-400 opacity-0 transition hover:text-rose-600 focus:opacity-100 group-hover:opacity-100 dark:bg-slate-900/90">
          <Trash2 size={14} />
        </button>
      )}

      {/* The hover preview: what is actually inside, named. */}
      {draws.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-full z-30 hidden w-72 -translate-x-1/2 translate-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl group-hover:block group-focus-within:block dark:border-slate-700 dark:bg-slate-900">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">What this sets up</p>
          <ul className="space-y-1.5">
            {draws.map((d) => (
              <li key={d.sport} className="text-sm">
                <span className="font-medium text-slate-800 dark:text-slate-200">{d.sport}</span>
                {d.format && <span className="text-slate-400"> · {d.format}</span>}
                {d.disciplines.length > 0 && (
                  <div className="text-xs text-slate-500 dark:text-slate-400">{d.disciplines.join(', ')}</div>
                )}
              </li>
            ))}
          </ul>
          {t.shape?.scheme && (
            <p className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              Scored as {SCHEME_LABELS[t.shape.scheme] ?? t.shape.scheme}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const SCHEME_LABELS: Record<string, string> = {
  league_points: 'a league table',
  placement: 'placement points',
  medal: 'a medal tally',
};

function ScratchCard({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected}
      className={cn(
        'flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center transition',
        selected
          ? 'border-brand-500 ring-2 ring-brand-500/60 dark:border-brand-400'
          : 'border-slate-300 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-600',
      )}>
      <span className="rounded-xl border border-slate-200 p-3 text-slate-400 dark:border-slate-700">
        <Plus size={20} />
      </span>
      <h5 className="mt-3 font-bold text-slate-900 dark:text-slate-100">Start from scratch</h5>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Add sports and disciplines yourself. You can save the result as a template afterwards.
      </p>
    </button>
  );
}

const Chip = ({ children, tone }: { children: React.ReactNode; tone?: 'brand' }) => (
  <span className={cn(
    'rounded px-1.5 py-0.5 text-[11px] font-medium',
    tone === 'brand'
      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  )}>{children}</span>
);

const Stat = ({ label, value }: { label: string; value: number }) => (
  <div>
    <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
    <dd className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-200">{value}</dd>
  </div>
);

// A small drawing of the structure. Not decoration: a bracket and a round-robin grid
// are recognisable at a glance in a way the words "Knockout" and "Round Robin" are not,
// which is the entire reason this step is a gallery.
function StructureDiagram({ formats, sports }: { formats: string[]; sports: number }) {
  const kind = diagramKind(formats, sports);
  const stroke = 'stroke-slate-400 dark:stroke-slate-500';
  const fill = 'fill-none';

  return (
    <div className="flex h-28 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60">
      <svg viewBox="0 0 160 80" className="h-full w-full p-3" role="img" aria-label={`${kind} structure`}>
        {kind === 'bracket' && (
          <g className={cn(stroke, fill)} strokeWidth="1.5">
            {[8, 26, 46, 64].map((y) => <rect key={y} x="8" y={y} width="14" height="10" rx="2" />)}
            <path d="M22 13h12v18h12M22 51h12v18h12M22 31h12M22 69h12" />
            {[26, 56].map((y) => <rect key={y} x="46" y={y - 5} width="14" height="10" rx="2" />)}
            <path d="M60 31h14v15h12M60 61h14V46h12" />
            <rect x="86" y="41" width="16" height="10" rx="2" />
            <path d="M102 46h14" />
            <rect x="116" y="39" width="18" height="14" rx="2" className="fill-brand-500/20 stroke-brand-500" />
          </g>
        )}
        {kind === 'grid' && (
          <g className={stroke} strokeWidth="1.2">
            {Array.from({ length: 6 }, (_, i) => <line key={`v${i}`} x1={20 + i * 20} y1="8" x2={20 + i * 20} y2="72" />)}
            {Array.from({ length: 5 }, (_, i) => <line key={`h${i}`} x1="20" y1={8 + i * 16} x2="120" y2={8 + i * 16} />)}
            {[[0, 1], [2, 2], [3, 0], [1, 3]].map(([c, r]) => (
              <rect key={`${c}-${r}`} x={20 + c * 20} y={8 + r * 16} width="20" height="16"
                className="fill-brand-500/20 stroke-none" />
            ))}
          </g>
        )}
        {kind === 'mosaic' && (
          <g className={stroke} strokeWidth="1.2">
            {Array.from({ length: Math.min(sports, 6) }, (_, i) => (
              <g key={i} transform={`translate(${8 + (i % 3) * 50},${8 + Math.floor(i / 3) * 36})`}>
                <rect width="44" height="28" rx="3" className={i === 0 ? 'fill-brand-500/20 stroke-brand-500' : 'fill-none'} />
                <line x1="8" y1="10" x2="36" y2="10" />
                <line x1="8" y1="18" x2="26" y2="18" />
              </g>
            ))}
          </g>
        )}
        {kind === 'ranks' && (
          <g className={stroke} strokeWidth="1.2">
            {[52, 40, 28, 20, 14].map((w, i) => (
              <rect key={i} x="16" y={8 + i * 14} width={w + 40} height="9" rx="2"
                className={i === 0 ? 'fill-brand-500/20 stroke-brand-500' : 'fill-none'} />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}

function diagramKind(formats: string[], sports: number): 'bracket' | 'grid' | 'mosaic' | 'ranks' {
  const f = formats.map((x) => x.toLowerCase());
  if (sports > 1) return 'mosaic';
  if (f.some((x) => x.includes('rank'))) return 'ranks';
  if (f.some((x) => x.includes('robin') || x.includes('league'))) return 'grid';
  return 'bracket';
}

export { FROM_SCRATCH };
