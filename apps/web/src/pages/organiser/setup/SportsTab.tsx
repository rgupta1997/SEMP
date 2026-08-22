import { useEffect, useMemo, useRef, useState } from 'react';
import { Medal } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { useApi, useApiMutation } from '../../../lib/hooks';
import { ENTRY_TYPE, TOURNAMENT_DISCIPLINE_STATUS } from '@semp/shared';
import { usePermissions } from '../../../lib/permissions';
import { eventTemplateFor } from '../../../features/scoring/templates';
import { Badge, Button, Card, confirmDialog, EmptyState, Field, Input, Modal, Select, Spinner, StatusBadge, toast } from '../../../components/ui';
import { StageConfigWizard } from '../../../components/StageConfigWizard';

// Only group/pool-shaped formats have pools to branch out of - a plain Knockout or
// League format has nothing for the stage wizard to configure, so it stays on the
// existing single-stage flow entirely. Mirrors the substring test
// apps/api/.../fixtures/domain/generators/index.ts uses to dispatch to generateGroups.
const isPoolShapedFormat = (name?: string | null) => !!name && (name.trim().toLowerCase().includes('pool') || name.trim().toLowerCase().includes('group'));

// Ranking/event sports (powerlifting, swimming, athletics) have no head-to-head matches,
// so they're locked to the "Rankings" format. `eventTemplateFor` is the same per-sport
// check the scoring console uses to default these sports to the event console.
const isRankingFormat = (name?: string | null) => !!name && name.trim().toLowerCase().includes('rank');
const isRankingSport = (sportName?: string | null) => !!eventTemplateFor(sportName);

