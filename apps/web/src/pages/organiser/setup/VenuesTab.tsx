import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { MapPin, Pencil, Trash2 } from 'lucide-react';
import { GROUND_TYPE } from '@semp/shared';
import { useApi, useApiMutation } from '../../../lib/hooks';
import { Badge, Button, Card, confirmDialog, EmptyState, Field, Input, Modal, Select, Spinner, Textarea, toast, Toggle } from '../../../components/ui';

// Venues for a championship - name + address + city - and the grounds / courts
// inside each. A fixture stores only its ground (the venue is the grouping the
// Schedule picker narrows by), so a venue needs at least one ground before its
// fixtures can be placed on it. Each tab shows saved venues as read-only cards
// with their grounds; click a card to manage grounds or view/edit/delete the
// venue, or "+ Add venue" to create another.

// Every ground in the championship in one list - the same key the Schedule page
// reads, so a ground added here shows up in its fixture picker without a reload.
const groundsPath = (eventId: string) => `/championships/${eventId}/grounds`;
// What a ground write invalidates: the championship list above, the generic
// /venue-grounds lists, and the fixtures (they carry the ground's name).
const groundKeys = (eventId: string) => [groundsPath(eventId), '/venue-grounds', `/championships/${eventId}/fixtures`];

const BULK_MAX = 100; // the /venue-grounds/bulk cap

// One ground per line: "Name, type" - type optional (defaults to field), and an
// unrecognised type falls back to field rather than rejecting the line.
function parseGroundLines(text: string) {
  const types = new Set<string>(GROUND_TYPE);
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/[,\t;]/).map((p) => p.trim()).filter(Boolean);
    const rawType = parts[1]?.toLowerCase();
    return { name: parts[0], ground_type: rawType && types.has(rawType) ? rawType : 'field' };
  }).filter((g) => g.name);
}

const typeOptions = GROUND_TYPE.map((t) => <option key={t} value={t}>{t}</option>);

