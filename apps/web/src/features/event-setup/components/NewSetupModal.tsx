import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { SETUP_EVENT_TYPE_INFO, SETUP_EVENT_TYPES, type SetupEventType } from '@semp/shared';
import { Button, cn, Field, Input, Modal, toast } from '../../../components/ui';
import { eventSetupApi, useSetupCache } from '../api';
import { FOCUS_RING } from './pills';

export function NewSetupModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { put } = useSetupCache();
  const [label, setLabel] = useState('');
  const [type, setType] = useState<SetupEventType | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = label.trim().length > 0 && type !== null;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const created = await eventSetupApi.create({ label: label.trim(), event_type: type });
      put(created);
      onClose();
      navigate(`/platform/event-setup/${created.id}`);
    } catch (e) {
      toast.error('Could not create the setup', (e as Error)?.message ?? 'Try again.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New event setup"
      onClose={onClose}
      dismissible={!busy}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className={FOCUS_RING} onClick={onClose} disabled={busy}>Cancel</Button>
          <Button className={FOCUS_RING} onClick={submit} disabled={!ready || busy}>
            {busy ? 'Creating…' : 'Create setup'}
          </Button>
        </div>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Label" hint="How this setup appears in the list, e.g. the client and the event.">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="WNS Football 2026"
            autoFocus
            maxLength={120}
            className="w-full"
          />
        </Field>

        <fieldset>
          <legend className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Event type</legend>
          <p className="t-meta mb-2">Decides the template and who competes. It cannot be changed later.</p>
          <div role="radiogroup" aria-label="Event type" className="flex flex-col gap-2">
            {SETUP_EVENT_TYPES.map((t) => {
              const info = SETUP_EVENT_TYPE_INFO[t];
              const active = type === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setType(t)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors',
                    FOCUS_RING,
                    active
                      ? 'border-brand-600 bg-brand-50 dark:border-brand-500 dark:bg-brand-500/10'
                      : 'border-eos-line bg-white hover:border-brand-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-brand-500/50',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border',
                      active ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-slate-600',
                    )}
                    aria-hidden
                  >
                    {active && <Check size={12} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">{info.label}</span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-slate-500 dark:text-slate-400">{info.blurb}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        {/* Enter in the label field submits. */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
