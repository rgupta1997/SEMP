import { useState } from 'react';
import { Link2, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { publicUrl } from '../lib/native';
import { PILL_BTN, cn, toast } from './ui';
import { LockMark, useEventPlan } from '../lib/eventPlan';

// Fetches the championship's view-only share token and copies the public link
// (`<origin>/c/<token>`) to the clipboard. Organiser-only (the endpoint is guarded).
export function SharePublicLink({ eventId, className }: { eventId: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const shareOk = useEventPlan(eventId).has('share_links');
  const share = async () => {
    setBusy(true);
    try {
      const { token } = await api<{ token: string }>('GET', `/championships/${eventId}/share-link`);
      const url = publicUrl(`/c/${token}`);
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Public link copied', url);
      } catch {
        // Clipboard blocked (e.g. insecure context) - still surface the link to copy by hand.
        toast.info('Public link', url);
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not create share link');
    } finally {
      setBusy(false);
    }
  };
  return (
    // Same label while copying (a spinner replaces the icon), so the button never resizes.
    <button type="button" disabled={busy || !shareOk} onClick={share} className={cn(PILL_BTN, className)} aria-busy={busy}
      title={shareOk ? 'Share a read-only link (Overview, Schedule, Results & Standings) with anyone.' : 'Public share links are not on this event’s plan'}>
      {!shareOk ? <LockMark capability="share_links" /> : busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Link2 size={13} aria-hidden />}
      <span>Copy <span className="max-[379px]:hidden">public </span>link</span>
    </button>
  );
}