// One ground: name + type, an on/off switch (off = hidden from the fixture picker
// but kept, along with any fixtures already on it), inline rename and delete.
function GroundRow({ eventId, ground }: { eventId: string; ground: any }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(ground.name);
  const [type, setType] = useState(ground.ground_type ?? 'field');
  // Optimistic, so the switch moves on tap rather than after the refetch.
  const [active, setActive] = useState(ground.is_active !== false);
  useEffect(() => { setActive(ground.is_active !== false); }, [ground.is_active]);

  const keys = groundKeys(eventId);
  const update = useApiMutation((body: any) => api('PATCH', `/venue-grounds/${ground.id}`, body), keys);
  const remove = useApiMutation(() => api('DELETE', `/venue-grounds/${ground.id}`), keys);

  const save = () => {
    if (!name.trim()) return;
    update.mutate({ name: name.trim(), ground_type: type }, {
      onSuccess: () => setEditing(false),
      onError: (e: any) => toast.error('Could not save ground', e.message),
    });
  };

  const toggle = (v: boolean) => {
    setActive(v);
    update.mutate({ is_active: v }, {
      onError: (e: any) => { setActive(!v); toast.error('Could not update ground', e.message); },
    });
  };

  if (editing) {
    return (
      <li className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center">
        <Input className="sm:min-w-0 sm:flex-1" value={name} onChange={(e) => setName(e.target.value)} aria-label="Ground name" autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} />
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1"><Select className="w-full" value={type} onChange={(e) => setType(e.target.value)} aria-label="Ground type">{typeOptions}</Select></div>
          <Button size="sm" variant="ghost" className="shrink-0" onClick={() => { setName(ground.name); setType(ground.ground_type ?? 'field'); setEditing(false); }}>Cancel</Button>
          <Button size="sm" className="shrink-0" disabled={!name.trim() || update.isPending} onClick={save}>{update.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-medium ${active ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 line-through dark:text-slate-500'}`}>{ground.name}</div>
        <div className="text-xs capitalize text-slate-400 dark:text-slate-500">{ground.ground_type ?? 'ground'}{active ? '' : ' · switched off'}</div>
      </div>
      <span title={active ? 'In use - switch off to hide it from the fixture picker' : 'Switched off - switch on to schedule fixtures here'}>
        <Toggle checked={active} onChange={toggle} />
      </span>
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Edit ${ground.name}`} title="Rename / change type">
        <Pencil size={14} />
      </Button>
      <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" disabled={remove.isPending} aria-label={`Delete ${ground.name}`} title="Delete ground"
        onClick={async () => {
          if (!(await confirmDialog({ title: 'Delete ground', confirmLabel: 'Delete', message: `Delete “${ground.name}”? This cannot be undone.` }))) return;
          remove.mutate(undefined, {
            // fixtures.venue_ground_id has no cascade, so a 400 here is a ground
            // that fixtures are still scheduled on - say that, not "depends on
            // something that no longer exists".
            onError: (e: any) => toast.error(`Could not delete ${ground.name}`, e.status === 400
              ? 'Fixtures are scheduled on it. Move them to another ground first, or switch this one off instead.'
              : e.message),
          });
        }}>
        <Trash2 size={14} />
      </Button>
    </li>
  );
}

// The grounds list inside a venue, plus add - one at a time (Enter to add the next),
// or a pasted list of "Name, type" lines in one go.
function GroundsSection({ eventId, venueId, grounds }: { eventId: string; venueId: string; grounds: any[] }) {
  const [many, setMany] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('field');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Input isn't a forwardRef, so focus is put back through the row around it.
  const addRowRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => parseGroundLines(paste), [paste]);
  // New grounds go after the existing ones. Sent explicitly: the create schema
  // defaults display_order to 0, so the bulk route's own index fallback never runs.
  const nextOrder = grounds.reduce((m, g) => Math.max(m, (g.display_order ?? 0) + 1), 0);

  const keys = groundKeys(eventId);
  const addOne = useApiMutation((body: any) => api('POST', '/venue-grounds', body), keys, () => {
    setName('');
    addRowRef.current?.querySelector('input')?.focus(); // ready for the next one
  });
  const addMany = useApiMutation((body: any) => api('POST', '/venue-grounds/bulk', body), keys, () => {
    setPaste('');
    setMany(false);
  });
  const pending = addOne.isPending || addMany.isPending;

  const submitOne = () => {
    setError(null);
    if (!name.trim() || pending) return;
    addOne.mutate({ venue_id: venueId, name: name.trim(), ground_type: type, display_order: nextOrder }, { onError: (e: any) => setError(e.message) });
  };

  const submitMany = () => {
    setError(null);
    if (parsed.length === 0) { setError('Add at least one ground'); return; }
    if (parsed.length > BULK_MAX) { setError(`Up to ${BULK_MAX} grounds at a time`); return; }
    addMany.mutate({
      grounds: parsed.map((g, i) => ({ venue_id: venueId, name: g.name, ground_type: g.ground_type, display_order: nextOrder + i })),
    }, { onError: (e: any) => setError(e.message) });
  };

  return (
    <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Grounds / courts{grounds.length > 0 ? ` (${grounds.length})` : ''}</h4>
      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Fixtures are scheduled on a ground. Switch one off to hide it from the fixture picker without deleting it.</p>

      {grounds.length === 0 ? (
        <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">No grounds yet - add at least one so fixtures can be placed at this venue.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
          {grounds.map((g) => <GroundRow key={g.id} eventId={eventId} ground={g} />)}
        </ul>
      )}

      {many ? (
        <div className="mt-3">
          <Field label="Paste a list" hint="One ground per line - Name, type. Type is optional (field if left out): court, field, pool, track, ring, table.">
            <Textarea rows={6} className="w-full" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Football Ground 1\nFootball Ground 2\nCourt A, court'} autoFocus />
          </Field>
          {parsed.length > 0 && (
            <div className="-mt-2 mb-3 flex flex-wrap gap-1.5">
              {parsed.slice(0, 12).map((g, i) => <Badge key={i} tone="slate">{g.name} · {g.ground_type}</Badge>)}
              {parsed.length > 12 && <Badge tone="slate">+{parsed.length - 12} more</Badge>}
            </div>
          )}
          {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setMany(false); setError(null); }}>Cancel</Button>
            <Button size="sm" disabled={parsed.length === 0 || pending} onClick={submitMany}>
              {addMany.isPending ? 'Adding…' : `Add ${parsed.length || ''} ground${parsed.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          {/* Name on its own line on a phone, type + Add under it; one row from sm up. */}
          <div ref={addRowRef} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input className="sm:min-w-0 sm:flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Football Ground 1" aria-label="New ground name"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitOne(); } }} />
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1"><Select className="w-full" value={type} onChange={(e) => setType(e.target.value)} aria-label="New ground type">{typeOptions}</Select></div>
              <Button className="shrink-0" disabled={!name.trim() || pending} onClick={submitOne}>{addOne.isPending ? 'Adding…' : '+ Add'}</Button>
            </div>
          </div>
          {error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <button type="button" className="mt-2 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => { setMany(true); setError(null); }}>
            Paste several at once
          </button>
        </div>
      )}
    </div>
  );
}

