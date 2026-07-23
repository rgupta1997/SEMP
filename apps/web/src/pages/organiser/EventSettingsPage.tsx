import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEvent } from './EventLayout';
import { api } from '../../lib/api';
import { useApiMutation } from '../../lib/hooks';
import { CHAMPIONSHIP_STATUS } from '@semp/shared';
import { titleCase } from '../../lib/format';
import { Button, Card, CardBody, CardHeader, confirmDialog, Field, Input, Pills, Progress, StatusBadge, Textarea, toast } from '../../components/ui';
import { StandingsRulesCard } from '../../components/StandingsRulesCard';

export function EventSettingsPage() {
  const navigate = useNavigate();
  const { championship, eventId } = useEvent();
  const [name, setName] = useState(championship.name);
  const [venue, setVenue] = useState(championship.venue ?? '');
  const [description, setDescription] = useState(championship.description ?? '');
  const [startDate, setStartDate] = useState(championship.start_date?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(championship.end_date?.slice(0, 10) ?? '');
  const [visibility, setVisibility] = useState<'public' | 'private'>(championship.visibility === 'private' ? 'private' : 'public');
  const [saved, setSaved] = useState(false);

  const save = useApiMutation(
    (body: any) => api('PATCH', `/championships/${eventId}`, body),
    [`/championships/${eventId}`, '/championships'],
    () => { setSaved(true); setTimeout(() => setSaved(false), 2000); },
  );

  const remove = useApiMutation(
    () => api('DELETE', `/championships/${eventId}`),
    ['/championships', '/championships/mine'],
    () => { toast.success('Championship deleted'); navigate('/championships'); },
  );

  return (
    <div className="space-y-6">
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader title="Championship details" />
        <CardBody>
          <Field label="Championship name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Start date"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
            <Field label="End date"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
          </div>
          <Field label="Host city / venue"><Input value={venue} onChange={(e) => setVenue(e.target.value)} /></Field>
          <Field label="Description"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="Visibility" hint={visibility === 'private'
            ? 'Hidden from Discover - organizations can only join through your invitations.'
            : 'Listed in Discover so any organization can find it and apply.'}>
            <Pills value={visibility} onChange={(v) => setVisibility(v as 'public' | 'private')} options={[
              { value: 'public', label: 'Public' },
              { value: 'private', label: 'Private (invite-only)' },
            ]} ariaLabel="Championship visibility" />
          </Field>
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-sm font-medium text-emerald-600">Saved ✓</span>}
            <Button disabled={save.isPending}
              onClick={() => save.mutate({ name, venue: venue || undefined, description: description || undefined, start_date: startDate, end_date: endDate, visibility }, { onSuccess: () => toast.success('Championship saved'), onError: (e: any) => toast.error(e.message) })}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card className="h-fit">
        <CardHeader title="Lifecycle" subtitle="Where this championship is in its journey" />
        <CardBody>
          <div className="mb-4 flex items-center gap-2"><span className="text-sm text-slate-500 dark:text-slate-400">Current</span><StatusBadge status={championship.status} /></div>
          <Progress value={CHAMPIONSHIP_STATUS.indexOf(championship.status as typeof CHAMPIONSHIP_STATUS[number]) + 1} max={CHAMPIONSHIP_STATUS.length} className="mb-4" />
          <ol className="space-y-2">
            {CHAMPIONSHIP_STATUS.map((s, i) => {
              const idx = CHAMPIONSHIP_STATUS.indexOf(championship.status as any);
              const done = i < idx, current = i === idx;
              return (
                <li key={s} className={`flex items-center gap-2 text-sm ${current ? 'font-semibold text-slate-900 dark:text-slate-100' : done ? 'text-slate-400 dark:text-slate-500' : 'text-slate-500 dark:text-slate-400'}`}>
                  <span className={`grid h-5 w-5 place-items-center rounded-full text-xs ${done || current ? 'bg-brand-500 text-white' : 'bg-slate-200 text-slate-500 dark:text-slate-400'}`}>{done ? '✓' : i + 1}</span>
                  {titleCase(s)}
                </li>
              );
            })}
          </ol>
          <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">Use the button in the championship header to advance the lifecycle.</p>
        </CardBody>
      </Card>
    </div>

      <StandingsRulesCard eventId={eventId} />

      <Card className="border-rose-200 dark:border-rose-500/30">
        <CardHeader title="Danger zone" subtitle="Permanently delete this championship and everything in it" />
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Deletes all tournaments, teams, venues, fixtures, enrollments and notifications for this championship. This cannot be undone.
            </p>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={async () => {
                if (await confirmDialog({ title: 'Delete championship', confirmLabel: 'Delete championship', message: `Delete “${championship.name}”? This permanently removes the championship and all of its data. This cannot be undone.` })) {
                  remove.mutate(undefined, { onError: (e: any) => toast.error(e.message) });
                }
              }}
            >
              {remove.isPending ? 'Deleting…' : 'Delete championship'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
