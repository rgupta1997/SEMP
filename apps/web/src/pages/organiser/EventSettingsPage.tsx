import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEvent } from './EventLayout';
import { api } from '../../lib/api';
import { fmtDate, useApi, useApiMutation } from '../../lib/hooks';
import { ARCHIVE_RETENTION_DAYS, archiveDaysLeft, CHAMPIONSHIP_STATUS, type ChampionshipRemovalMode } from '@semp/shared';
import { titleCase } from '../../lib/format';
import { Button, Card, CardBody, CardHeader, confirmDialog, Field, Input, Pills, Progress, Select, StatusBadge, Textarea, toast } from '../../components/ui';
import { useWorkspace } from '../../lib/useWorkspace';
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

  // Which organisation is running this. It decides whose signature goes on the
  // event's certificates, so the Certificates page points people here when it is
  // unset - which means this control has to exist.
  const ws = useWorkspace();
  const hostable = ws.contexts.filter(
    (c) => c.kind === 'org' && c.roleCodes.some((r) => r === 'owner' || r === 'org_admin'),
  );
  const [hostOrgId, setHostOrgId] = useState<string>(
    (championship as any).host_organization_id ?? '',
  );

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
          {/* Only offered to somebody who could actually host on an organisation's
              behalf - the server refuses any other choice, and an option that is
              always rejected is worse than no option. */}
          {hostable.length > 0 ? (
            <Field
              label="Hosted by"
              hint="Whose event this is. Certificates for it carry this organisation's name and signature."
            >
              <Select value={hostOrgId} onChange={(e) => setHostOrgId(e.target.value)}>
                <option value="">Nobody — an individual is hosting</option>
                {hostable.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </Field>
          ) : (championship as any).host_organization ? (
            <Field label="Hosted by" hint="Only an owner or administrator of that organisation can change this.">
              <Input value={(championship as any).host_organization.name} readOnly />
            </Field>
          ) : null}
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
              onClick={() => save.mutate({
                name, venue: venue || undefined, description: description || undefined,
                start_date: startDate, end_date: endDate, visibility,
                ...(hostable.length > 0 ? { host_organization_id: hostOrgId || null } : {}),
              }, { onSuccess: () => toast.success('Championship saved'), onError: (e: any) => toast.error(e.message) })}>
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

      <DangerZone eventId={eventId} name={championship.name} onDelete={() => remove.mutateAsync(undefined)} deleting={remove.isPending} />
    </div>
  );
}

interface Removal {
  mode: ChampionshipRemovalMode;
  reasons: string[];
  archived_at: string | null;
  purge_on: string | null;
  retention_days: number;
}

// Delete OR archive, never both. Once the event has results - completed, a played or
// locked match, an issued certificate - it can only be archived: hidden, restorable,
// and permanently deleted after the retention period unless retrieved.
function DangerZone({ eventId, name, onDelete, deleting }: {
  eventId: string; name: string; onDelete: () => Promise<unknown>; deleting: boolean;
}) {
  const navigate = useNavigate();
  const removalPath = `/championships/${eventId}/removal`;
  const { data } = useApi<Removal>(removalPath);
  const lists = ['/championships', '/championships/mine', removalPath];
  const archive = useApiMutation(() => api('POST', `/championships/${eventId}/archive`), lists);
  const retrieve = useApiMutation(() => api('POST', `/championships/${eventId}/retrieve`), lists);

  if (!data) return null;
  const days = data.retention_days ?? ARCHIVE_RETENTION_DAYS;

  if (data.archived_at) {
    return (
      <Card className="border-amber-200 dark:border-amber-500/30">
        <CardHeader title="Archived" subtitle={`Archived on ${fmtDate(data.archived_at)}`} />
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              This championship is hidden from every list and will be permanently deleted on{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-200">{fmtDate(data.purge_on!)}</span>{' '}
              ({archiveDaysLeft(data.archived_at)} days left) unless you retrieve it.
            </p>
            <Button disabled={retrieve.isPending} onClick={() => retrieve.mutate(undefined, {
              onSuccess: () => toast.success('Championship retrieved'),
              onError: (e: any) => toast.error(e.message),
            })}>
              {retrieve.isPending ? 'Retrieving…' : 'Retrieve'}
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (data.mode === 'archive') {
    return (
      <Card className="border-rose-200 dark:border-rose-500/30">
        <CardHeader title="Danger zone" subtitle="Archive this championship" />
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              This championship can't be deleted because {data.reasons.join(', ')}. You can archive it instead:
              it is hidden from every list, and you can retrieve it from the Archived tab for {days} days.
            </p>
            <Button
              variant="danger"
              disabled={archive.isPending}
              onClick={async () => {
                const ok = await confirmDialog({
                  title: 'Archive championship',
                  confirmLabel: 'Archive championship',
                  message: `“${name}” will be hidden from every list. It will be permanently deleted after ${days} days unless you retrieve it from the Archived tab before then. Players keep their results and certificates stay valid.`,
                });
                if (!ok) return;
                archive.mutate(undefined, {
                  onSuccess: () => { toast.success(`Archived - deleted in ${days} days unless retrieved`); navigate('/championships?tab=archived'); },
                  onError: (e: any) => toast.error(e.message),
                });
              }}
            >
              {archive.isPending ? 'Archiving…' : 'Archive championship'}
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="border-rose-200 dark:border-rose-500/30">
      <CardHeader title="Danger zone" subtitle="Permanently delete this championship and everything in it" />
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Deletes all tournaments, venues, fixtures, enrollments and notifications for this championship. Teams are kept. This cannot be undone.
          </p>
          <Button
            variant="danger"
            disabled={deleting}
            onClick={async () => {
              if (await confirmDialog({ title: 'Delete championship', confirmLabel: 'Delete championship', message: `Delete “${name}” now? It is removed permanently, straight away, and cannot be retrieved.` })) {
                onDelete().catch((e: any) => toast.error(e.message));
              }
            }}
          >
            {deleting ? 'Deleting…' : 'Delete championship'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