function VenueModal({ eventId, path, venue, onClose }: { eventId: string; path: string; venue: any | null; onClose: () => void }) {
  // The venue that was opened, or null for a new one - which becomes the created
  // venue once saved, so its grounds can be added straight away.
  const [current, setCurrent] = useState<any | null>(venue);
  const isNew = !current;
  const [editing, setEditing] = useState(isNew);
  const [name, setName] = useState(venue?.name ?? '');
  const [address, setAddress] = useState(venue?.address ?? '');
  const [city, setCity] = useState(venue?.city ?? '');
  const [error, setError] = useState<string | null>(null);
  const { data: allGrounds = [] } = useApi<any[]>(groundsPath(eventId));
  const grounds = current ? allGrounds.filter((g) => g.venue_id === current.id) : [];

  const create = useApiMutation((body: any) => api('POST', '/venues', body), [path], (created: any) => { setCurrent(created); setEditing(false); });
  const update = useApiMutation((body: any) => api('PATCH', `/venues/${current?.id}`, body), [path], () => onClose());
  const remove = useApiMutation(() => api('DELETE', `/venues/${current?.id}`), [path], () => onClose());
  const pending = create.isPending || update.isPending;

  const save = () => {
    setError(null);
    if (!name.trim()) { setError('Venue name is required'); return; }
    const body = { name: name.trim(), address: address.trim() || undefined, city: city.trim() || undefined };
    const opts = { onError: (e: any) => setError(e.message) };
    if (current) update.mutate(body, opts);
    else create.mutate({ championship_id: eventId, ...body }, opts);
  };

  const deleteVenue = async () => {
    setError(null);
    // venue_grounds has no cascade, so a venue with grounds can't be deleted -
    // say so up front rather than surface a foreign-key error.
    if (grounds.length > 0) { setError(`Delete its ${grounds.length} ground${grounds.length === 1 ? '' : 's'} first.`); return; }
    if (!(await confirmDialog({ title: 'Delete venue', confirmLabel: 'Delete', message: `Delete “${current.name}”? This cannot be undone.` }))) return;
    remove.mutate(undefined, {
      onError: (e: any) => setError(e.status === 400 ? 'A discipline still uses this venue - move it to another venue first.' : e.message),
    });
  };

  // View mode can run long with a venue's grounds listed, so its actions are
  // pinned in the modal footer rather than scrolling away below them.
  return (
    <Modal
      title={isNew ? 'New venue' : editing ? 'Edit venue' : current.name}
      onClose={onClose}
      banner={isNew ? (
        <span className="text-lg font-bold text-white">New venue</span>
      ) : editing ? (
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-300">Edit venue</div>
          <div className="mt-1 truncate text-lg font-bold text-white">{current.name}</div>
        </div>
      ) : (
        <span className="truncate text-lg font-bold text-white">{current.name}</span>
      )}
      footer={!editing && current ? (
        <>
          {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex items-center justify-between">
            <Button variant="ghost" className="text-rose-600 dark:text-rose-400"
              onClick={deleteVenue}
              disabled={remove.isPending}
              aria-label="Delete venue"
              title={remove.isPending ? 'Deleting…' : 'Delete venue'}>
              <Trash2 size={16} />
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Close</Button>
              <Button onClick={() => setEditing(true)} aria-label="Edit venue" title="Edit venue">
                <Pencil size={16} />
              </Button>
            </div>
          </div>
        </>
      ) : undefined}
    >
      {editing ? (
        <>
          <Field label="Venue name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Sports Complex" /></Field>
          <Field label="Address"><Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" /></Field>
          <Field label="City"><Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Optional" /></Field>
          {isNew && <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">Saving takes you straight to adding its grounds / courts.</p>}
          {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={isNew ? onClose : () => setEditing(false)}>Cancel</Button>
            <Button disabled={!name.trim() || pending} onClick={save}>{pending ? 'Saving…' : isNew ? 'Add venue' : 'Save changes'}</Button>
          </div>
        </>
      ) : (
        <>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-slate-400 dark:text-slate-500">Address</dt><dd className="text-slate-700 dark:text-slate-200">{current.address || '-'}</dd></div>
            <div><dt className="text-slate-400 dark:text-slate-500">City</dt><dd className="text-slate-700 dark:text-slate-200">{current.city || '-'}</dd></div>
          </dl>
          <GroundsSection eventId={eventId} venueId={current.id} grounds={grounds} />
        </>
      )}
    </Modal>
  );
}

export function VenuesTab({ eventId }: { eventId: string }) {
  const path = `/venues?championship_id=${eventId}`;
  const { data: venues = [], isLoading } = useApi<any[]>(path);
  const { data: grounds = [] } = useApi<any[]>(groundsPath(eventId));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<any | null>(null);

  if (isLoading) return <div className="grid h-24 place-items-center"><Spinner /></div>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">The venues where this championship is played, and the grounds or courts inside each.</p>
        <Button onClick={() => setOpen(true)}>+ Add venue</Button>
      </div>

      {venues.length === 0 ? (
        <EmptyState icon={<MapPin size={24} />} title="No venues" description="Add the venue(s) where this championship is played, then the grounds or courts inside each."
          action={<Button onClick={() => setOpen(true)}>+ Add venue</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {venues.map((v) => {
            const vg = grounds.filter((g) => g.venue_id === v.id);
            return (
              <Card key={v.id} className="cursor-pointer p-4 transition hover:border-brand-300 dark:hover:border-brand-500/50 hover:shadow-md" onClick={() => setActive(v)}>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">{v.name}</h3>
                {(v.address || v.city) && (
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{[v.address, v.city].filter(Boolean).join(', ')}</p>
                )}
                {vg.length === 0 ? (
                  <p className="mt-3 text-xs font-medium text-amber-600 dark:text-amber-400">No grounds yet - open to add them.</p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {vg.slice(0, 8).map((g) => (
                      <Badge key={g.id} tone={g.is_active === false ? 'slate' : 'brand'} className={g.is_active === false ? 'line-through opacity-60' : ''}>{g.name}</Badge>
                    ))}
                    {vg.length > 8 && <Badge tone="slate">+{vg.length - 8} more</Badge>}
                  </div>
                )}
                <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">Click to manage grounds, or edit / remove the venue.</p>
              </Card>
            );
          })}
        </div>
      )}

      {open && <VenueModal eventId={eventId} path={path} venue={null} onClose={() => setOpen(false)} />}
      {active && <VenueModal eventId={eventId} path={path} venue={active} onClose={() => setActive(null)} />}
    </div>
  );
}
