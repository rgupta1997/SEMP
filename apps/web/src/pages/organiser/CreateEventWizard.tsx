import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useApiMutation } from '../../lib/hooks';
import { BackButton, Button, Card, Field, Input, Spinner, Stepper, Textarea, toast } from '../../components/ui';
import { SportsTab } from './setup/SportsTab';
import { InvitePanel } from '../../components/InvitePanel';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Venue + a separate "Seasons" step are gone: the city captured below doubles as the
// venue, and a default season is auto-created with the championship, so the organiser
// goes straight from the profile to adding sports.
const STEPS = ['Championship profile', 'Sports & disciplines', 'Invite organizations', 'Open registration'];
const LAST_STEP = STEPS.length - 1;

export function CreateEventWizard() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [step, setStep] = useState(0);
  const [eventId, setEventId] = useState<string | null>(null);

  // Step 1 — basics
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [venue, setVenue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const effectiveSlug = slugTouched ? slug : slugify(name);

  const create = useApiMutation((body: any) => api('POST', '/championships', body), ['/championships']);
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
    const body = { name, slug: effectiveSlug, venue: venue.trim(), description: description || undefined, start_date: startDate, end_date: endDate };
    if (eventId) {
      update.mutate(body, {
        onSuccess: () => setStep(1),
        onError: (err: any) => setError(err.message ?? 'Could not save championship'),
      });
    } else {
      create.mutate(body, {
        onSuccess: async (ev: any) => { await refresh(); setEventId(ev.id); setStep(1); },
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
              ? 'Saved as a draft so you can configure sports, venues and invites before opening registration.'
              : 'Everything you add here saves instantly. You can revisit any of this later from the championship tabs.'}
          </p>
        </Card>

        {step === 0 ? (
          <Card className="p-6">
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Tell us about the championship</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">The basics — you can edit all of this later in settings.</p>
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
              <Field label="Host city" hint="Required — used as your championship's default venue."><Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Mumbai" required /></Field>
              <Field label="Description"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A short summary of the championship…" /></Field>
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
              {step === 1 && <SportsTab eventId={eventId} />}
              {step === 2 && <InvitePanel eventId={eventId} />}
              {step === 3 && <ReviewStep eventId={eventId} />}
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

// Final step — a quick count of what's been configured before going live.
function ReviewStep({ eventId }: { eventId: string }) {
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
    </div>
  );
}
