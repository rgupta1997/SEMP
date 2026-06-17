import { useState } from 'react';
import { api } from '../../../lib/api';
import { useApi, useApiMutation } from '../../../lib/hooks';
import { ENTRY_TYPE, TOURNAMENT_DISCIPLINE_STATUS } from '@semp/shared';
import { usePermissions } from '../../../lib/permissions';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, StatusBadge } from '../../../components/ui';

/* ----------------------------- Add sport modal ----------------------------- */
function AddSportModal({ tournamentId, onClose }: { tournamentId: string; onClose: () => void }) {
  const { isSuper } = usePermissions();
  const { data: sports = [] } = useApi<any[]>('/sports');
  const { data: formats = [] } = useApi<any[]>('/tournament-formats');
  const [sportId, setSportId] = useState('');
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('');
  const [formatId, setFormatId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createSport = useApiMutation((body: any) => api('POST', '/sports', body), ['/sports']);
  const addToTournament = useApiMutation(
    (body: any) => api('POST', '/tournament-sports', body),
    [`/tournament-sports?tournament_id=${tournamentId}`],
    onClose,
  );

  const submit = async () => {
    setError(null);
    if (!formatId) { setError('Pick a fixture format'); return; }
    try {
      let sid = sportId;
      if (creatingNew) {
        if (!newName) { setError('Sport name required'); return; }
        const s: any = await createSport.mutateAsync({ name: newName, icon: newIcon || undefined });
        sid = s.id;
      }
      if (!sid) { setError('Pick a sport'); return; }
      await addToTournament.mutateAsync({ tournament_id: tournamentId, sport_id: sid, format_id: formatId });
    } catch (e: any) { setError(e.message ?? 'Could not add sport'); }
  };

  return (
    <Modal title="Add a sport" onClose={onClose}>
      {!creatingNew ? (
        <Field label="Sport">
          <Select value={sportId} onChange={(e) => setSportId(e.target.value)}>
            <option value="">— select a sport —</option>
            {sports.map((s) => <option key={s.id} value={s.id}>{s.icon ? `${s.icon} ` : ''}{s.name}</option>)}
          </Select>
          {isSuper && (
            <button type="button" onClick={() => setCreatingNew(true)} className="mt-2 text-sm font-medium text-brand-600 dark:text-brand-300 hover:underline">+ Create a new sport</button>
          )}
        </Field>
      ) : (
        <div className="mb-4 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">New sport</span>
            <button type="button" onClick={() => setCreatingNew(false)} className="text-sm text-slate-500 dark:text-slate-400 hover:underline">use existing</button>
          </div>
          <div className="grid grid-cols-[1fr_80px] gap-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Sport name" />
            <Input value={newIcon} onChange={(e) => setNewIcon(e.target.value)} placeholder="🏀" />
          </div>
        </div>
      )}
      <Field label="Fixture format" hint="How matches are drawn for this sport.">
        <Select value={formatId} onChange={(e) => setFormatId(e.target.value)}>
          <option value="">— select a format —</option>
          {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
      </Field>
      {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={addToTournament.isPending || createSport.isPending}>Add sport</Button>
      </div>
    </Modal>
  );
}

/* ----------------------------- Add discipline modal ----------------------------- */
function AddDisciplineModal({ tournamentSport, venues, formats, onClose }: { tournamentSport: any; venues: any[]; formats: any[]; onClose: () => void }) {
  const disciplinesPath = `/disciplines?sport_id=${tournamentSport.sport_id}`;
  const { data: disciplines = [] } = useApi<any[]>(disciplinesPath);
  const [disciplineId, setDisciplineId] = useState('');
  const [venueId, setVenueId] = useState('');
  const [entryType, setEntryType] = useState('team');
  const [squadMin, setSquadMin] = useState('1');
  const [squadMax, setSquadMax] = useState('15');
  const [formatId, setFormatId] = useState(''); // '' = inherit the sport's format
  const [error, setError] = useState<string | null>(null);
  const sportFormatName = formats.find((f) => f.id === tournamentSport.format_id)?.name;

  const add = useApiMutation(
    (body: any) => api('POST', '/tournament-disciplines', body),
    [`/tournament-disciplines?tournament_sport_id=${tournamentSport.id}`],
    onClose,
  );

  // Pre-fill entry rules from the selected master discipline so the discipline inherits
  // its defaults (organiser can still override below).
  const pickDiscipline = (id: string) => {
    setDisciplineId(id);
    const d = disciplines.find((x) => x.id === id);
    if (d) {
      setEntryType(d.entry_type ?? 'team');
      setSquadMin(String(d.squad_min ?? 1));
      setSquadMax(String(d.squad_max ?? 15));
    }
  };

  const submit = async () => {
    setError(null);
    try {
      await add.mutateAsync({
        tournament_sport_id: tournamentSport.id,
        discipline_id: disciplineId || null,
        venue_id: venueId || null,
        format_id: formatId || null,
        entry_type: entryType,
        squad_min: Number(squadMin), squad_max: Number(squadMax),
      });
    } catch (e: any) { setError(e.message ?? 'Could not add discipline'); }
  };

  return (
    <Modal title="Add discipline" onClose={onClose}>
      <Field label="Discipline" hint="Pick from platform master data, or leave blank for a whole-sport discipline (e.g. Cricket).">
        <Select value={disciplineId} onChange={(e) => pickDiscipline(e.target.value)}>
          <option value="">— whole sport (no sub-discipline) —</option>
          {disciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      </Field>
      <Field label="Venue">
        <Select value={venueId} onChange={(e) => setVenueId(e.target.value)}>
          <option value="">— unassigned —</option>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
      </Field>
      <Field label="Fixture format" hint="Override how this discipline's matches are drawn, or inherit the sport's format.">
        <Select value={formatId} onChange={(e) => setFormatId(e.target.value)}>
          <option value="">Same as sport{sportFormatName ? ` (${sportFormatName})` : ''}</option>
          {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-3 gap-x-3">
        <Field label="Entry type">
          <Select value={entryType} onChange={(e) => setEntryType(e.target.value)}>
            {ENTRY_TYPE.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Squad min"><Input type="number" value={squadMin} onChange={(e) => setSquadMin(e.target.value)} /></Field>
        <Field label="Squad max"><Input type="number" value={squadMax} onChange={(e) => setSquadMax(e.target.value)} /></Field>
      </div>
      {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={add.isPending} onClick={submit}>Add discipline</Button>
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

  const update = useApiMutation((body: any) => api('PATCH', `/tournament-disciplines/${discipline.id}`, body), [path], onClose);
  const remove = useApiMutation(() => api('DELETE', `/tournament-disciplines/${discipline.id}`), [path], onClose);

  const save = () => {
    setError(null);
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
          <option value="">— unassigned —</option>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
      </Field>
      <Field label="Fixture format" hint="Changing this affects the next draw — regenerate on the Schedule tab to apply.">
        <Select value={formatId} onChange={(e) => setFormatId(e.target.value)}>
          <option value="">Same as sport{sportFormatName ? ` (${sportFormatName})` : ''}</option>
          {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-3 gap-x-3">
        <Field label="Entry type">
          <Select value={entryType} onChange={(e) => setEntryType(e.target.value)}>
            {ENTRY_TYPE.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Squad min"><Input type="number" value={squadMin} onChange={(e) => setSquadMin(e.target.value)} /></Field>
        <Field label="Squad max"><Input type="number" value={squadMax} onChange={(e) => setSquadMax(e.target.value)} /></Field>
      </div>
      <Field label="Status">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          {TOURNAMENT_DISCIPLINE_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </Field>
      {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="mt-2 flex items-center justify-between">
        <Button variant="ghost" className="text-rose-600 dark:text-rose-400"
          onClick={() => { if (confirm(`Delete the “${name}” discipline? Its fixtures and team entries will be removed. This cannot be undone.`)) remove.mutate(undefined, { onError: (e: any) => setError(e.message) }); }}
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
  const [formatId, setFormatId] = useState(ts.format_id ?? '');
  const [error, setError] = useState<string | null>(null);
  const path = `/tournament-sports?tournament_id=${ts.tournament_id}`;

  const update = useApiMutation((body: any) => api('PATCH', `/tournament-sports/${ts.id}`, body), [path], onClose);
  const remove = useApiMutation(() => api('DELETE', `/tournament-sports/${ts.id}`), [path], onClose);

  const save = () => {
    setError(null);
    if (!formatId) { setError('Pick a fixture format'); return; }
    update.mutate({ format_id: formatId }, { onError: (e: any) => setError(e.message) });
  };

  return (
    <Modal title={`Edit sport · ${sportName}`} onClose={onClose}>
      <Field label="Fixture format" hint="Changing this affects the next draw — regenerate on the Schedule tab to apply. Disciplines with their own format override are unaffected.">
        <Select value={formatId} onChange={(e) => setFormatId(e.target.value)}>
          <option value="">— select a format —</option>
          {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
      </Field>
      {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="mt-2 flex items-center justify-between">
        <Button variant="ghost" className="text-rose-600 dark:text-rose-400"
          onClick={() => { if (confirm(`Remove “${sportName}” from this tournament? Its disciplines, fixtures and team entries will be removed. This cannot be undone.`)) remove.mutate(undefined, { onError: (e: any) => setError(e.message) }); }}
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
function SportRow({ ts, sportName, sportIcon, formatName, formats, venues }: { ts: any; sportName: string; sportIcon?: string; formatName: string; formats: any[]; venues: any[] }) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [editingSport, setEditingSport] = useState(false);
  const disciplinesPath = `/tournament-disciplines?tournament_sport_id=${ts.id}`;
  const { data: disciplines = [] } = useApi<any[]>(disciplinesPath);
  // Effective format for a discipline: its own override, else the sport's.
  const effectiveFormat = (d: any) => formats.find((f) => f.id === (d.format_id ?? ts.format_id))?.name;

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
                  <button key={d.id} type="button" onClick={() => setEditing(d)}
                    className="group flex w-full items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800">
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
                );
              })}
            </div>
          )}
          {adding && <AddDisciplineModal tournamentSport={ts} venues={venues} formats={formats} onClose={() => setAdding(false)} />}
          {editing && <EditDisciplineModal discipline={editing} sportName={sportName} sportFormatId={ts.format_id} venues={venues} formats={formats} path={disciplinesPath} onClose={() => setEditing(null)} />}
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
  const [adding, setAdding] = useState(false);

  if (tournaments.length === 0) {
    return <EmptyState icon="⊟" title="Add a tournament first" description="Create a tournament in the Tournaments tab, then configure its sports here." />;
  }

  const sportName = (id: string) => sports.find((s) => s.id === id)?.name ?? 'Sport';
  const sportIcon = (id: string) => sports.find((s) => s.id === id)?.icon;
  const formatName = (id: string) => formats.find((f) => f.id === id)?.name ?? 'Format';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-slate-600 dark:text-slate-300">Tournament</span>
          <Select value={activeTournament} onChange={(e) => setTournamentId(e.target.value)} className="w-56">
            {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </label>
        <Button onClick={() => setAdding(true)}>+ Add sport</Button>
      </div>

      {tsports.length === 0 ? (
        <EmptyState icon="🏅" title="No sports yet" description="Add the sports this tournament will run — each gets its own fixture format."
          action={<Button onClick={() => setAdding(true)}>+ Add sport</Button>} />
      ) : (
        <div className="grid gap-3">
          {tsports.map((ts) => (
            <SportRow key={ts.id} ts={ts} sportName={sportName(ts.sport_id)} sportIcon={sportIcon(ts.sport_id)} formatName={formatName(ts.format_id)} formats={formats} venues={venues} />
          ))}
        </div>
      )}

      {adding && <AddSportModal tournamentId={activeTournament} onClose={() => setAdding(false)} />}
      {venues.length === 0 && <Badge tone="amber" className="mt-4">Tip: add venues in the Venues tab to assign disciplines to grounds.</Badge>}
    </div>
  );
}
