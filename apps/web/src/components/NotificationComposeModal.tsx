import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NotificationAudience } from '@semp/shared';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import type { PostableEvent } from '../lib/notifications';
import { Button, Field, Input, Modal, Segmented, Spinner, Textarea, toast } from './ui';

// Compose + push a manual notification. Available to anyone the API lets post
// (organisers / officials / captains / POCs) — the event dropdown is filled from
// /notifications/postable-events, so it's empty (and this modal isn't reachable)
// for read-only users.
export function NotificationComposeModal({ onClose, defaultEventId }: { onClose: () => void; defaultEventId?: string }) {
  const qc = useQueryClient();
  const { data: events = [], isLoading } = useApi<PostableEvent[]>('/notifications/postable-events');
  const [eventId, setEventId] = useState(defaultEventId ?? '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<NotificationAudience>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const chosen = eventId || (events.length === 1 ? events[0].id : '');
    if (!chosen) { setError('Pick an event'); return; }
    if (!title.trim()) { setError('A title is required'); return; }
    setBusy(true);
    try {
      await api('POST', '/notifications', {
        event_id: chosen, title: title.trim(), body: body.trim() || undefined, audience,
      });
      qc.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/notifications'),
      });
      toast.success('Notification sent');
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not send');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New notification" onClose={onClose}>
      {isLoading ? <Spinner /> : events.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">You don't have any events you can post to.</p>
      ) : (
        <>
          <Field label="Event">
            <select
              value={eventId || (events.length === 1 ? events[0].id : '')}
              onChange={(e) => setEventId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {events.length !== 1 && <option value="">Select an event…</option>}
              {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
            </select>
          </Field>

          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Schedule update" maxLength={200} />
          </Field>

          <Field label="Message" hint="Optional details.">
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="w-full" placeholder="What do you want people to know?" />
          </Field>

          <Field label="Audience" hint="Who should receive this notification.">
            <Segmented<NotificationAudience>
              value={audience}
              onChange={setAudience}
              options={[
                { value: 'all', label: 'All event users' },
                { value: 'institutions_captains', label: 'Institutions + captains' },
              ]}
            />
          </Field>

          {error && <p className="mt-1 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Send'}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