/* ----------------------------- Add sports modal ----------------------------- */
// Tap sport tiles to select several at once; choose a fixture format for each,
// then add them all. Super admins can also create a brand-new sport inline.
function AddSportModal({ tournamentId, existingSportIds, onClose }: { tournamentId: string; existingSportIds: Set<string>; onClose: () => void }) {
  const { isSuper } = usePermissions();
  const { data: sports = [], isLoading: sportsLoading } = useApi<any[]>('/sports');
  const { data: formats = [] } = useApi<any[]>('/tournament-formats');
  // sportId -> chosen format id ('' until picked). Presence = selected.
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('');
  const [error, setError] = useState<string | null>(null);

  const available = sports.filter((s) => !existingSportIds.has(s.id));
  // Default new sports to Knockout (organisers can still pick another format below).
  const defaultFormat = (formats.find((f) => f.name === 'Knockout') ?? formats[0])?.id ?? '';
  // Ranking/event sports are forced onto the Rankings format (when it's seeded).
  const rankingFormatId = formats.find((f) => isRankingFormat(f.name))?.id ?? '';
  const sportNameOf = (id: string) => sports.find((s) => s.id === id)?.name;
  const lockedToRanking = (id: string) => !!rankingFormatId && isRankingSport(sportNameOf(id));
  // The format a sport defaults to when tapped: Rankings for event sports, else Knockout.
  const formatFor = (id: string) => (lockedToRanking(id) ? rankingFormatId : defaultFormat);

  const toggle = (id: string) => setSelected((m) => {
    const next = { ...m };
    if (id in next) delete next[id]; else next[id] = formatFor(id);
    return next;
  });
  const setFormat = (id: string, fid: string) => setSelected((m) => ({ ...m, [id]: fid }));
  // Copy-to-all skips ranking sports - they stay on Rankings regardless of the choice.
  const setAllFormats = (fid: string) => setSelected((m) => Object.fromEntries(Object.keys(m).map((id) => [id, lockedToRanking(id) ? rankingFormatId : fid])));
  const selectedIds = Object.keys(selected);

  // The format picker lives below the sport grid (often below the fold). When the
  // first sport is tapped, scroll it into view so organisers don't miss this step.
  const formatSectionRef = useRef<HTMLDivElement>(null);
  const hadSelection = useRef(false);
  useEffect(() => {
    if (selectedIds.length > 0 && !hadSelection.current) {
      formatSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    hadSelection.current = selectedIds.length > 0;
  }, [selectedIds.length]);

  const createSport = useApiMutation((body: any) => api('POST', '/sports', body), ['/sports']);
  // Add every selected sport in parallel, then refetch this season's sports once.
  const addSports = useApiMutation(
    async (entries: { sport_id: string; format_id: string }[]) => {
      await Promise.all(entries.map((e) => api('POST', '/tournament-sports', { tournament_id: tournamentId, sport_id: e.sport_id, format_id: e.format_id })));
    },
    [`/tournament-sports?tournament_id=${tournamentId}`],
    onClose,
  );

  const addNewSport = async () => {
    setError(null);
    if (!newName.trim()) { setError('Sport name required'); return; }
    try {
      const s: any = await createSport.mutateAsync({ name: newName.trim(), icon: newIcon || undefined });
      setSelected((m) => ({ ...m, [s.id]: defaultFormat }));
      setCreatingNew(false); setNewName(''); setNewIcon('');
    } catch (e: any) { setError(e.message ?? 'Could not create sport'); }
  };

  const submit = () => {
    setError(null);
    if (selectedIds.length === 0) { setError('Tap at least one sport'); return; }
    const missing = selectedIds.some((id) => !selected[id]);
    if (missing) { setError('Pick a fixture format for every selected sport'); return; }
    addSports.mutate(selectedIds.map((id) => ({ sport_id: id, format_id: selected[id] })), { onError: (e: any) => setError(e.message) });
  };

  const sportName = (id: string) => sports.find((s) => s.id === id)?.name ?? 'Sport';
  const sportIcon = (id: string) => sports.find((s) => s.id === id)?.icon;

  return (
    <Modal
      title="Add sports"
      onClose={onClose}
      size="4xl"
      footer={(
        <>
          {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500 dark:text-slate-400">{selectedIds.length} selected</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={submit} disabled={selectedIds.length === 0 || addSports.isPending}>{addSports.isPending ? 'Adding…' : `Add ${selectedIds.length || ''} sport${selectedIds.length === 1 ? '' : 's'}`}</Button>
            </div>
          </div>
        </>
      )}
    >
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Tap the sports this season will run, then choose a fixture format for each.</p>

      {sportsLoading ? (
        <div className="grid place-items-center py-8"><Spinner label="Loading sports…" /></div>
      ) : available.length === 0 ? (
        <p className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">Every sport is already in this season.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {available.map((s) => {
            const isSel = s.id in selected;
            return (
              <button key={s.id} type="button" onClick={() => toggle(s.id)}
                className={`relative flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition ${isSel ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/15' : 'border-slate-200 hover:border-brand-300 dark:border-slate-700 dark:hover:border-brand-500/50'}`}>
                <span className="text-2xl">{s.icon || '◇'}</span>
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{s.name}</span>
                {isSel && <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-xs text-white">✓</span>}
              </button>
            );
          })}
        </div>
      )}

      {isSuper && (
        creatingNew ? (
          <div className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">New sport</span>
              <button type="button" onClick={() => setCreatingNew(false)} className="text-sm text-slate-500 hover:underline dark:text-slate-400">cancel</button>
            </div>
            <div className="grid grid-cols-[1fr_80px_auto] gap-2">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Sport name" />
              <Input value={newIcon} onChange={(e) => setNewIcon(e.target.value)} placeholder="Icon" />
              <Button variant="outline" onClick={addNewSport} disabled={createSport.isPending}>{createSport.isPending ? 'Adding…' : 'Create'}</Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setCreatingNew(true)} className="mt-2 text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">+ Create a new sport</button>
        )
      )}

      {selectedIds.length > 0 && (
        <div className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          <span aria-hidden className="animate-bounce">↓</span>
          Next: choose a fixture format for each selected sport below
        </div>
      )}

      {selectedIds.length > 0 && (
        <div ref={formatSectionRef} className="mt-5 space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Fixture format per sport</div>
            {selectedIds.length > 1 && (
              <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                Copy to all
                <Select value="" onChange={(e) => { if (e.target.value) setAllFormats(e.target.value); }} className="w-44">
                  <option value="">- pick a format -</option>
                  {formats.filter((f) => !isRankingFormat(f.name)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Select>
              </label>
            )}
          </div>
          {selectedIds.map((id) => (
            <div key={id} className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{sportIcon(id) ? `${sportIcon(id)} ` : ''}{sportName(id)}</span>
              {lockedToRanking(id) ? (
                <Select value={rankingFormatId} disabled className="w-56" title="Ranking sports have no head-to-head matches">
                  <option value={rankingFormatId}>Rankings</option>
                </Select>
              ) : (
                <Select value={selected[id]} onChange={(e) => setFormat(id, e.target.value)} className="w-56">
                  <option value="">- select a format -</option>
                  {formats.filter((f) => !isRankingFormat(f.name)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Select>
              )}
            </div>
          ))}
        </div>
      )}

    </Modal>
  );
}

/* ----------------------------- Add discipline modal ----------------------------- */
const WHOLE = '__whole__';

// Squad size is a property of the entry type, not a free-form number: an individual
// entry is one competitor, doubles is a pair. `fixed` types can't be edited; team /
// relay keep sensible starting squads the organiser can still adjust.
const SQUAD_BY_ENTRY: Record<string, { min: number; max: number; fixed: boolean }> = {
  individual: { min: 1, max: 1, fixed: true },
  doubles: { min: 2, max: 2, fixed: true },
  relay: { min: 4, max: 4, fixed: false },
  team: { min: 1, max: 15, fixed: false },
};

// Tap discipline tiles to add several at once. Venue + fixture format are chosen
// once and applied to all selected ("copy for all"). Master disciplines keep their
// own entry type + squad; the "Whole sport" tile (always available, so individual
// or single-discipline sports work too) takes its own entry type + squad.
function AddDisciplineModal({ tournamentSport, existing = [], venues, formats, drawsPath, onClose }: { tournamentSport: any; existing?: any[]; venues: any[]; formats: any[]; drawsPath: string; onClose: () => void }) {
  const qc = useQueryClient();
  const disciplinesPath = `/disciplines?sport_id=${tournamentSport.sport_id}`;
  const { data: disciplines = [], isLoading: disciplinesLoading } = useApi<any[]>(disciplinesPath);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [venueId, setVenueId] = useState(venues[0]?.id ?? '');     // default to the first venue when one exists
  const [formatId, setFormatId] = useState('');   // shared - applied to all ('' = inherit sport)
  const [wholeEntry, setWholeEntry] = useState('individual');
  const [wholeMin, setWholeMin] = useState('1');
  const [wholeMax, setWholeMax] = useState('1');
  const wholeSquadFixed = SQUAD_BY_ENTRY[wholeEntry]?.fixed ?? false;
  const onWholeEntryChange = (v: string) => {
    setWholeEntry(v);
    const s = SQUAD_BY_ENTRY[v];
    if (s) { setWholeMin(String(s.min)); setWholeMax(String(s.max)); }
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sportFormatName = formats.find((f) => f.id === tournamentSport.format_id)?.name;

  // Inline "create a new discipline" - this modal is organiser-scoped, so the option
  // is only ever shown to the organiser. The new discipline is added to this sport's
  // catalogue and auto-selected so it can be added in the same action.
  const [creatingDisc, setCreatingDisc] = useState(false);
  const [dName, setDName] = useState('');
  const [dEntry, setDEntry] = useState('team');
  const [dMin, setDMin] = useState('1');
  const [dMax, setDMax] = useState('15');
  const dSquadFixed = SQUAD_BY_ENTRY[dEntry]?.fixed ?? false;
  // Selecting an entry type resets the squad to that type's natural size.
  const onDEntryChange = (v: string) => {
    setDEntry(v);
    const s = SQUAD_BY_ENTRY[v];
    if (s) { setDMin(String(s.min)); setDMax(String(s.max)); }
  };
  const createDiscipline = useApiMutation((body: any) => api('POST', '/disciplines', body), [disciplinesPath]);
  const addNewDiscipline = async () => {
    setError(null);
    if (!dName.trim()) { setError('Discipline name required'); return; }
    const min = Number(dMin), max = Number(dMax);
    if (min > max) { setError('Squad min cannot exceed max'); return; }
    try {
      const d: any = await createDiscipline.mutateAsync({ sport_id: tournamentSport.sport_id, name: dName.trim(), entry_type: dEntry, squad_min: min, squad_max: max });
      await qc.invalidateQueries({ queryKey: [disciplinesPath] });
      setSelected((s) => new Set(s).add(d.id));
      setCreatingDisc(false); setDName(''); setDEntry('team'); setDMin('1'); setDMax('15');
    } catch (e: any) { setError(e.message ?? 'Could not create discipline'); }
  };

  // Disciplines already added to this sport can't be added again (whole-sport = null draw).
  const addedIds = useMemo(() => new Set(existing.map((d) => d.discipline_id ?? WHOLE)), [existing]);
  const labelFor = (id: string) => (id === WHOLE ? 'Whole sport' : (disciplines.find((x) => x.id === id)?.name ?? 'discipline'));

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ids = [...selected];
  const wholeSelected = selected.has(WHOLE);

  const submit = async () => {
    setError(null);
    if (ids.length === 0) { setError('Tap at least one discipline'); return; }
    if (wholeSelected && Number(wholeMin) > Number(wholeMax)) { setError('Whole-sport squad min cannot exceed max'); return; }
    const items = ids.map((id) => {
      const base = { tournament_sport_id: tournamentSport.id, venue_id: venueId || null, format_id: formatId || null };
      const body = id === WHOLE
        ? { ...base, discipline_id: null, entry_type: wholeEntry, squad_min: Number(wholeMin), squad_max: Number(wholeMax) }
        : (() => { const d = disciplines.find((x) => x.id === id); return { ...base, discipline_id: id, entry_type: d?.entry_type ?? 'team', squad_min: d?.squad_min ?? 1, squad_max: d?.squad_max ?? 15 }; })();
      return { id, label: labelFor(id), body };
    });

    setBusy(true);
    const results = await Promise.allSettled(items.map((it) => api('POST', '/tournament-disciplines', it.body)));
    await qc.invalidateQueries({ queryKey: [drawsPath] });
    const dupes: string[] = [];
    const others: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        if ((r.reason as any)?.status === 409) dupes.push(items[i].label);
        else others.push(`${items[i].label} (${(r.reason as any)?.message ?? 'failed'})`);
      }
    });
    setBusy(false);
    if (dupes.length === 0 && others.length === 0) { onClose(); return; }
    // Keep only the failed tiles selected so the user can see/adjust them.
    const failed = new Set(items.filter((_, i) => results[i].status === 'rejected').map((it) => it.id));
    setSelected(failed);
    const parts: string[] = [];
    if (dupes.length) parts.push(`Already added to this sport: ${dupes.join(', ')}.`);
    if (others.length) parts.push(`Couldn't add: ${others.join(', ')}.`);
    setError(parts.join(' '));
  };

  const Tile = ({ id, title, subtitle }: { id: string; title: string; subtitle: string }) => {
    const sel = selected.has(id);
    const added = addedIds.has(id);
    return (
      <button type="button" disabled={added} onClick={() => toggle(id)}
        className={`relative flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition ${added ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60 dark:border-slate-800 dark:bg-slate-800/40' : sel ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/15' : 'border-slate-200 hover:border-brand-300 dark:border-slate-700 dark:hover:border-brand-500/50'}`}>
        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{title}</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">{added ? 'already added' : subtitle}</span>
        {sel && !added && <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-xs text-white">✓</span>}
        {added && <span className="absolute right-1.5 top-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">✓ added</span>}
      </button>
    );
  };

  return (
    <Modal title="Add disciplines" onClose={onClose} wide>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Tap the disciplines to add. Venue &amp; fixture format apply to all selected.</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile id={WHOLE} title="Whole sport" subtitle="no sub-discipline" />
        {!disciplinesLoading && disciplines.map((d) => (
          <Tile key={d.id} id={d.id} title={d.name} subtitle={`${d.entry_type ?? 'team'} · squad ${d.squad_min ?? 1}–${d.squad_max ?? 15}`} />
        ))}
      </div>
      {disciplinesLoading ? (
        <div className="mt-2 grid place-items-center py-4"><Spinner label="Loading disciplines…" /></div>
      ) : disciplines.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">No sub-disciplines defined for this sport - add a whole-sport discipline above, or create one below.</p>
      ) : null}

      {creatingDisc ? (
        <div className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">New discipline</span>
            <button type="button" onClick={() => setCreatingDisc(false)} className="text-sm text-slate-500 hover:underline dark:text-slate-400">cancel</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_130px_80px_80px_auto] sm:items-end">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Name</span>
              <Input value={dName} onChange={(e) => setDName(e.target.value)} placeholder="e.g. U-19, Women's" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Entry</span>
              <Select value={dEntry} onChange={(e) => onDEntryChange(e.target.value)} className="w-full">
                {ENTRY_TYPE.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Min</span>
              <Input type="number" min={1} value={dMin} disabled={dSquadFixed} onChange={(e) => setDMin(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Max</span>
              <Input type="number" min={1} value={dMax} disabled={dSquadFixed} onChange={(e) => setDMax(e.target.value)} />
            </label>
            <Button variant="outline" onClick={addNewDiscipline} disabled={createDiscipline.isPending}>{createDiscipline.isPending ? 'Adding…' : 'Create'}</Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setCreatingDisc(true)} className="mt-2 text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">+ Create a new discipline</button>
      )}

      {ids.length > 0 && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Applied to all selected</div>
          <div className="grid gap-x-3 sm:grid-cols-2">
            <Field label="Venue">
              <Select value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                <option value="">- unassigned -</option>
                {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            </Field>
            <Field label="Fixture format" hint="Override the draw, or inherit the sport's format.">
              <Select value={formatId} onChange={(e) => setFormatId(e.target.value)}>
                <option value="">Same as sport{sportFormatName ? ` (${sportFormatName})` : ''}</option>
                {formats.filter((f) => isRankingFormat(f.name) === isRankingFormat(sportFormatName)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            </Field>
          </div>
          {wholeSelected && (
            <div className="grid grid-cols-3 gap-x-3">
              <Field label="Whole-sport entry">
                <Select value={wholeEntry} onChange={(e) => onWholeEntryChange(e.target.value)}>
                  {ENTRY_TYPE.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="Squad min"><Input type="number" min={1} value={wholeMin} disabled={wholeSquadFixed} onChange={(e) => setWholeMin(e.target.value)} /></Field>
              <Field label="Squad max"><Input type="number" min={1} value={wholeMax} disabled={wholeSquadFixed} onChange={(e) => setWholeMax(e.target.value)} /></Field>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm text-slate-500 dark:text-slate-400">{ids.length} selected</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={ids.length === 0 || busy} onClick={submit}>{busy ? 'Adding…' : `Add ${ids.length || ''} discipline${ids.length === 1 ? '' : 's'}`}</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ----------------------------- Edit / delete discipline modal ----------------------------- */
function EditDisciplineModal({ discipline, sportName, sportFormatId, venues, formats, path, onClose }:
  { discipline: any; sportName: string; sportFormatId?: string | null; venues: any[]; formats: any[]; path: string; onClose: () => void }) {
  const [venueId, setVenueId] = useState(discipline.venue_id ?? '');
  const [entryType, setEntryType] = useState(discipline.entry_type ?? 'team');
  const [squadMin, setSquadMin] = useState(String(discipline.squad_min ?? 1));
  const [squadMax, setSquadMax] = useState(String(discipline.squad_max ?? 15));
  const [formatId, setFormatId] = useState(discipline.format_id ?? ''); // '' = inherit the sport's format
  const [status, setStatus] = useState(discipline.status ?? 'upcoming');
  const [error, setError] = useState<string | null>(null);
  const sportFormatName = formats.find((f) => f.id === sportFormatId)?.name;
  const squadFixed = SQUAD_BY_ENTRY[entryType]?.fixed ?? false;
  const onEntryTypeChange = (v: string) => {
    setEntryType(v);
    const s = SQUAD_BY_ENTRY[v];
    if (s) { setSquadMin(String(s.min)); setSquadMax(String(s.max)); }
  };

  const update = useApiMutation((body: any) => api('PATCH', `/tournament-disciplines/${discipline.id}`, body), [path], onClose);
  const remove = useApiMutation(() => api('DELETE', `/tournament-disciplines/${discipline.id}`), [path], onClose);

  const save = () => {
    setError(null);
    // Match structure + scoring depth are now chosen by the official on the match
    // console, not here - so this no longer writes format_config.scoring (any existing
    // value is left untouched by omitting format_config from the update).
    update.mutate(
      {
        venue_id: venueId || null,
        format_id: formatId || null,
        entry_type: entryType,
        squad_min: Number(squadMin),
        squad_max: Number(squadMax),
        status,
      },
      { onError: (e: any) => setError(e.message) },
    );
  };

  const name = discipline.disciplines?.name ?? sportName;
  return (
    <Modal title={`Edit discipline · ${name}`} onClose={onClose}>
      <Field label="Venue">
        <Select value={venueId} onChange={(e) => setVenueId(e.target.value)}>
          <option value="">- unassigned -</option>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
      </Field>
      <Field label="Fixture format" hint="Changing this affects the next draw - regenerate on the Schedule tab to apply.">
        <Select value={formatId} onChange={(e) => setFormatId(e.target.value)}>
          <option value="">Same as sport{sportFormatName ? ` (${sportFormatName})` : ''}</option>
          {formats.filter((f) => isRankingFormat(f.name) === isRankingFormat(sportFormatName)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-3 gap-x-3">
        <Field label="Entry type">
          <Select value={entryType} onChange={(e) => onEntryTypeChange(e.target.value)}>
            {ENTRY_TYPE.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Squad min"><Input type="number" min={1} value={squadMin} disabled={squadFixed} onChange={(e) => setSquadMin(e.target.value)} /></Field>
        <Field label="Squad max"><Input type="number" min={1} value={squadMax} disabled={squadFixed} onChange={(e) => setSquadMax(e.target.value)} /></Field>
      </div>
      <Field label="Status">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          {TOURNAMENT_DISCIPLINE_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </Field>
      <p className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
        Match structure (single / team tie / event) and scoring depth (live vs final score) are chosen by the official on the match console.
      </p>
      {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="mt-2 flex items-center justify-between">
        <Button variant="ghost" className="text-rose-600 dark:text-rose-400"
          onClick={async () => { if (await confirmDialog({ title: 'Delete discipline', confirmLabel: 'Delete discipline', message: `Delete the “${name}” discipline? Its unplayed fixtures and team entries will be removed. A discipline with completed or scored matches can’t be deleted.` })) remove.mutate(undefined, { onError: (e: any) => setError(e.message) }); }}
          disabled={remove.isPending}>
          {remove.isPending ? 'Deleting…' : 'Delete discipline'}
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={update.isPending} onClick={save}>{update.isPending ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ----------------------------- Edit / remove sport modal ----------------------------- */
function EditSportModal({ ts, sportName, formats, onClose }: { ts: any; sportName: string; formats: any[]; onClose: () => void }) {
  // Ranking/event sports are locked to the Rankings format (no head-to-head matches).
  const rankingFormatId = formats.find((f) => isRankingFormat(f.name))?.id ?? '';
  const lockedToRanking = !!rankingFormatId && isRankingSport(sportName);
  const [formatId, setFormatId] = useState(lockedToRanking ? rankingFormatId : (ts.format_id ?? ''));
  const [error, setError] = useState<string | null>(null);
  const path = `/tournament-sports?tournament_id=${ts.tournament_id}`;

  const update = useApiMutation((body: any) => api('PATCH', `/tournament-sports/${ts.id}`, body), [path], onClose);
  const remove = useApiMutation(() => api('DELETE', `/tournament-sports/${ts.id}`), [path], onClose);

  const save = () => {
    setError(null);
    const fid = lockedToRanking ? rankingFormatId : formatId;
    if (!fid) { setError('Pick a fixture format'); return; }
    update.mutate({ format_id: fid }, { onError: (e: any) => setError(e.message) });
  };

  return (
    <Modal title={`Edit sport · ${sportName}`} onClose={onClose}>
      <Field label="Fixture format" hint="Changing this affects the next draw - regenerate on the Schedule tab to apply. Disciplines with their own format override are unaffected.">
        <Select value={formatId} disabled={lockedToRanking} onChange={(e) => setFormatId(e.target.value)} title={lockedToRanking ? 'Ranking sports have no head-to-head matches' : undefined}>
          {lockedToRanking ? (
            <option value={rankingFormatId}>Rankings</option>
          ) : (
            <>
              <option value="">- select a format -</option>
              {formats.filter((f) => !isRankingFormat(f.name)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </>
          )}
        </Select>
      </Field>
      {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="mt-2 flex items-center justify-between">
        <Button variant="ghost" className="text-rose-600 dark:text-rose-400"
          onClick={async () => { if (await confirmDialog({ title: 'Remove sport', confirmLabel: 'Remove sport', message: `Remove “${sportName}” from this season? Its disciplines, unplayed fixtures and team entries will be removed. A sport with completed or scored matches can’t be removed.` })) remove.mutate(undefined, { onError: (e: any) => setError(e.message) }); }}
          disabled={remove.isPending}>
          {remove.isPending ? 'Removing…' : 'Remove sport'}
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={update.isPending} onClick={save}>{update.isPending ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ----------------------------- Tournament-sport card ----------------------------- */
function SportRow({ ts, sportName, sportIcon, formatName, formats, venues, draws, drawsPath }: { ts: any; sportName: string; sportIcon?: string; formatName: string; formats: any[]; venues: any[]; draws: any[]; drawsPath: string }) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [editingSport, setEditingSport] = useState(false);
  const [configuringStages, setConfiguringStages] = useState<any | null>(null);
  const disciplines = draws; // this sport's draws, sliced from the championship-wide fetch
  // Effective format for a discipline: its own override, else the sport's.
  const effectiveFormat = (d: any) => formats.find((f) => f.id === (d.format_id ?? ts.format_id))?.name;

  // Inline delete (also available inside the edit modals) so organisers can remove
  // a sport or discipline straight from the list without opening it first.
  const removeSport = useApiMutation(() => api('DELETE', `/tournament-sports/${ts.id}`), [`/tournament-sports?tournament_id=${ts.tournament_id}`, drawsPath]);
  const removeDiscipline = useApiMutation((id: string) => api('DELETE', `/tournament-disciplines/${id}`), [drawsPath]);
  const confirmRemoveSport = async () => { if (await confirmDialog({ title: 'Remove sport', confirmLabel: 'Remove sport', message: `Remove “${sportName}” from this season? Its disciplines, unplayed fixtures and team entries will be removed. A sport with completed or scored matches can’t be removed.` })) removeSport.mutate(undefined, { onError: (e: any) => toast.error(e.message) }); };
  const confirmRemoveDiscipline = async (d: any) => { const name = d.disciplines?.name ?? sportName; if (await confirmDialog({ title: 'Delete discipline', confirmLabel: 'Delete discipline', message: `Delete the “${name}” discipline? Its unplayed fixtures and team entries will be removed. A discipline with completed or scored matches can’t be deleted.` })) removeDiscipline.mutate(d.id, { onError: (e: any) => toast.error(e.message) }); };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 dark:bg-brand-500/10 text-lg">{sportIcon || '◇'}</span>
          <div>
            <div className="font-semibold text-slate-900 dark:text-slate-100">{sportName}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{formatName} · {disciplines.length} discipline{disciplines.length === 1 ? '' : 's'}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="subtle" onClick={() => setEditingSport(true)}>Edit sport</Button>
          <Button size="md" variant="ghost" className="text-rose-600 hover:bg-rose-50 dark:text-white dark:hover:bg-rose-500/20" disabled={removeSport.isPending} onClick={confirmRemoveSport}>{removeSport.isPending ? 'Removing…' : 'Remove'}</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Manage'} disciplines</Button>
        </div>
      </div>

      {open && (
        <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Disciplines</span>
            <Button size="sm" variant="subtle" onClick={() => setAdding(true)}>+ Add discipline</Button>
          </div>
          {disciplines.length === 0 ? (
            <p className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-3 text-sm text-slate-400 dark:text-slate-500">No disciplines yet. Add one for a whole-sport discipline or per sub-discipline.</p>
          ) : (
            <div className="space-y-2">
              {disciplines.map((d) => {
                const venue = venues.find((v) => v.id === d.venue_id);
                return (
                  <div key={d.id} className="group flex w-full items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5 transition hover:bg-slate-100 dark:hover:bg-slate-800">
                    <button type="button" onClick={() => setEditing(d)} className="flex flex-1 items-center justify-between gap-2 text-left">
                      <div className="text-sm">
                        <span className="font-medium text-slate-800 dark:text-slate-200">{d.disciplines?.name ?? sportName}</span>
                        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{d.squad_min}-{d.squad_max} · {venue?.name ?? 'no venue'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {d.entry_type && <Badge tone="info">{d.entry_type}</Badge>}
                        {effectiveFormat(d) && (
                          <Badge tone={d.format_id ? 'violet' : 'slate'}>{effectiveFormat(d)}</Badge>
                        )}
                        <StatusBadge status={d.status} />
                        <span className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-700 transition group-hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300 dark:group-hover:bg-brand-500/25">✎ Edit</span>
                      </div>
                    </button>
                    {isPoolShapedFormat(effectiveFormat(d)) && (
                      <Button size="sm" variant="ghost" className="ml-2 shrink-0" onClick={() => setConfiguringStages(d)}>Configure stages</Button>
                    )}
                    <button type="button" title="Delete discipline" disabled={removeDiscipline.isPending} onClick={() => confirmRemoveDiscipline(d)}
                      className="ml-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base text-rose-600 transition hover:bg-rose-50 dark:text-white dark:hover:bg-rose-500/20">🗑</button>
                  </div>
                );
              })}
            </div>
          )}
          {adding && <AddDisciplineModal tournamentSport={ts} existing={disciplines} venues={venues} formats={formats} drawsPath={drawsPath} onClose={() => setAdding(false)} />}
          {editing && <EditDisciplineModal discipline={editing} sportName={sportName} sportFormatId={ts.format_id} venues={venues} formats={formats} path={drawsPath} onClose={() => setEditing(null)} />}
          {configuringStages && (
            <Modal title="Configure stages" onClose={() => setConfiguringStages(null)} wide>
              <StageConfigWizard tournamentDisciplineId={configuringStages.id} onGenerated={() => setConfiguringStages(null)} />
            </Modal>
          )}
        </div>
      )}
      {editingSport && <EditSportModal ts={ts} sportName={sportName} formats={formats} onClose={() => setEditingSport(false)} />}
    </Card>
  );
}

/* ----------------------------- Tab ----------------------------- */
export function SportsTab({ eventId }: { eventId: string }) {
  const { data: tournaments = [] } = useApi<any[]>(`/tournaments?championship_id=${eventId}`);
  const [tournamentId, setTournamentId] = useState('');
  const activeTournament = tournamentId || tournaments[0]?.id || '';

  const { data: tsports = [] } = useApi<any[]>(activeTournament ? `/tournament-sports?tournament_id=${activeTournament}` : null);
  const { data: sports = [] } = useApi<any[]>('/sports');
  const { data: formats = [] } = useApi<any[]>('/tournament-formats');
  const { data: venues = [] } = useApi<any[]>(`/venues?championship_id=${eventId}`);
  // All discipline draws for the championship in ONE request (instead of one query
  // per sport row); each SportRow gets the slice for its own tournament_sport.
  const drawsPath = `/championships/${eventId}/draws`;
  const { data: allDraws = [] } = useApi<any[]>(drawsPath);
  const [adding, setAdding] = useState(false);

  if (tournaments.length === 0) {
    return <EmptyState icon="⊟" title="Add a season first" description="Create a season in the Seasons tab, then configure its sports here." />;
  }

  const sportName = (id: string) => sports.find((s) => s.id === id)?.name ?? 'Sport';
  const sportIcon = (id: string) => sports.find((s) => s.id === id)?.icon;
  const formatName = (id: string) => formats.find((f) => f.id === id)?.name ?? 'Format';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-slate-600 dark:text-slate-300">Season</span>
          <Select value={activeTournament} onChange={(e) => setTournamentId(e.target.value)} className="w-56">
            {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </label>
        <Button onClick={() => setAdding(true)}>+ Add sport</Button>
      </div>

      {tsports.length === 0 ? (
        <EmptyState icon={<Medal size={24} />} title="No sports yet" description="Add the sports this tournament will run - each gets its own fixture format."
          action={<Button onClick={() => setAdding(true)}>+ Add sport</Button>} />
      ) : (
        <div className="grid gap-3">
          {tsports.map((ts) => (
            <SportRow key={ts.id} ts={ts} sportName={sportName(ts.sport_id)} sportIcon={sportIcon(ts.sport_id)} formatName={formatName(ts.format_id)} formats={formats} venues={venues}
              draws={allDraws.filter((d) => d.tournament_sport_id === ts.id)} drawsPath={drawsPath} />
          ))}
        </div>
      )}

      {adding && <AddSportModal tournamentId={activeTournament} existingSportIds={new Set(tsports.map((t) => t.sport_id))} onClose={() => setAdding(false)} />}
      {venues.length === 0 && <Badge tone="amber" className="mt-4">Tip: add venues in the Venues tab to assign disciplines to grounds.</Badge>}
    </div>
  );
}
