import { useMemo, useState } from 'react';
import { AWARD_LEVEL, AWARD_RECIPIENT_KIND } from '@semp/shared';
import { Button, Checkbox, cn, Field, Input, Modal, SearchInput, Textarea, Toggle, toast } from '../../components/ui';
import { codeFromLabel, LEVEL_LABEL, RECIPIENT_LABEL, type AwardType, type AwardTypeBody } from './types';

interface Sport { id: string; name: string }

// Create or edit an award type, including which sports it is offered for. Used by
// the super admin for the global list (and later by organisers for event extras).
export function AwardTypeFormModal({ initial, sports, onClose, onSubmit }: {
  initial?: AwardType;
  sports: Sport[];
  onClose: () => void;
  onSubmit: (body: AwardTypeBody) => Promise<unknown>;
}) {
  const editing = !!initial;
  const [label, setLabel] = useState(initial?.label ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [codeTouched, setCodeTouched] = useState(editing);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [levels, setLevels] = useState<AwardTypeBody['levels']>(initial?.levels ?? ['match']);
  const [recipient, setRecipient] = useState<AwardTypeBody['recipient_kind']>(initial?.recipient_kind ?? 'player');
  const [allSports, setAllSports] = useState(initial?.all_sports ?? false);
  const [sportIds, setSportIds] = useState<Set<string>>(new Set(initial?.sport_ids ?? []));
  const [active, setActive] = useState(initial?.is_active ?? true);
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 100));
  const [sportQuery, setSportQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const shownSports = useMemo(
    () => sports.filter((s) => s.name.toLowerCase().includes(sportQuery.trim().toLowerCase())),
    [sports, sportQuery],
  );

  const effectiveCode = codeTouched ? code : codeFromLabel(label);
  const problem =
    !label.trim() ? 'Give the award a name'
      : !editing && !/^[a-z0-9_]{2,60}$/.test(effectiveCode) ? 'Code: 2-60 lowercase letters, digits or _'
        : levels.length === 0 ? 'Pick at least one level'
          : !allSports && sportIds.size === 0 ? 'Map it to at least one sport, or offer it for all sports'
            : null;

  const toggleLevel = (l: AwardTypeBody['levels'][number]) =>
    setLevels((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : AWARD_LEVEL.filter((x) => x === l || cur.includes(x))));

  const toggleSport = (id: string) => setSportIds((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function save() {
    if (problem) return;
    setSaving(true);
    try {
      await onSubmit({
        ...(editing ? {} : { code: effectiveCode }),
        label: label.trim(),
        description: description.trim() || null,
        levels,
        recipient_kind: recipient,
        is_active: active,
        sort_order: Number(sortOrder) || 0,
        all_sports: allSports,
        sport_ids: allSports ? [] : [...sportIds],
      });
      toast.success(editing ? 'Award type updated' : 'Award type created');
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={editing ? `Edit ${initial!.label}` : 'New award type'}
      onClose={onClose}
      wide
      footer={(
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-500 dark:text-slate-400">{problem ?? ''}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={!!problem || saving}>{saving ? 'Saving…' : editing ? 'Save' : 'Create'}</Button>
          </div>
        </div>
      )}
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Best Raider" maxLength={120} autoFocus />
        </Field>
        <Field label="Code" hint={editing ? 'Fixed once created - reports group on it' : 'Stable key used by reports'}>
          <Input
            value={effectiveCode}
            disabled={editing}
            onChange={(e) => { setCodeTouched(true); setCode(e.target.value); }}
            className="font-mono"
          />
        </Field>
      </div>
      <Field label="Description (optional)">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} className="w-full" />
      </Field>

      <div className="mb-4">
        <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Given at</span>
        <div className="flex flex-wrap gap-2">
          {AWARD_LEVEL.map((l) => (
            <label key={l} className={cn(
              'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm',
              levels.includes(l) ? 'border-brand-400 bg-brand-50 dark:border-brand-500/50 dark:bg-brand-500/10' : 'border-slate-200 dark:border-slate-700',
            )}>
              <Checkbox checked={levels.includes(l)} onChange={() => toggleLevel(l)} />
              <span className="text-slate-700 dark:text-slate-200">{LEVEL_LABEL[l]}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="mb-4 grid gap-x-4 sm:grid-cols-2">
        <div>
          <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Goes to</span>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700" role="radiogroup">
            {AWARD_RECIPIENT_KIND.map((k) => (
              <button
                key={k} type="button" role="radio" aria-checked={recipient === k}
                onClick={() => setRecipient(k)}
                className={cn('rounded-md px-4 py-1.5 text-sm font-medium',
                  recipient === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')}
              >
                {RECIPIENT_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 flex items-end gap-4 sm:mt-0">
          <Field label="Order" compact>
            <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="w-24" />
          </Field>
          <label className="mb-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <Toggle checked={active} onChange={setActive} /> Active
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            <Toggle checked={allSports} onChange={setAllSports} /> All sports
          </label>
          {!allSports && (
            <span className="text-xs text-slate-500 dark:text-slate-400">{sportIds.size} of {sports.length} sports</span>
          )}
        </div>
        {allSports ? (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Offered for every sport, including sports added later.</p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <SearchInput value={sportQuery} onChange={setSportQuery} placeholder="Find a sport…" className="w-48" />
              <Button size="sm" variant="ghost" onClick={() => setSportIds(new Set([...sportIds, ...shownSports.map((s) => s.id)]))}>Select shown</Button>
              <Button size="sm" variant="ghost" onClick={() => setSportIds(new Set())}>Clear</Button>
            </div>
            <div className="mt-2 grid max-h-56 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
              {shownSports.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                  <Checkbox checked={sportIds.has(s.id)} onChange={() => toggleSport(s.id)} />
                  {s.name}
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
