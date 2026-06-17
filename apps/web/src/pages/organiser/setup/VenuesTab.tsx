import { useState } from 'react';
import { api } from '../../../lib/api';
import { MapPin } from 'lucide-react';
import { useApi, useApiMutation } from '../../../lib/hooks';
import { Button, Card, confirmDialog, EmptyState, Field, Input, Modal, Spinner } from '../../../components/ui';

// Venues for a championship — name + address + city. Grounds/courts are
// intentionally hidden for now (planned later); fixtures reference the venue.
// Each tab shows saved venues as read-only cards; click a card to view/edit/
// delete, or "+ Add venue" to create another.
function VenueModal({ eventId, path, venue, onClose }: { eventId: string; path: string; venue: any | null; onClose: () => void }) {
  const isNew = !venue;
  const [editing, setEditing] = useState(isNew);
  const [name, setName] = useState(venue?.name ?? '');
  const [address, setAddress] = useState(venue?.address ?? '');
  const [city, setCity] = useState(venue?.city ?? '');
  const [error, setError] = useState<string | null>(null);

  const create = useApiMutation((body: any) => api('POST', '/venues', body), [path], () => onClose());
  const update = useApiMutation((body: any) => api('PATCH', `/venues/${venue?.id}`, body), [path], () => onClose());
  const remove = useApiMutation(() => api('DELETE', `/venues/${venue?.id}`), [path], () => onClose());
  const pending = create.isPending || update.isPending;

  const save = () => {
    setError(null);
    if (!name.trim()) { setError('Venue name is required'); return; }
    const body = { name: name.trim(), address: address.trim() || undefined, city: city.trim() || undefined };
    const opts = { onError: (e: any) => setError(e.message) };
    if (venue) update.mutate(body, opts);
    else create.mutate({ championship_id: eventId, ...body }, opts);
  };

  return (
    <Modal title={isNew ? 'New venue' : editing ? 'Edit venue' : venue.name} onClose={onClose}>
      {editing ? (
        <>
          <Field label="Venue name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Sports Complex" /></Field>
          <Field label="Address"><Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" /></Field>
          <Field label="City"><Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Optional" /></Field>
          {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={isNew ? onClose : () => setEditing(false)}>Cancel</Button>
            <Button disabled={!name.trim() || pending} onClick={save}>{pending ? 'Saving…' : isNew ? 'Add venue' : 'Save changes'}</Button>
          </div>
        </>
      ) : (
        <>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-slate-400 dark:text-slate-500">Address</dt><dd className="text-slate-700 dark:text-slate-200">{venue.address || '—'}</dd></div>
            <div><dt className="text-slate-400 dark:text-slate-500">City</dt><dd className="text-slate-700 dark:text-slate-200">{venue.city || '—'}</dd></div>
          </dl>
          {error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="mt-5 flex items-center justify-between">
            <Button variant="ghost" className="text-rose-600 dark:text-rose-400"
              onClick={async () => { if (await confirmDialog({ title: 'Delete venue', confirmLabel: 'Delete', message: `Delete “${venue.name}”? This cannot be undone.` })) remove.mutate(undefined, { onError: (e: any) => setError(e.message) }); }}
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

export function VenuesTab({ eventId }: { eventId: string }) {
  const path = `/venues?championship_id=${eventId}`;
  const { data: venues = [], isLoading } = useApi<any[]>(path);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<any | null>(null);

  if (isLoading) return <div className="grid h-24 place-items-center"><Spinner /></div>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">The venues where this championship is played.</p>
        <Button onClick={() => setOpen(true)}>+ Add venue</Button>
      </div>

      {venues.length === 0 ? (
        <EmptyState icon={<MapPin size={24} />} title="No venues" description="Add the venue(s) where this championship is played."
          action={<Button onClick={() => setOpen(true)}>+ Add venue</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {venues.map((v) => (
            <Card key={v.id} className="cursor-pointer p-4 transition hover:border-brand-300 dark:hover:border-brand-500/50 hover:shadow-md" onClick={() => setActive(v)}>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">{v.name}</h3>
              {(v.address || v.city) && (
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{[v.address, v.city].filter(Boolean).join(', ')}</p>
              )}
              <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">Click to view, edit or remove.</p>
            </Card>
          ))}
        </div>
      )}

      {open && <VenueModal eventId={eventId} path={path} venue={null} onClose={() => setOpen(false)} />}
      {active && <VenueModal eventId={eventId} path={path} venue={active} onClose={() => setActive(null)} />}
    </div>
  );
}
