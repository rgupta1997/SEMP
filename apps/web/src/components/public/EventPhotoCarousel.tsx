import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { EventPhoto } from '@semp/shared';
import { cn } from '../ui';

const AUTO_ADVANCE_MS = 6000;
const SWIPE_PX = 40;

// Event photos on the public Overview: swipe or arrows, auto-advances unless the
// visitor is hovering, has the tab hidden, or prefers reduced motion.
export function EventPhotoCarousel({ photos }: { photos: EventPhoto[] }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);
  const count = photos.length;
  const go = useCallback((d: number) => setIdx((i) => (i + d + count) % count), [count]);

  useEffect(() => { if (idx >= count) setIdx(0); }, [count, idx]);

  useEffect(() => {
    if (count < 2 || paused) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => { if (!document.hidden) go(1); }, AUTO_ADVANCE_MS);
    return () => window.clearInterval(t);
  }, [count, paused, go]);

  if (count === 0) return null;
  const current = photos[Math.min(idx, count - 1)]!;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Event photos"
      data-qa="event-photo-carousel"
      tabIndex={0}
      className="relative overflow-hidden rounded-xl bg-slate-900 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); }}
      onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; setPaused(true); }}
      onTouchEnd={(e) => {
        const start = touchX.current; touchX.current = null; setPaused(false);
        const end = e.changedTouches[0]?.clientX;
        if (start == null || end == null || Math.abs(end - start) < SWIPE_PX) return;
        go(end < start ? 1 : -1);
      }}
    >
      <div className="relative aspect-video w-full">
        {photos.map((p, i) => (
          <img
            key={p.id}
            src={p.url}
            alt={p.caption ?? `Event photo ${i + 1}`}
            loading={i === 0 ? 'eager' : 'lazy'}
            draggable={false}
            aria-hidden={i !== idx}
            className={cn('absolute inset-0 h-full w-full select-none object-cover transition-opacity duration-500', i === idx ? 'opacity-100' : 'opacity-0')}
          />
        ))}
        {current.caption && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 pb-8 pt-10 text-sm font-medium text-white sm:text-base" data-qa="event-photo-caption">
            {current.caption}
          </div>
        )}
      </div>

      {count > 1 && (
        <>
          <button type="button" aria-label="Previous photo" onClick={() => go(-1)}
            className="absolute left-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" aria-label="Next photo" onClick={() => go(1)}
            className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60">
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {photos.map((p, i) => (
              <button key={p.id} type="button" aria-label={`Show photo ${i + 1}`} aria-current={i === idx}
                onClick={() => setIdx(i)}
                className={cn('h-2 rounded-full transition-all', i === idx ? 'w-5 bg-white' : 'w-2 bg-white/50 hover:bg-white/80')} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
