import { useState } from 'react';
import { suggestShort } from '../lib/format';
import { useQueryClient } from '@tanstack/react-query';
import { BRAND } from '../lib/brand';
import { AlertCircle, Check, Globe, Landmark, MapPin } from 'lucide-react';
import { Button, Field, Input, Modal, Toggle, cn } from './ui';
import { TeamAvatar } from '../features/schedule/ScheduleParts';
import { PERSONAL_NAVY, PILL_BRAND, PILL_TEAL } from '../features/personal/styles';
import { CredentialsPanel, PhoneLookupNotice, useUserLookup, type Credentials } from './userProvisioning';

export interface InstitutionFormBody {
  name: string;
  short_name?: string;
  code?: string;
  city?: string;
  country?: string;
  logo_url?: string;
  status?: boolean;
  owner?: { user_id?: string; name?: string; email?: string; phone?: string; password?: string };
}

interface InstitutionFormModalProps {
  mode?: 'create' | 'edit';
  initial?: Partial<InstitutionFormBody>;
  onClose: () => void;
  onSubmit: (body: InstitutionFormBody) => Promise<unknown>;
  /** Teal and navy in the personal workspace; brand blue where an org or the platform opens it. */
  accent?: 'teal' | 'brand';
}

function generatePassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// Hidden, not removed: the creator becomes the org's POC/owner by default, so
// asking for a second one up front was a step nobody used. Flip back to true to
// bring the toggle back.
const SHOW_POC_ASSIGNMENT = false;
// Hidden, not removed: organisers didn't know what to put here at creation time.
// Still accepted by the API for whoever sets it later.
const SHOW_CODE_FIELD = false;

