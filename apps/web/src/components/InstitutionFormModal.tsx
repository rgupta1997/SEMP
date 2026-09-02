import { useState } from 'react';
import { suggestShort } from '../lib/format';
import { useQueryClient } from '@tanstack/react-query';
import { BRAND } from '../lib/brand';
import { Button, Field, Input, Modal, Toggle } from './ui';
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

export function InstitutionFormModal({ mode = 'create', initial, onClose, onSubmit }: InstitutionFormModalProps) {
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

  return (
    <Modal title={isEdit ? 'Edit organization' : 'Add organization'} onClose={onClose} wide>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!shortTouched) setShortName(suggestShort(e.target.value));
            }}
            placeholder="e.g. VJTI"
          />
        </Field>
        <Field label="Short name" hint="Shown on standings, certificates and phone screens.">
          <Input
            value={shortName}
            onChange={(e) => { setShortTouched(true); setShortName(e.target.value.toUpperCase().slice(0, 12)); }}
            placeholder="NIT"
            maxLength={12}
            className="font-mono uppercase tracking-wide"
          />
        </Field>
        {SHOW_CODE_FIELD && (
          <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Optional" /></Field>
        )}
        <Field label={isEdit ? 'City' : 'City *'}><Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Mumbai" /></Field>
        <Field label="Country"><Input value={country} onChange={(e) => setCountry(e.target.value)} /></Field>
      </div>

      {!isEdit && SHOW_POC_ASSIGNMENT && (
        <div className="mt-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
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

      {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={submit}>{busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Create organization')}</Button>
      </div>
    </Modal>
  );
}
