import { useState } from 'react';
import { useEvent } from './EventLayout';
import { api } from '../../lib/api';
import { useApiMutation } from '../../lib/hooks';
import { EVENT_STATUS } from '@semp/shared';
import { Button, Card, CardBody, CardHeader, Field, Input, StatusBadge, Textarea } from '../../components/ui';

export function EventSettingsPage() {
  const { event, eventId } = useEvent();
  const [name, setName] = useState(event.name);
  const [venue, setVenue] = useState(event.venue ?? '');
  const [description, setDescription] = useState(event.description ?? '');
  const [startDate, setStartDate] = useState(event.start_date?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(event.end_date?.slice(0, 10) ?? '');
  const [saved, setSaved] = useState(false);

  const save = useApiMutation(
    (body: any) => api('PATCH', `/events/${eventId}`, body),
    [`/events/${eventId}`, '/events'],
    () => { setSaved(true); setTimeout(() => setSaved(false), 2000); },
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader title="Event details" />
        <CardBody>
          <Field label="Event name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Start date"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
            <Field label="End date"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
          </div>
          <Field label="Host city / venue"><Input value={venue} onChange={(e) => setVenue(e.target.value)} /></Field>
          <Field label="Description"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-sm font-medium text-emerald-600">Saved ✓</span>}
            <Button disabled={save.isPending}
              onClick={() => save.mutate({ name, venue: venue || undefined, description: description || undefined, start_date: startDate, end_date: endDate }, { onError: (e: any) => alert(e.message) })}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card className="h-fit">
        <CardHeader title="Lifecycle" subtitle="Where this event is in its journey" />
        <CardBody>
          <div className="mb-4 flex items-center gap-2"><span className="text-sm text-slate-500 dark:text-slate-400">Current</span><StatusBadge status={event.status} /></div>
          <ol className="space-y-2">
            {EVENT_STATUS.map((s, i) => {
              const idx = EVENT_STATUS.indexOf(event.status as any);
              const done = i < idx, current = i === idx;
              return (
                <li key={s} className={`flex items-center gap-2 text-sm ${current ? 'font-semibold text-slate-900 dark:text-slate-100' : done ? 'text-slate-400 dark:text-slate-500' : 'text-slate-500 dark:text-slate-400'}`}>
                  <span className={`grid h-5 w-5 place-items-center rounded-full text-xs ${done || current ? 'bg-brand-500 text-white' : 'bg-slate-200 text-slate-500 dark:text-slate-400'}`}>{done ? '✓' : i + 1}</span>
                  {s.replace(/_/g, ' ')}
                </li>
              );
            })}
          </ol>
          <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">Use the button in the event header to advance the lifecycle.</p>
        </CardBody>
      </Card>
    </div>
  );
}
