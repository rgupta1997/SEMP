import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react';
import {
  EVENT_PHOTO_CAPTION_MAX, EVENT_PHOTO_MAX_BYTES, EVENT_PHOTO_MAX_COUNT, EVENT_PHOTO_MAX_EDGE,
  EVENT_PHOTO_MAX_SOURCE_BYTES, EVENT_PHOTO_TYPES, type EventPhoto,
} from '@semp/shared';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { Button, Modal, Spinner, confirmDialog, toast } from '../ui';

const MB = 1024 * 1024;

/** Shrink to the longest-edge limit and re-encode as JPEG; lower quality if still too big. */
async function shrinkToJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, EVENT_PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.72, 0.6]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (blob && blob.size <= EVENT_PHOTO_MAX_BYTES) {
      const dataUrl = await new Promise<string>((res, rej) => {
        const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob);
      });
      return dataUrl.slice(dataUrl.indexOf(',') + 1);
    }
  }
  throw new Error(`Couldn't get it under ${EVENT_PHOTO_MAX_BYTES / MB} MB`);
}

// Super-admin screen for an event's carousel: upload, caption, reorder, remove.
export function EventPhotoManager({ championshipId, overviewKey, onClose }: { championshipId: string; overviewKey: string; onClose: () => void }) {
  const listKey = `/platform/event-photos/${championshipId}`;
  const qc = useQueryClient();
  const { data, isLoading } = useApi<{ photos: EventPhoto[]; storage: string }>(listKey);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photos = data?.photos ?? [];
  const storageOff = data?.storage === 'off';

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: [listKey] }), qc.invalidateQueries({ queryKey: [overviewKey] })]);
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try { await fn(); await refresh(); } catch (e) { toast.error('Photo change failed', (e as Error).message); } finally { setBusy(null); }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = EVENT_PHOTO_MAX_COUNT - photos.length;
    const picked = [...files].slice(0, room);
    if (files.length > room) toast.warning(`Only ${room} more photo${room === 1 ? '' : 's'} fit`, `An event can have up to ${EVENT_PHOTO_MAX_COUNT}.`);
    setBusy('upload');
    let added = 0;
    for (const [i, file] of picked.entries()) {
      setBusy(`upload ${i + 1}/${picked.length}`);
      try {
        if (!(EVENT_PHOTO_TYPES as readonly string[]).includes(file.type)) throw new Error('Use a JPEG, PNG or WebP image');
        if (file.size > EVENT_PHOTO_MAX_SOURCE_BYTES) throw new Error(`Larger than ${EVENT_PHOTO_MAX_SOURCE_BYTES / MB} MB`);
        const data = await shrinkToJpeg(file);
        await api('POST', listKey, { data, contentType: 'image/jpeg' });
        added++;
      } catch (e) {
        toast.error(`Couldn't add ${file.name}`, (e as Error).message);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
    await refresh();
    setBusy(null);
    if (added) toast.success(`Added ${added} photo${added === 1 ? '' : 's'}`);
  };

  const move = (i: number, d: number) => {
    const ids = photos.map((p) => p.id);
    [ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!];
    return run('order', () => api('PUT', `${listKey}/order`, { ids }));
  };
  const saveCaption = (p: EventPhoto, value: string) => {
    const caption = value.trim();
    if (caption === (p.caption ?? '')) return;
    return run(`caption ${p.id}`, () => api('PATCH', `${listKey}/${p.id}`, { caption }));
  };
  const remove = async (p: EventPhoto) => {
    const ok = await confirmDialog({
      title: 'Remove this photo?', message: 'It comes off the event page and the file is deleted.',
      confirmLabel: 'Remove', tone: 'danger',
    });
    if (ok) await run(`remove ${p.id}`, () => api('DELETE', `${listKey}/${p.id}`));
  };

  return (
    <Modal title="Event photos" onClose={onClose} wide
      footer={<Button variant="outline" onClick={onClose}>Done</Button>}>
      <div className="space-y-4" data-qa="event-photo-manager">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          These show in a slideshow on the public Overview. Anyone with the event link can see them.
          Photos are shrunk to {EVENT_PHOTO_MAX_EDGE}px before upload. Up to {EVENT_PHOTO_MAX_COUNT} photos.
        </p>
        {storageOff && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            Photo storage isn't set up on this server yet, so uploads will fail. It needs STORAGE_TRANSPORT and a bucket in the API settings.
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept={EVENT_PHOTO_TYPES.join(',')} multiple className="hidden"
            data-qa="event-photo-input" onChange={(e) => upload(e.target.files)} />
          <Button onClick={() => fileRef.current?.click()} disabled={!!busy || photos.length >= EVENT_PHOTO_MAX_COUNT}>
            <ImagePlus className="mr-1.5 h-4 w-4" /> Add photos
          </Button>
          <span className="text-xs text-slate-500">{photos.length}/{EVENT_PHOTO_MAX_COUNT}</span>
          {busy?.startsWith('upload') && <span className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Uploading {busy.slice(7)}</span>}
        </div>

        {isLoading ? <Spinner /> : photos.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">No photos yet.</p>
        ) : (
          <ul className="space-y-2">
            {photos.map((p, i) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-2 dark:border-slate-700" data-qa="event-photo-row">
                <img src={p.url} alt="" className="h-14 w-24 shrink-0 rounded object-cover" />
                <input
                  defaultValue={p.caption ?? ''}
                  key={`${p.id}:${p.caption ?? ''}`}
                  maxLength={EVENT_PHOTO_CAPTION_MAX}
                  placeholder="Caption (optional)"
                  aria-label={`Caption for photo ${i + 1}`}
                  onBlur={(e) => saveCaption(p, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
                <div className="flex shrink-0 items-center">
                  <Button variant="ghost" size="sm" aria-label="Move up" disabled={!!busy || i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" aria-label="Move down" disabled={!!busy || i === photos.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" aria-label="Remove photo" disabled={!!busy} onClick={() => remove(p)}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
