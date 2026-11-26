import { useState } from 'react';
import { CalendarRange, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { PillButton } from '../../../features/schedule/ScheduleParts';
import { api } from '../../../lib/api';
import { useApi, useApiMutation } from '../../../lib/hooks';
import { Button, Card, confirmDialog, EmptyState, Field, Input, Modal, Textarea } from '../../../components/ui';

// View + edit + delete a single season. Opens from a card ("clip"). A season is
// always live once created - there is no draft/publish lifecycle.
function TournamentModal({ tournament, path, onClose }: { tournament: any; path: string; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tournament.name ?? '');
  const [description, setDescription] = useState(tournament.description ?? '');
  const [error, setError] = useState<string | null>(null);

  const update = useApiMutation(
    (body: any) => api('PATCH', `/tournaments/${tournament.id}`, body),
    [path],
    () => onClose(),
  );
  const remove = useApiMutation(
    () => api('DELETE', `/tournaments/${tournament.id}`),
    [path],
    () => onClose(),
  );

  const save = () => {
    setError(null);
    if (!name.trim()) { setError('Name is required'); return; }
    update.mutate(
      { name: name.trim(), description: description.trim() || undefined },
      { onError: (e: any) => setError(e.message) },
    );
  };

  return (
    <Modal
      title={editing ? 'Edit season' : tournament.name}
      onClose={onClose}
      banner={editing ? (
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-300">Edit season</div>
          <div className="mt-1 truncate text-lg font-bold text-white">{tournament.name}</div>
        </div>
      ) : (
        <span className="truncate text-lg font-bold text-white">{tournament.name}</span>
      )}
    >
      {editing ? (
        <>
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button disabled={!name.trim() || update.isPending} onClick={save}>{update.isPending ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">{tournament.description || 'No description.'}</p>
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">Configure its sports & disciplines in the “Sports &amp; disciplines” tab.</p>
          {error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="mt-5 flex items-center justify-between">
            <Button variant="ghost" className="text-rose-600 dark:text-rose-400"
              onClick={async () => { if (await confirmDialog({ title: 'Delete season', confirmLabel: 'Delete', message: `Delete “${tournament.name}”? This cannot be undone.` })) remove.mutate(undefined, { onError: (e: any) => setError(e.message) }); }}
              disabled={remove.isPending}
              aria-label="Delete season"
              title={remove.isPending ? 'Deleting…' : 'Delete season'}>
              <Trash2 size={16} />
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Close</Button>
              <Button onClick={() => setEditing(true)} aria-label="Edit season" title="Edit season">
                <Pencil size={16} />
              </Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

export function TournamentsTab({ eventId, onCreated }: { eventId: string; onCreated?: () => void }) {
  const path = `/tournaments?championship_id=${eventId}`;
  const { data: tournaments = [], isLoading } = useApi<any[]>(path);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<any | null>(null);

  const create = useApiMutation(
    (body: any) => api('POST', '/tournaments', body),
    [path],
    () => { setOpen(false); setName(''); setDescription(''); onCreated?.(); },
  );

  return (
    <div>
      {/* Same toolbar as the other setup steps: count left, add right. */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-400">{`${tournaments.length} season${tournaments.length === 1 ? '' : 's'}`}</span>
        <PillButton icon={Plus} tone="primary" onClick={() => setOpen(true)}>Add season</PillButton>
      </div>

      {isLoading ? null : tournaments.length === 0 ? (
        <EmptyState icon={<CalendarRange size={24} />} title="No seasons" description="Add a season, then configure the sports and disciplines inside it."
          action={<PillButton icon={Plus} tone="primary" onClick={() => setOpen(true)}>Add season</PillButton>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tournaments.map((t) => (
            <button key={t.id} type="button" onClick={() => setActive(t)} title="View, edit or remove"
              className="group flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500/50">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"><CalendarRange size={20} aria-hidden /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-black text-slate-900 group-hover:text-brand-700 dark:text-slate-100 dark:group-hover:text-brand-300">{t.name}</span>
                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{t.description || 'No description'}</span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-slate-300 group-hover:text-brand-500 dark:text-slate-600" aria-hidden />
            </button>
          ))}
        </div>
      )}

      {open && (
        <Modal
          title="New season"
          onClose={() => setOpen(false)}
          banner={<span className="text-lg font-bold text-white">New season</span>}
        >
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Season 1" /></Field>
          <Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!name || create.isPending}
              onClick={() => { setError(null); create.mutate({ championship_id: eventId, name, description: description || undefined, status: 'active' }, { onError: (e: any) => setError(e.message) }); }}>
              {create.isPending ? 'Saving…' : 'Create & continue →'}
            </Button>
          </div>
        </Modal>
      )}

      {active && <TournamentModal tournament={active} path={path} onClose={() => setActive(null)} />}
    </div>
  );
}
