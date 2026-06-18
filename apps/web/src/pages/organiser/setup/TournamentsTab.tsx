import { useState } from 'react';
import { api } from '../../../lib/api';
import { useApi, useApiMutation } from '../../../lib/hooks';
import { Button, Card, EmptyState, Field, Input, Modal, Textarea } from '../../../components/ui';

// View + edit + delete a single season. Opens from a card ("clip"). A season is
// always live once created — there is no draft/publish lifecycle.
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
    <Modal title={editing ? 'Edit season' : tournament.name} onClose={onClose}>
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
              onClick={() => { if (confirm(`Delete “${tournament.name}”? This cannot be undone.`)) remove.mutate(undefined, { onError: (e: any) => setError(e.message) }); }}
              disabled={remove.isPending}>
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Close</Button>
              <Button onClick={() => setEditing(true)}>Edit</Button>
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
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">A season groups the sports & disciplines that share a championship table.</p>
        <Button onClick={() => setOpen(true)}>+ Add season</Button>
      </div>

      {isLoading ? null : tournaments.length === 0 ? (
        <EmptyState icon="⊟" title="No seasons" description="Add a season, then configure the sports and disciplines inside it."
          action={<Button onClick={() => setOpen(true)}>+ Add season</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tournaments.map((t) => (
            <Card key={t.id} className="cursor-pointer p-4 transition hover:border-brand-300 dark:hover:border-brand-500/50 hover:shadow-md" onClick={() => setActive(t)}>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">{t.name}</h3>
              {t.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{t.description}</p>}
              <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">Click to view, edit or remove.</p>
            </Card>
          ))}
        </div>
      )}

      {open && (
        <Modal title="New season" onClose={() => setOpen(false)}>
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
