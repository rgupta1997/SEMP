import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useApiMutation } from '../../lib/hooks';
import type { ChampionshipTemplate } from '@semp/shared';
import { ENTRY_LEVEL_META, ENTRY_LEVELS, isIntraLevel, type EntryLevel } from '@semp/shared';
import { useOrgUnits } from '../../lib/units';
import { BackButton, Button, Card, Field, Input, Pills, Select, Spinner, Stepper, Textarea, cn, confirmDialog, toast } from '../../components/ui';
import { useWorkspace } from '../../lib/useWorkspace';
import { SportsTab } from './setup/SportsTab';
import { TemplateGallery } from './TemplateGallery';
import { SaveAsTemplate } from './SaveAsTemplate';
import { InvitePanel } from '../../components/InvitePanel';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Venue + a separate "Seasons" step are gone: the city captured below doubles as the
// venue, and a default season is auto-created with the championship, so the organiser
// goes straight from the profile to adding sports.
//
// Step 0 is the template picker. An organiser configuring six sports from an empty
// form is the thing it exists to stop happening - and the library is theirs as much
// as ours: anything saved from an event they have already run appears above the
// built-ins.
const STEPS = ['Shape', 'Championship profile', 'Sports & disciplines', 'Invite organizations', 'Open registration'];
const LAST_STEP = STEPS.length - 1;