export function InstitutionFormModal({ mode = 'create', initial, onClose, onSubmit, accent = 'brand' }: InstitutionFormModalProps) {
  const qc = useQueryClient();
  const isEdit = mode === 'edit';
  const [name, setName] = useState(initial?.name ?? '');
  const [shortName, setShortName] = useState(initial?.short_name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [country, setCountry] = useState(initial?.country ?? 'India');
  const [withPoc, setWithPoc] = useState(false);
  const [pocName, setPocName] = useState('');
  const [pocEmail, setPocEmail] = useState('');
  const [pocPhone, setPocPhone] = useState('');
  const [pocPassword, setPocPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The suggestion follows the name until somebody types their own - see
  // `suggestShort`. Existing institutions open with their stored value and are
  // therefore already "touched".
  const [shortTouched, setShortTouched] = useState(!!initial?.short_name);
  const [creds, setCreds] = useState<Credentials | null>(null);
  const { found } = useUserLookup(pocPhone);

  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError('Organization name is required'); return; }
    // City plus name is the uniqueness key the server checks on CREATE (two orgs of
    // the same name in different cities are fine; the same city is what makes it a
    // duplicate). Only enforced there - an existing organization predating this
    // rule can still have its other fields edited without being forced to backfill
    // a city first.
    if (!isEdit && !city.trim()) { setError('City is required'); return; }
    // Not something a person has to consciously fill in - it follows the name via
    // suggestShort() unless they typed their own - so a blank value falls back to a
    // fresh suggestion here rather than blocking Save. The server keeps the real
    // minimum-length rule.
    const resolvedShortName = shortName.trim() || suggestShort(name);
    const body: InstitutionFormBody = {
      name: name.trim(),
      short_name: resolvedShortName.trim().toUpperCase(),
      code: code.trim() || undefined,
      city: city.trim() || undefined,
      country: country.trim() || 'India',
    };
    if (!isEdit && withPoc) {
      if (found) {
        body.owner = { user_id: found.id, phone: pocPhone.trim() || undefined };
      } else {
        if (!pocName.trim() || !pocEmail.trim()) { setError('Point-of-contact name and email are required'); return; }
        body.owner = {
          name: pocName.trim(),
          email: pocEmail.trim(),
          phone: pocPhone.trim() || undefined,
          password: pocPassword || undefined,
        };
      }
    }
    setBusy(true);
    try {
      const result: any = await onSubmit(body);
      qc.invalidateQueries(); // refresh organization lists
      // If a new POC login was provisioned, surface its credentials to copy/share.
      if (result?.poc_credentials) setCreds(result.poc_credentials);
      else onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  if (creds) {
    return (
      <Modal title="Organization created" onClose={onClose} wide>
        <CredentialsPanel creds={creds} onDone={onClose} />
      </Modal>
    );
  }

  const teal = accent === 'teal';
  const PRIMARY = teal ? PILL_TEAL : PILL_BRAND;
  const GHOST = 'inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-bold text-slate-600 ring-1 ring-slate-200 transition hover:text-slate-900 dark:text-slate-300 dark:ring-slate-700';
  const FIELD = cn('w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-[3px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
    teal ? 'focus:border-[var(--accent-deep)] focus:ring-[var(--accent)]/25' : 'focus:border-brand-500 focus:ring-brand-500/20');
  const LABEL = 'mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-300';
  const previewShort = (shortName.trim() || suggestShort(name) || 'ORG').toUpperCase();

  return (
    <Modal
      title={isEdit ? 'Edit organization' : 'Add organization'}
      onClose={onClose}
      wide
      bannerTone={teal ? PERSONAL_NAVY : undefined}
      banner={(
        <span className="flex min-w-0 items-center gap-3 text-white">
          <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', teal ? 'bg-[var(--accent)] text-slate-950' : 'bg-white/15 text-white')}><Landmark size={17} aria-hidden /></span>
          <span className="min-w-0">
            <span className="block text-base font-black leading-tight">{isEdit ? 'Edit organization' : 'Create an organization'}</span>
            <span className="block text-xs text-white/60">{isEdit ? 'Name, short name and where it is.' : 'Enter teams and run events under it. You become its owner.'}</span>
          </span>
        </span>
      )}
      footer={(
        <div className="flex w-full justify-end gap-2">
          <button type="button" onClick={onClose} className={GHOST}>Cancel</button>
          <button type="button" disabled={busy} onClick={submit} className={cn(PRIMARY, 'disabled:opacity-60')}>
            <Check size={14} aria-hidden />{busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Create organization')}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        {/* How it will show on standings, certificates and phone screens, as it is typed. */}
        <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3 dark:bg-slate-800/50">
          <TeamAvatar name={name || 'Organization'} short={previewShort} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">{name.trim() || 'Your organization'}</span>
            <span className="flex items-center gap-1 truncate text-xs text-slate-500 dark:text-slate-400"><MapPin size={12} aria-hidden />{[city.trim(), country.trim()].filter(Boolean).join(', ') || 'City, Country'}</span>
          </span>
          <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Preview</span>
        </div>

        <label className="block">
          <span className={LABEL}>Name</span>
          <input value={name} placeholder="e.g. Veermata Jijabai Technological Institute" className={FIELD}
            onChange={(e) => { setName(e.target.value); if (!shortTouched) setShortName(suggestShort(e.target.value)); }} />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="flex items-baseline justify-between"><span className={LABEL}>Short name</span><span className="text-[11px] font-semibold tabular-nums text-slate-400">{shortName.length}/12</span></span>
            <input value={shortName} placeholder="VJTI" maxLength={12} className={cn(FIELD, 'font-mono uppercase tracking-wide')}
              onChange={(e) => { setShortTouched(true); setShortName(e.target.value.toUpperCase().slice(0, 12)); }} />
            <span className="mt-1 block text-[11.5px] text-slate-500 dark:text-slate-400">Shown on standings, certificates and phone screens.</span>
          </label>
          {SHOW_CODE_FIELD && (
            <label className="block"><span className={LABEL}>Code</span><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Optional" className={FIELD} /></label>
          )}
          <label className="block">
            <span className={LABEL}>City{isEdit ? '' : ' *'}</span>
            <span className="relative block">
              <MapPin size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Mumbai" className={cn(FIELD, 'pl-9')} />
            </span>
          </label>
          <label className="block">
            <span className={LABEL}>Country</span>
            <span className="relative block">
              <Globe size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
              <input value={country} onChange={(e) => setCountry(e.target.value)} className={cn(FIELD, 'pl-9')} />
            </span>
          </label>
        </div>

        {!isEdit && SHOW_POC_ASSIGNMENT && (
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Assign a point of contact</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Enter the POC's phone - we reuse their login if they're already on {BRAND.name}, otherwise we create one.</div>
              </div>
              <Toggle checked={withPoc} onChange={setWithPoc} />
            </div>
            {!withPoc && (
              <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                No point of contact assigned - you'll be set as this organization's POC and owner. You can hand it off later from the Members page.
              </p>
            )}
            {withPoc && (
              <div className="mt-4 space-y-1">
                <Field label="POC phone"><Input value={pocPhone} onChange={(e) => setPocPhone(e.target.value)} placeholder="+91 …" /></Field>
                <PhoneLookupNotice phone={pocPhone} />
                {!found && (
                  <div className="grid gap-x-4 pt-2 sm:grid-cols-2">
                    <Field label="POC name"><Input value={pocName} onChange={(e) => setPocName(e.target.value)} /></Field>
                    <Field label="POC email"><Input type="email" value={pocEmail} onChange={(e) => setPocEmail(e.target.value)} /></Field>
                    <Field label="Password" hint="Blank = a temporary one to share.">
                      <div className="flex gap-2">
                        <Input value={pocPassword} onChange={(e) => setPocPassword(e.target.value)} placeholder="Optional" />
                        <Button type="button" variant="outline" onClick={() => setPocPassword(generatePassword())}>Generate</Button>
                      </div>
                    </Field>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {error && <p className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"><AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />{error}</p>}
      </div>
    </Modal>
  );
}
