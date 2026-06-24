import { useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Field, Input, Modal, Textarea, toast } from './ui';

// Floating "Feedback" button + modal, shown on the in-app shell and the public
// championship pages. Posts to the public /feedback endpoint (no auth required; a
// signed-in sender's id is captured server-side). `championshipId`/`context` tag the
// row so admins know where it came from.
export function FeedbackWidget({ championshipId, context }: { championshipId?: string; context?: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!message.trim()) { toast.error('Please write a little feedback first'); return; }
    setSending(true);
    try {
      await api('POST', '/feedback', {
        message: message.trim(),
        email: email.trim() || undefined,
        context: context ?? (typeof window !== 'undefined' ? window.location.pathname : undefined),
        championship_id: championshipId,
      });
      toast.success('Thanks! Your feedback has reached the Sportagon team.');
      setOpen(false); setMessage(''); setEmail('');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not send feedback - please try again');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
        aria-label="Send feedback"
      >
        <MessageSquarePlus size={16} /> Feedback
      </button>

      {open && (
        <Modal
          title="Share your feedback"
          onClose={() => setOpen(false)}
          footer={(
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={sending} onClick={submit}>{sending ? 'Sending…' : 'Send feedback'}</Button>
            </div>
          )}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Spotted a bug or have an idea? Tell us - it goes straight to the Sportagon team.
            </p>
            <Field label="Your feedback">
              <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What's working, what's not, what you'd love to see…" autoFocus />
            </Field>
            <Field label="Email (optional)" hint="Add it if you'd like a reply.">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </Field>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Prefer email? Reach us any time at{' '}
              <a href="mailto:play@sportagon.in" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">play@sportagon.in</a>.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
