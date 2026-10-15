import { useState, type FocusEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isPlaceholderEmail, isPlaceholderPhone } from '@semp/shared';
import { useAuth } from '../lib/auth';
import { Badge, Button, Field, Input, Modal, Select } from './ui';
import { CredentialsPanel, PhoneLookupNotice, type Credentials } from './userProvisioning';

export interface UserFormBody {
  name: string;
  /** Left out of an edit by anyone but a super admin - they may not change it. */
  email?: string;
  phone?: string;
  password?: string;
  organization_id?: string | null;
}

interface UserFormModalProps {
  title?: string;
  mode?: 'create' | 'edit';
  initial?: Partial<UserFormBody>;
  /** Force the organization (hides the selector); use for org-scoped creates. */
  lockInstitutionId?: string | null;
  /** Organizations to choose from; omit to hide the selector. */
  organizations?: { id: string; name: string }[];
  submitLabel?: string;
  onClose: () => void;
  onSubmit: (body: UserFormBody) => Promise<unknown>;
}

// A valid mobile is 10 digits (optionally a country code), matching the phone
// lookup which keys off the last 10 digits.
function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

// Shown under a contact that is still the provisioning stand-in (@semp/shared
// placeholder-contact), so whoever opens the form sees what needs replacing.
function PlaceholderNote({ children }: { children: ReactNode }) {
  return (
    <span className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
      <Badge tone="amber" className="shrink-0 px-2 py-0.5">placeholder</Badge>
      <span>{children}</span>
    </span>
  );
}

// Focusing a stand-in selects it, so typing the real value replaces it outright.
const selectIfPlaceholder = (isPlaceholder: boolean) => (e: FocusEvent<HTMLInputElement>) => {
  if (isPlaceholder) e.currentTarget.select();
};

// Readable random password for provisioned logins.
function generatePassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function UserFormModal({
  title, mode = 'create', initial,
  lockInstitutionId, organizations, submitLabel, onClose, onSubmit,
}: UserFormModalProps) {
  const qc = useQueryClient();
  const { ctx } = useAuth();
  const isEdit = mode === 'edit';
  // Email is the account key: anyone may set it on create, only a super admin may
  // change it afterwards (the API enforces this too - this only hides the control).
  const canEditEmail = !isEdit || !!ctx?.user.is_super_admin;
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [password, setPassword] = useState('');
  const [institutionId, setInstitutionId] = useState(
    lockInstitutionId ?? initial?.organization_id ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<Credentials | null>(null);

  const showInstitution = !lockInstitutionId && organizations !== undefined;

  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError('Name is required'); return; }
    if (canEditEmail && !email.trim()) { setError('Email is required'); return; }
    if (canEditEmail && !/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter a valid email address'); return; }
    if (!phone.trim()) { setError('Phone number is required'); return; }
    if (!isValidPhone(phone)) { setError('Enter a valid mobile number (at least 10 digits)'); return; }
    const body: UserFormBody = { name: name.trim(), phone: phone.trim() };
    if (canEditEmail) body.email = email.trim();
    if (password) body.password = password;
    if (lockInstitutionId) body.organization_id = lockInstitutionId;
    else if (showInstitution) body.organization_id = institutionId || null;
    setBusy(true);
    try {
      const res: any = await onSubmit(body);
      qc.invalidateQueries(); // refresh lists that reference users
      // If a new login was provisioned, surface its credentials to copy/share.
      const c: Credentials | null = res?.temp_password
        ? { name: res.name, email: res.email, phone: res.phone, password: res.temp_password }
        : (res?.poc_credentials ?? null);
      if (c) setCreds(c); else onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  if (creds) {
    return (
      <Modal title={title ?? 'User created'} onClose={onClose}>
        <CredentialsPanel creds={creds} onDone={onClose} />
      </Modal>
    );
  }

  return (
    <Modal title={title ?? (isEdit ? 'Edit user' : 'Add user')} onClose={onClose}>
      <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rohan Kulkarni" /></Field>
      <Field label="Email" hint={canEditEmail ? undefined : 'Only a super admin can change the email.'}>
        <Input type="email" value={email} disabled={!canEditEmail} onChange={(e) => setEmail(e.target.value)}
          onFocus={selectIfPlaceholder(isPlaceholderEmail(email))} placeholder="name@example.com" />
        {isPlaceholderEmail(email) && (
          <PlaceholderNote>
            {canEditEmail
              ? "Stand-in address - mail to it never arrives. Enter the person's real email."
              : 'Stand-in address - mail to it never arrives. A super admin can set the real one.'}
          </PlaceholderNote>
        )}
      </Field>
      <Field label="Phone" hint="Required - 10-digit mobile number">
        <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
          onFocus={selectIfPlaceholder(isPlaceholderPhone(phone))} placeholder="10-digit mobile number" />
        {isPlaceholderPhone(phone) && (
          <PlaceholderNote>Stand-in number - no sign-in code can reach it. Enter their real mobile so they can sign in.</PlaceholderNote>
        )}
      </Field>
      {!isEdit && <PhoneLookupNotice phone={phone} />}
      {showInstitution && (
        <Field label="Organization">
          <Select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)}>
            <option value="">- none -</option>
            {organizations!.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label={isEdit ? 'Reset password (optional)' : 'Password'} hint={isEdit ? 'Leave blank to keep the current password.' : 'Leave blank to auto-generate a temporary password to share.'}>
        <div className="flex gap-2">
          <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isEdit ? 'New password' : 'Optional'} />
          <Button type="button" variant="outline" onClick={() => setPassword(generatePassword())}>Generate</Button>
        </div>
      </Field>
      {error && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={submit}>{busy ? 'Saving…' : (submitLabel ?? (isEdit ? 'Save changes' : 'Create user'))}</Button>
      </div>
    </Modal>
  );
}
