import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, Modal, Select } from './ui';

export interface UserFormBody {
  name: string;
  email: string;
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
  const isEdit = mode === 'edit';
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [password, setPassword] = useState('');
  const [institutionId, setInstitutionId] = useState(
    lockInstitutionId ?? initial?.organization_id ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showInstitution = !lockInstitutionId && organizations !== undefined;

  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError('Name is required'); return; }
    if (!isEdit && !email.trim()) { setError('Email is required'); return; }
    const body: UserFormBody = {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
    };
    if (password) body.password = password;
    if (lockInstitutionId) body.organization_id = lockInstitutionId;
    else if (showInstitution) body.organization_id = institutionId || null;
    setBusy(true);
    try {
      await onSubmit(body);
      qc.invalidateQueries(); // refresh lists that reference users
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title ?? (isEdit ? 'Edit user' : 'Add user')} onClose={onClose}>
      <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rohan Kulkarni" /></Field>
      <Field label="Email"><Input type="email" value={email} disabled={isEdit} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></Field>
      <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" /></Field>
      {showInstitution && (
        <Field label="Organization">
          <Select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)}>
            <option value="">— none —</option>
            {organizations!.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label={isEdit ? 'Reset password (optional)' : 'Password'} hint={isEdit ? 'Leave blank to keep the current password.' : 'Leave blank to use the default (demo123).'}>
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
