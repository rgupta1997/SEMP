import { forwardRef, useState, type DragEvent } from 'react';
import { FileSpreadsheet, LoaderCircle, RefreshCw, Upload } from 'lucide-react';
import { Button, cn, toast } from '../../../components/ui';
import { eventSetupApi, useSetupCache } from '../api';
import { verdict } from '../issues';
import { readWorkbookFile, sheetRowCounts, validatePayload, workbookLimitProblem } from '../xlsx';
import type { ReadWorkbook } from '../types';
import { FOCUS_RING } from './pills';

const ACCEPT = '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
const isSpreadsheet = (f: File) => /\.(xlsx|xls)$/i.test(f.name);

type Phase = 'idle' | 'reading' | 'validating';

/**
 * Pick or drop the client's workbook; every sheet is read in the browser and sent
 * to /validate. The file input is owned by the caller (forwarded ref) so the page
 * header's Re-validate button can open the same picker.
 */
export const WorkbookUpload = forwardRef<HTMLInputElement, {
  setupId: string;
  enabled: boolean;
  /** The file the server last validated, if any. */
  lastFileName: string | null;
  /** The workbook read in this visit, kept so it can be re-checked without picking it again. */
  workbook: ReadWorkbook | null;
  onWorkbook: (wb: ReadWorkbook) => void;
}>(function WorkbookUpload({ setupId, enabled, lastFileName, workbook, onWorkbook }, inputRef) {
  const { put, refresh } = useSetupCache();
  const [phase, setPhase] = useState<Phase>('idle');
  const [dragging, setDragging] = useState(false);
  const busy = phase !== 'idle';

  const send = async (wb: ReadWorkbook) => {
    const { body, bytes } = validatePayload(wb);
    const problem = workbookLimitProblem(wb, bytes);
    if (problem) {
      toast.error('This workbook is too large to validate', problem);
      setPhase('idle');
      return;
    }
    setPhase('validating');
    try {
      const detail = await eventSetupApi.validate(setupId, body);
      put(detail);
      const issues = [...(detail.validation?.issues ?? []), ...(detail.platform?.issues ?? [])];
      // The same verdict the results banner shows, so the toast and the page agree.
      const v = verdict(issues, detail.validation?.ok ?? false);
      if (v.tone === 'blocked') toast.warning(v.title, 'The list is below.');
      else toast.success(v.title, v.tone === 'review' ? 'Read the warnings before applying.' : undefined);
    } catch (e) {
      toast.error('Could not validate', (e as Error)?.message ?? 'Try again.');
      refresh(setupId);
    } finally {
      setPhase('idle');
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || busy || !enabled) return;
    if (!isSpreadsheet(file)) {
      toast.error('Not an Excel workbook', 'Upload the filled-in template as .xlsx (or .xls).');
      return;
    }
    setPhase('reading');
    let wb: ReadWorkbook;
    try {
      wb = await readWorkbookFile(file);
    } catch (e) {
      toast.error('Could not read that file', (e as Error)?.message ?? 'Is it a valid Excel workbook?');
      setPhase('idle');
      return;
    }
    if (!Object.keys(wb.sheets).length) {
      toast.error('That workbook is empty', 'It has no sheets to read.');
      setPhase('idle');
      return;
    }
    onWorkbook(wb);
    await send(wb);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void handleFile(e.dataTransfer.files?.[0]);
  };

  const open = () => {
    if (inputRef && typeof inputRef !== 'function') inputRef.current?.click();
  };

  const counts = workbook ? sheetRowCounts(workbook.sheets) : [];

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          // Clear it, so picking the same file again (after fixing it) still fires.
          e.target.value = '';
        }}
      />

      <div
        onDragOver={(e) => { if (!enabled || busy) return; e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={enabled && !busy ? onDrop : (e) => e.preventDefault()}
        className={cn(
          'flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-4 py-7 text-center transition-colors sm:py-9',
          dragging
            ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
            : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900',
          !enabled && 'opacity-60',
        )}
      >
        <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" aria-hidden>
          {busy ? <LoaderCircle size={20} className="animate-spin" /> : <Upload size={20} />}
        </span>
        <div aria-live="polite">
          <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
            {phase === 'reading' ? 'Reading the workbook…'
              : phase === 'validating' ? 'Validating… checking every sheet and looking the names up on the platform'
                : enabled ? 'Drop the filled-in workbook here' : 'Uploading is closed for this setup'}
          </div>
          {!busy && enabled && <p className="t-meta mt-1">.xlsx or .xls - every sheet is read in your browser, then checked.</p>}
        </div>
        {enabled && (
          <Button className={FOCUS_RING} onClick={open} disabled={busy}>
            <FileSpreadsheet size={15} aria-hidden /> {lastFileName ? 'Choose another workbook' : 'Choose workbook'}
          </Button>
        )}
      </div>

      {(lastFileName || workbook) && (
        <div className="flex flex-col gap-2 rounded-xl border border-eos-line bg-slate-50/60 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-800/30">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
              <FileSpreadsheet size={14} className="mr-1.5 inline -translate-y-px text-emerald-600" aria-hidden />
              {workbook?.fileName ?? lastFileName}
            </div>
            {counts.length > 0 ? (
              <p className="t-meta mt-0.5">
                Read {counts.length} {counts.length === 1 ? 'sheet' : 'sheets'}: {counts.map((c) => `${c.name} (${c.rows})`).join(', ')}
              </p>
            ) : (
              <p className="t-meta mt-0.5">Last validated workbook.</p>
            )}
          </div>
          {workbook && enabled && (
            <Button variant="outline" size="sm" className={cn('shrink-0', FOCUS_RING)} disabled={busy} onClick={() => send(workbook)}>
              <RefreshCw size={13} aria-hidden /> Check again
            </Button>
          )}
        </div>
      )}
    </div>
  );
});
