import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useApiMutation } from '../../lib/hooks';
import { CHAMPIONSHIP_TYPE, CHAMPIONSHIP_TYPE_LABELS, KNOWN_COUNTRIES, type ChampionshipTemplate, type ChampionshipType } from '@semp/shared';
import { BackButton, Button, Card, Field, Input, Pills, Select, Spinner, Stepper, Textarea, confirmDialog, toast } from '../../components/ui';
import { SportsTab } from './setup/SportsTab';
import { InvitePanel } from '../../components/InvitePanel';
import { TemplateGallery } from './TemplateGallery';
import { SaveAsTemplate } from './SaveAsTemplate';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Venue + a separate "Seasons" step are gone: the city captured below doubles as the
// venue, and a default season is auto-created with the championship, so the organiser
// goes straight from the profile to adding sports.
// Step 0 is the template picker: an organiser configuring six sports from an empty
// form is the thing this step exists to stop happening (J2-E1-S1).
const STEPS = ['Shape', 'Championship profile', 'Sports & disciplines', 'Invite organizations', 'Open registration'];
const LAST_STEP = STEPS.length - 1;

export function CreateEventWizard() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [step, setStep] = useState(0);
  const [eventId, setEventId] = useState<string | null>(null);
  // null = start from scratch. Nothing is preselected: the library is the organiser's
  // own as much as ours now, so guessing which row they want would be presumptuous.
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ sports_added: number; disciplines_added: number; skipped: string[] } | null>(null);
  const { data: templates = [], isLoading: templatesLoading, refetch: refetchTemplates } =
    useApi<ChampionshipTemplate[]>('/championship-templates');

  // Step 1 - basics
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [venue, setVenue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [type, setType] = useState<ChampionshipType | ''>('');
  const [country, setCountry] = useState('India');
  const [error, setError] = useState<string | null>(null);
  const effectiveSlug = slugTouched ? slug : slugify(name);

  const create = useApiMutation((body: any) => api('POST', '/championships', body), ['/championships']);
  const applyTemplate = useApiMutation(
    (id: string) => api('POST', `/championships/${eventId}/apply-template`, { template: id }),
    ['/championships'],
  );
  const update = useApiMutation((body: any) => api('PATCH', `/championships/${eventId}`, body), ['/championships']);
  const openReg = useApiMutation(
    () => api('PATCH', `/championships/${eventId}/status`, { status: 'registration_open' }),
    ['/championships'],
  );

  // Step 0 doubles as create + edit: the first save creates the draft (and grants
  // the creator the Organiser role, so we refresh auth); returning here via Back
  // edits the existing draft instead of creating a duplicate.
  const createDraft = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!venue.trim()) { setError('Host city is required'); return; }
    if (!startDate || !endDate) { setError('Start and end dates are required'); return; }
    const body = {
      name, slug: effectiveSlug, venue: venue.trim(), description: description || undefined,
      start_date: startDate, end_date: endDate, visibility, type: type || null,
      country: country.trim() || null,
    };
    if (eventId) {
      update.mutate(body, {
        onSuccess: () => setStep(2),
        onError: (err: any) => setError(err.message ?? 'Could not save championship'),
      });
    } else {
      create.mutate(body, {
        onSuccess: async (ev: any) => {
          await refresh();
          setEventId(ev.id);
          // The template is applied to the draft that now exists. A failure here is
          // worth saying out loud but must not strand them: the championship is
          // created either way, and every sport it would have added can be added by
          // hand on the very next step.
          if (templateId) {
            try {
              const res: any = await api('POST', `/championships/${ev.id}/apply-template`, { template: templateId });
              setApplied(res);
              if (res.skipped?.length) {
                toast.error('Some of the template was skipped', `Not in the catalogue: ${res.skipped.join(', ')}`);
              }
            } catch (e: any) {
              toast.error('Could not apply the template', `${e.message} - add sports on the next step instead.`);
            }
          }
          setStep(2);
        },
        onError: (err: any) => setError(err.message ?? 'Could not create championship'),
      });
    }
  };
  const savingDraft = create.isPending || update.isPending;

  const finish = (open: boolean) => {
    if (!open) { navigate(`/championships/${eventId}`); return; }
    openReg.mutate(undefined, {
      onSuccess: () => { toast.success('Registration opened'); navigate(`/championships/${eventId}`); },
      onError: (e: any) => toast.error(e.message),
    });
  };

  return (
    <div>
      <BackButton onClick={() => navigate('/championships')}>Back to championships</BackButton>
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit p-6">
          <h2 className="mb-1 text-lg font-bold">Create championship</h2>
          <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">Step {step + 1} of {STEPS.length}</p>
          <Stepper current={step} steps={STEPS} />
          <p className="mt-6 text-xs text-slate-400 dark:text-slate-500">
            {step === 0
              ? 'Pick a shape to start from. Everything it sets can be changed before you open registration.'
              : step === 1
                ? 'Saved as a draft so you can configure sports, venues and invites before opening registration.'
                : 'Everything you add here saves instantly. You can revisit any of this later from the championship tabs.'}
          </p>
        </Card>

        {step === 0 ? (
          <Card className="p-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Choose a structure</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              A template fills in the sports, disciplines, formats and scoring for a shape of event. Hover a card to
              see exactly what it will set up - and you can change any of it afterwards.
            </p>
            <div className="mt-5">
              <TemplateGallery
                templates={templates}
                loading={templatesLoading}
                value={templateId}
                onChange={(id) => {
                  setTemplateId(id);
                  const picked = templates.find((t) => t.id === id);
                  if (picked?.shape?.type) setType(picked.shape.type as ChampionshipType);
                }}
                onDelete={async (t) => {
                  const ok = await confirmDialog({
                    title: `Delete "${t.name}"?`,
                    message: 'Championships already created from it are untouched - only the saved shape goes.',
                    confirmLabel: 'Delete template', tone: 'danger',
                  });
                  if (!ok) return;
                  try {
                    await api('DELETE', `/championship-templates/${t.id}`);
                    if (templateId === t.id) setTemplateId(null);
                    await refetchTemplates();
                    toast.success('Template deleted');
                  } catch (e: any) { toast.error(e.message ?? 'Could not delete the template'); }
                }}
              />
            </div>
            <div className="mt-6 flex justify-end">
              <Button onClick={() => setStep(1)}>Continue →</Button>
            </div>
          </Card>
        ) : step === 1 ? (
          <Card className="p-6">
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Tell us about the championship</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">The basics - you can edit all of this later in settings.</p>
            <form onSubmit={createDraft} className="mt-6">
              <Field label="Championship name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Genesis Sports Fest '26" required />
              </Field>
              <Field label="URL slug" hint={`sportagon.app/${effectiveSlug || 'your-championship'}`}>
                <Input value={effectiveSlug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} placeholder="genesis-26" required />
              </Field>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Field label="Start date"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></Field>
                <Field label="End date"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required /></Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Host city" hint="Required - used as your championship's default venue."><Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Mumbai" required /></Field>
                {/* Drives the region filter in Discover. Free text with suggestions:
                    a country we can't place is grouped as Unspecified, never hidden. */}
                <Field label="Country" hint="Used to group this championship by region in Discover.">
                  <Input list="semp-countries" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="India" />
                  <datalist id="semp-countries">
                    {KNOWN_COUNTRIES.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </Field>
              </div>
              <Field label="Description"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A short summary of the championship…" /></Field>
              {/* Optional on purpose (J2-E1-S2): it drives the list column, the
                  filters and later the reports, none of which are worth a made-up
                  answer from someone who doesn't have one. */}
              <Field label="Type" hint="Optional. Used to filter the championships list and group reports.">
                <Select value={type} onChange={(e) => setType(e.target.value as ChampionshipType | '')}>
                  <option value="">- not set -</option>
                  {CHAMPIONSHIP_TYPE.map((t) => <option key={t} value={t}>{CHAMPIONSHIP_TYPE_LABELS[t]}</option>)}
                </Select>
              </Field>
              <Field label="Visibility" hint={visibility === 'private'
                ? 'Hidden from Discover - organizations can only join through your invitations.'
                : 'Listed in Discover so any organization can find it and apply.'}>
                <Pills value={visibility} onChange={(v) => setVisibility(v as 'public' | 'private')} options={[
                  { value: 'public', label: 'Public' },
                  { value: 'private', label: 'Private (invite-only)' },
                ]} ariaLabel="Championship visibility" />
              </Field>
              {error && <p className="mb-3 rounded-lg bg-rose-50 dark:bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => navigate('/championships')}>Cancel</Button>
                <Button type="submit" disabled={savingDraft}>{savingDraft ? 'Saving…' : eventId ? 'Save & continue →' : 'Create draft & continue →'}</Button>
              </div>
            </form>
          </Card>
        ) : !eventId ? (
          <Card className="p-6"><Spinner /></Card>
        ) : (
          <Card className="p-6">
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{STEPS[step]}</h1>
            <div className="mt-6">
              {step === 2 && (
                <>
                  {/* What the template actually did, so the organiser can see the
                      sports below arrived by design rather than by accident. */}
                  {applied && (applied.sports_added > 0 || applied.disciplines_added > 0) && (
                    <p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">
                      Template applied: <b>{applied.sports_added} sport{applied.sports_added === 1 ? '' : 's'}</b>
                      {applied.disciplines_added > 0 && <> and <b>{applied.disciplines_added} discipline{applied.disciplines_added === 1 ? '' : 's'}</b></>}
                      {' '}added. Change anything you like below.
                    </p>
                  )}
                  <SportsTab eventId={eventId} />
                </>
              )}
              {step === 3 && <InvitePanel eventId={eventId} />}
              {step === 4 && <ReviewStep eventId={eventId} championshipName={name} />}
            </div>

            <WizardFooter
              onBack={() => setStep((s) => Math.max(0, s - 1))}
              right={step < LAST_STEP ? (
                <Button onClick={() => setStep((s) => s + 1)}>Next →</Button>
              ) : (
                <>
                  <Button variant="ghost" onClick={() => finish(false)}>Save as draft</Button>
                  <Button onClick={() => finish(true)} disabled={openReg.isPending}>{openReg.isPending ? 'Opening…' : 'Open registration →'}</Button>
                </>
              )}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function WizardFooter({ onBack, right }: { onBack: () => void; right: ReactNode }) {
  return (
    <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
      <Button variant="ghost" onClick={onBack}>← Back</Button>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  );
}

// Final step - a quick count of what's been configured before going live, and the
// offer to keep this shape for next time.
function ReviewStep({ eventId, championshipName }: { eventId: string; championshipName?: string }) {
  const { data: draws = [] } = useApi<any[]>(`/championships/${eventId}/draws`);
  const { data: invites = [] } = useApi<any[]>(`/championships/${eventId}/invitations`);

  const sportCount = new Set(draws.map((d: any) => d.tournament_sports?.sport_id).filter(Boolean)).size;
  const rows = [
    { label: 'Sports', value: sportCount },
    { label: 'Disciplines', value: draws.length },
    { label: 'Invitations sent', value: invites.length },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">Your championship is saved as a draft. Open registration to let invited organizations apply.</p>
      <div className="grid grid-cols-3 gap-3">
        {rows.map((r) => (
          <div key={r.label} className="rounded-xl border border-slate-200 p-4 text-center dark:border-slate-800">
            <div className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">{r.value}</div>
            <div className="mt-0.5 text-xs font-medium uppercase tracking-wide text-slate-400">{r.label}</div>
          </div>
        ))}
      </div>
      <SaveAsTemplate eventId={eventId} championshipName={championshipName} />
    </div>
  );
}
