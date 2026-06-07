import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApiMutation } from '../../lib/hooks';
import { BackButton, Button, Card, Field, Input, Stepper, Textarea } from '../../components/ui';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function CreateEventWizard() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [venue, setVenue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useApiMutation(
    (body: any) => api('POST', '/events', body),
    ['/events'],
    (ev: any) => navigate(`/events/${ev.id}/setup`),
  );

  const effectiveSlug = slugTouched ? slug : slugify(name);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!startDate || !endDate) { setError('Start and end dates are required'); return; }
    create.mutate({
      name, slug: effectiveSlug, venue: venue || undefined,
      description: description || undefined, start_date: startDate, end_date: endDate,
    }, { onError: (err: any) => setError(err.message ?? 'Could not create event') });
  };

  return (
    <div>
      <BackButton onClick={() => navigate('/events')}>Back to events</BackButton>
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit p-6">
          <h2 className="mb-1 text-lg font-bold">Create event</h2>
          <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">Step 1 of 4</p>
          <Stepper current={0} steps={['Event profile', 'Tournament & sports', 'Venues & disciplines', 'Open registration']} />
          <p className="mt-6 text-xs text-slate-400 dark:text-slate-500">You will configure tournaments, sports and venues right after creating the event.</p>
        </Card>

        <Card className="p-6">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Tell us about the event</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">The basics — you can edit all of this later in settings.</p>
          <form onSubmit={submit} className="mt-6">
            <Field label="Event name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Genesis Sports Fest '26" required />
            </Field>
            <Field label="URL slug" hint={`sportagon.app/${effectiveSlug || 'your-event'}`}>
              <Input value={effectiveSlug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} placeholder="genesis-26" required />
            </Field>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label="Start date"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></Field>
              <Field label="End date"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required /></Field>
            </div>
            <Field label="Host city / venue"><Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Mumbai" /></Field>
            <Field label="Description"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A short summary of the event…" /></Field>
            {error && <p className="mb-3 rounded-lg bg-rose-50 dark:bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => navigate('/events')}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create & continue →'}</Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