export function CreateEventWizard() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [step, setStep] = useState(0);
  const [eventId, setEventId] = useState<string | null>(null);

  // Step 0 - the shape to start from. null means "from scratch", and nothing is
  // preselected: guessing which of somebody's own saved templates they want would be
  // presumptuous, and the empty choice is a legitimate answer.
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
  const [error, setError] = useState<string | null>(null);

  // Who is hosting. An event is hosted BY an organisation, and that decides whose
  // name is on its certificates - so when the answer is ambiguous it is asked
  // rather than guessed. Somebody who administers exactly one institution is not
  // asked at all; the server infers it, and a question with one answer is a
  // question not worth putting on the screen.
  const ws = useWorkspace();
  const hostable = ws.contexts.filter(
    (c) => c.kind === 'org' && c.roleCodes.some((r) => r === 'owner' || r === 'org_admin'),
  );
  const [hostOrgId, setHostOrgId] = useState<string>('');

  // WHAT COMPETES. Asked here rather than inferred, because it cannot be inferred:
  // the same organisation runs open inter-college meets AND its own inter-campus
  // league, and only the organiser knows which this one is. It is also the single
  // hardest thing to change afterwards - every entry, team and standings row is
  // keyed on it - so it belongs on the create form, not in settings.
  const [entryLevel, setEntryLevel] = useState<EntryLevel>('organization');
  const [scopeUnitId, setScopeUnitId] = useState<string>('');
  // Defaulted ON: a host running an open championship is usually in it. The cost of
  // the wrong default is one unticked box either way, and this is the direction that
  // saves the commoner mistake.
  const [hostParticipates, setHostParticipates] = useState(true);

  // The host is the sole administered organisation when there is only one, and the
  // explicit choice when there are several. Either way it is what the structure is
  // read from - an intra event competes among the HOST's campuses.
  const resolvedHostId = hostable.length > 1 ? hostOrgId : hostable[0]?.id ?? '';
  // Fetched for the host REGARDLESS of the level currently selected.
  //
  // Conditioning this on `isIntraLevel(entryLevel)` deadlocked the form: the level
  // starts at 'organization', so nothing was fetched, so `campuses` was empty, so
  // both intra options rendered disabled with "no campus exists yet" - and there was
  // no way to select one to trigger the fetch. The options that describe the
  // structure cannot depend on having already chosen one of them.
  const { units, labels, campuses, isLoading: unitsLoading } = useOrgUnits(resolvedHostId || null);

  // Only ACTIVE units can be entered - the server's entrant list excludes SETUP and
  // ARCHIVED ones. Counting them here would offer a level whose entrant screen then
  // came back empty, which reads as a broken event rather than as an unbuilt one.
  const activeCampuses = campuses.filter((c) => c.status === 'ACTIVE');
  const activeDepartments = units.flatMap((c) => (c.children ?? []).filter((d) => d.status === 'ACTIVE'));

  const effectiveSlug = slugTouched ? slug : slugify(name);

  const create = useApiMutation((body: any) => api('POST', '/championships', body), ['/championships']);
  const update = useApiMutation((body: any) => api('PATCH', `/championships/${eventId}`, body), ['/championships']);
  const openReg = useApiMutation(
    () => api('PATCH', `/championships/${eventId}/status`, { status: 'registration_open' }),
    // See the note in EventLayout - the sidebar's nav is derived from `mine`, so a
    // status change that does not refresh it leaves the event stuck on its draft nav.
    ['/championships', '/championships/mine'],
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
      start_date: startDate, end_date: endDate, visibility,
      // Sent only when there was a choice to make. Omitted, the server infers it
      // from a sole administered organisation, or leaves it null for an individual.
      ...(hostable.length > 1 ? { host_organization_id: hostOrgId || null } : {}),
      entry_level: entryLevel,
      // Only a department-level event can be confined to one campus; the server
      // refuses a scope on any other level rather than ignoring it.
      entry_scope_unit_id: entryLevel === 'department' && scopeUnitId ? scopeUnitId : null,
      host_participates: entryLevel === 'organization' ? hostParticipates : false,
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
          // Applied to the draft that now exists - a template needs something to
          // apply to. A failure here is worth saying out loud but must not strand
          // anybody: the championship is created either way, and every sport it
          // would have added can be added by hand on the very next step.
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
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Choose a structure</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              A template fills in the sports, disciplines, formats and scoring for a shape of event. Hover a card to
              see exactly what it will set up - and you can change any of it afterwards.
            </p>
            <div className="mt-5">
              <TemplateGallery
                templates={templates}
                loading={templatesLoading}
                value={templateId}
                onChange={setTemplateId}
                onDelete={async (t) => {
                  const ok = await confirmDialog({
                    title: `Delete "${t.name}"?`,
                    message: 'Championships already created from it are untouched - only the saved shape goes.',
                    confirmLabel: 'Delete template',
                    tone: 'danger',
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
              <Field label="Host city" hint="Required - used as your championship's default venue."><Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Mumbai" required /></Field>
              {hostable.length > 1 && (
                <Field
                  label="Hosted by"
                  hint="Whose event this is. It decides which organisation's name and signature go on its certificates."
                >
                  <Select value={hostOrgId} onChange={(e) => setHostOrgId(e.target.value)}>
                    <option value="">Just me — no organisation</option>
                    {hostable.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </Select>
                </Field>
              )}
              <Field
                label="Who competes"
                hint={ENTRY_LEVEL_META[entryLevel].description}
              >
                <div className="grid gap-2">
                  {ENTRY_LEVELS.map((lvl) => {
                    const meta = ENTRY_LEVEL_META[lvl];
                    const needsHost = meta.intra && !resolvedHostId;
                    // While the structure is still loading nothing is known yet, so
                    // the option is disabled WITHOUT the "none exists" explanation -
                    // saying that before the answer has arrived is simply wrong.
                    const loading = meta.intra && !!resolvedHostId && unitsLoading;
                    const noUnits = meta.intra && !!resolvedHostId && !unitsLoading
                      && (lvl === 'campus' ? activeCampuses.length === 0 : activeDepartments.length === 0);
                    const disabled = needsHost || loading || noUnits;
                    return (
                      <label
                        key={lvl}
                        className={cn(
                          'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13.5px] transition',
                          entryLevel === lvl
                            ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/25'
                            : 'border-slate-200 dark:border-slate-800',
                          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                        )}
                      >
                        <input
                          type="radio"
                          name="entry_level"
                          className="mt-0.5 accent-brand-600"
                          checked={entryLevel === lvl}
                          disabled={disabled}
                          onChange={() => { setEntryLevel(lvl); setScopeUnitId(''); }}
                        />
                        <span className="min-w-0">
                          <span className="block font-medium text-slate-800 dark:text-slate-100">
                            {meta.intra && resolvedHostId
                              ? `Between ${(lvl === 'campus' ? labels.campus : labels.department).toLowerCase()}s`
                              : meta.label}
                          </span>
                          <span className="block text-[12.5px] text-slate-500 dark:text-slate-400">
                            {/* A disabled option says WHY, or it reads as broken. */}
                            {needsHost
                              ? 'Pick a hosting organisation first — an internal championship runs inside one.'
                              : loading
                                ? 'Checking your structure…'
                                : noUnits
                                  ? `No active ${(lvl === 'campus' ? labels.campus : labels.department).toLowerCase()} yet. Add one — or set an existing one to Active — under the organisation's Campuses & Units screen.`
                                  : meta.description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </Field>

              {/* Only for an open event. An internal one has no organisation-level
                  entrants - its competitors are this organisation's own campuses. */}
              {entryLevel === 'organization' && !!resolvedHostId && (
                <Field
                  label="Your own participation"
                  hint="Whether the hosting organisation is competing as well as running it."
                >
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-[13.5px] dark:border-slate-800">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-brand-600"
                      checked={hostParticipates}
                      onChange={(e) => setHostParticipates(e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium text-slate-800 dark:text-slate-100">
                        Take part in this championship too
                      </span>
                      <span className="block text-[12.5px] text-slate-500 dark:text-slate-400">
                        Enters your organisation automatically, already approved, so your teams can be
                        added straight away. Leave it unticked if you are only running the event.
                      </span>
                    </span>
                  </label>
                </Field>
              )}

              {entryLevel === 'department' && activeCampuses.length > 0 && (
                <Field
                  label={`Limit to one ${labels.campus.toLowerCase()}`}
                  hint={`Leave this open and every ${labels.department.toLowerCase()} in the organisation may enter.`}
                >
                  <Select value={scopeUnitId} onChange={(e) => setScopeUnitId(e.target.value)}>
                    <option value="">
                      Every {labels.department.toLowerCase()} in the organisation
                    </option>
                    {activeCampuses.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </Field>
              )}

              <Field label="Description"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A short summary of the championship…" /></Field>
              {/* An internal championship has no outside audience to advertise to -
                  its entrants are the host's own campuses, and they are entered
                  rather than applying. Offering Public would list it in a Discover
                  feed where nobody who saw it could take part. */}
              {!isIntraLevel(entryLevel) && (
                <Field label="Visibility" hint={visibility === 'private'
                  ? 'Hidden from Discover - organizations can only join through your invitations.'
                  : 'Listed in Discover so any organization can find it and apply.'}>
                  <Pills value={visibility} onChange={(v) => setVisibility(v as 'public' | 'private')} options={[
                    { value: 'public', label: 'Public' },
                    { value: 'private', label: 'Private (invite-only)' },
                  ]} ariaLabel="Championship visibility" />
                </Field>
              )}
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
                  {/* What the template actually did, so the sports below read as
                      arriving by design rather than by accident. */}
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
