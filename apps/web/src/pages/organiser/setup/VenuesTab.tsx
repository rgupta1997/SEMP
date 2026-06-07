import { useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { useApi, useApiMutation } from '../../../lib/hooks';
import { GROUND_TYPE } from '@semp/shared';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Tabs, Textarea } from '../../../components/ui';

// One venue per line: "Name, City, Address" — city and address optional.
function parseVenueLines(text: string) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/[,\t;]/).map((p) => p.trim()).filter(Boolean);
    return { name: parts[0], city: parts[1], address: parts[2] };
  }).filter((v) => v.name);
}

// One ground per line: "Name, type" — type optional (defaults to court).
function parseGroundLines(text: string) {
  const types = new Set<string>(GROUND_TYPE);
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/[,\t;]/).map((p) => p.trim()).filter(Boolean);
    const rawType = parts[1]?.toLowerCase();
    return {
      name: parts[0],
      ground_type: rawType && types.has(rawType) ? rawType : 'court',
    };
  }).filter((g) => g.name);
}

function AddGroundsModal({ venueId, onClose }: { venueId: string; onClose: () => void }) {
  const path = `/venue-grounds?venue_id=${venueId}`;
  const [tab, setTab] = useState('single');
  const [name, setName] = useState('');
  const [type, setType] = useState('court');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseGroundLines(paste), [paste]);

  const addOne = useApiMutation((body: any) => api('POST', '/venue-grounds', body), [path], () => {
    onClose();
  });
  const addBulk = useApiMutation((body: any) => api('POST', '/venue-grounds/bulk', body), [path], () => {
    onClose();
  });

  const submitSingle = () => {
    setError(null);
    addOne.mutate({ venue_id: venueId, name, ground_type: type }, { onError: (e: any) => setError(e.message) });
  };

  const submitBulk = () => {
    setError(null);
    if (parsed.length === 0) { setError('Add at least one ground'); return; }
    addBulk.mutate({
      grounds: parsed.map((g, i) => ({ venue_id: venueId, name: g.name, ground_type: g.ground_type, display_order: i })),
    }, { onError: (e: any) => setError(e.message) });
  };

  const pending = addOne.isPending || addBulk.isPending;

  return (
    <Modal title="Add grounds / courts" onClose={onClose} wide>
      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'single', label: 'Single' }, { id: 'bulk', label: 'Multiple' }]} />

      {tab === 'single' ? (
        <div className="mt-4 space-y-4">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Court 1" autoFocus /></Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>{GROUND_TYPE.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
          </Field>
        </div>
      ) : (
        <div className="mt-4">
          <Field label="Paste list" hint="One ground per line — Name, type (type optional: court, field, pool, track, ring, table)">
            <Textarea rows={8} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Court 1, court\nCourt 2\nPool A, pool\nField 1, field'} autoFocus />
          </Field>
          {parsed.length > 0 && (
            <p className="mt-2 text-xs text-brand-600 dark:text-brand-300">{parsed.length} ground{parsed.length === 1 ? '' : 's'} detected.</p>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {tab === 'bulk' ? `${parsed.length} to add` : ''}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {tab === 'single' ? (
            <Button disabled={!name || pending} onClick={submitSingle}>{pending ? 'Adding…' : 'Add ground'}</Button>
          ) : (
            <Button disabled={parsed.length === 0 || pending} onClick={submitBulk}>
              {pending ? 'Adding…' : `Add ${parsed.length || ''} ground${parsed.length === 1 ? '' : 's'}`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function GroundsPanel({ venueId }: { venueId: string }) {
  const path = `/venue-grounds?venue_id=${venueId}`;
  const { data: grounds = [] } = useApi<any[]>(path);
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Grounds / courts</span>
        <Button size="sm" variant="subtle" onClick={() => setOpen(true)}>+ Add grounds</Button>
      </div>
      {grounds.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">No grounds yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {grounds.map((g) => <Badge key={g.id} tone="slate">{g.name} · {g.ground_type}</Badge>)}
        </div>
      )}
      {open && <AddGroundsModal venueId={venueId} onClose={() => setOpen(false)} />}
    </div>
  );
}

function AddVenuesModal({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const path = `/venues?event_id=${eventId}`;
  const [tab, setTab] = useState('single');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseVenueLines(paste), [paste]);

  const addOne = useApiMutation((body: any) => api('POST', '/venues', body), [path], () => onClose());
  const addBulk = useApiMutation((body: any) => api('POST', '/venues/bulk', body), [path], () => onClose());

  const submitSingle = () => {
    setError(null);
    addOne.mutate({ event_id: eventId, name, address: address || undefined, city: city || undefined }, { onError: (e: any) => setError(e.message) });
  };

  const submitBulk = () => {
    setError(null);
    if (parsed.length === 0) { setError('Add at least one venue'); return; }
    addBulk.mutate({
      venues: parsed.map((v) => ({
        event_id: eventId,
        name: v.name,
        city: v.city || undefined,
        address: v.address || undefined,
      })),
    }, { onError: (e: any) => setError(e.message) });
  };

  const pending = addOne.isPending || addBulk.isPending;

  return (
    <Modal title="Add venues" onClose={onClose} wide>
      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'single', label: 'Single' }, { id: 'bulk', label: 'Multiple' }]} />

      {tab === 'single' ? (
        <div className="mt-4 space-y-4">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Sports Complex" autoFocus /></Field>
          <Field label="Address"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
          <Field label="City"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
        </div>
      ) : (
        <div className="mt-4">
          <Field label="Paste list" hint="One venue per line — Name, city, address (city and address optional)">
            <Textarea rows={8} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Main Stadium, Mumbai, Marine Lines\nIndoor Complex, Mumbai\nAquatic Center, Worli'} autoFocus />
          </Field>
          {parsed.length > 0 && (
            <p className="mt-2 text-xs text-brand-600 dark:text-brand-300">{parsed.length} venue{parsed.length === 1 ? '' : 's'} detected.</p>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {tab === 'bulk' ? `${parsed.length} to add` : ''}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {tab === 'single' ? (
            <Button disabled={!name || pending} onClick={submitSingle}>{pending ? 'Adding…' : 'Add venue'}</Button>
          ) : (
            <Button disabled={parsed.length === 0 || pending} onClick={submitBulk}>
              {pending ? 'Adding…' : `Add ${parsed.length || ''} venue${parsed.length === 1 ? '' : 's'}`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function VenuesTab({ eventId }: { eventId: string }) {
  const path = `/venues?event_id=${eventId}`;
  const { data: venues = [] } = useApi<any[]>(path);
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">Venues hold the grounds, courts and pools where fixtures are played.</p>
        <Button onClick={() => setOpen(true)}>+ Add venues</Button>
      </div>

      {venues.length === 0 ? (
        <EmptyState icon="📍" title="No venues" description="Add one or many venues, then add the grounds and courts within each."
          action={<Button onClick={() => setOpen(true)}>+ Add venues</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {venues.map((v) => (
            <Card key={v.id} className="p-4">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">{v.name}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">{[v.address, v.city].filter(Boolean).join(', ') || 'No address'}</p>
              <GroundsPanel venueId={v.id} />
            </Card>
          ))}
        </div>
      )}

      {open && <AddVenuesModal eventId={eventId} onClose={() => setOpen(false)} />}
    </div>
  );
}
