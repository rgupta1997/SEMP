import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, Modal, Toggle } from './ui';

export interface InstitutionFormBody {
  name: string;
  short_name?: string;
  code?: string;
  city?: string;
  country?: string;
  logo_url?: string;
  status?: boolean;
  owner?: { name: string; email: string; phone?: string; password?: string };
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

  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError('Organization name is required'); return; }
    const body: InstitutionFormBody = {
      name: name.trim(),
      short_name: shortName.trim() || undefined,
      code: code.trim() || undefined,
      city: city.trim() || undefined,
      country: country.trim() || 'India',
    };
    if (!isEdit && withPoc) {
      if (!pocName.trim() || !pocEmail.trim()) { setError('Point-of-contact name and email are required'); return; }
      body.owner = {
        name: pocName.trim(),
        email: pocEmail.trim(),
        phone: pocPhone.trim() || undefined,
        password: pocPassword || undefined,
      };
    }
    setBusy(true);
    try {
      await onSubmit(body);
      qc.invalidateQueries(); // refresh organization lists
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit organization' : 'Add organization'} onClose={onClose} wide>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VJTI" /></Field>
        <Field label="Short name"><Input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="Optional" /></Field>
        <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Optional" /></Field>
        <Field label="City"><Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Optional" /></Field>
        <Field label="Country"><Input value={country} onChange={(e) => setCountry(e.target.value)} /></Field>
      </div>

      {!isEdit && (
        <div className="mt-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Assign a point of contact</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Creates an organization login that can manage this organization's teams.</div>
            </div>
            <Toggle checked={withPoc} onChange={setWithPoc} />
          </div>
          {withPoc && (
            <div className="mt-4 grid gap-x-4 sm:grid-cols-2">
              <Field label="POC name"><Input value={pocName} onChange={(e) => setPocName(e.target.value)} /></Field>
              <Field label="POC email"><Input type="email" value={pocEmail} onChange={(e) => setPocEmail(e.target.value)} /></Field>
              <Field label="POC phone"><Input value={pocPhone} onChange={(e) => setPocPhone(e.target.value)} placeholder="Optional" /></Field>
              <Field label="Password" hint="Blank = default (demo123).">
                <div className="flex gap-2">
                  <Input value={pocPassword} onChange={(e) => setPocPassword(e.target.value)} placeholder="Optional" />
                  <Button type="button" variant="outline" onClick={() => setPocPassword(generatePassword())}>Generate</Button>
                </div>
              </Field>
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
