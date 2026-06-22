import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { downloadCsvTemplate, matrixToRows, parseDelimitedText, readFileToMatrix, type ImportColumn } from '../lib/import';
import { Button, Modal, Tabs, Textarea } from './ui';

export interface BulkImportField extends ImportColumn {
  label: string;
  required?: boolean;
}

interface BulkImportModalProps<R> {
  title: string;
  fields: BulkImportField[];
  templateName: string;          // downloaded file name, e.g. 'users-template.csv'
  sampleRow?: string[];          // example values aligned to `fields` order
  submitLabel?: string;
  extraControls?: ReactNode;     // e.g. championship/role mapping above the importer
  onClose: () => void;
  onSubmit: (rows: Record<string, string>[]) => Promise<R>;
  renderResult?: (res: R) => ReactNode;
}

const isEmail = (v: string) => /\S+@\S+\.\S+/.test(v);

export function BulkImportModal<R>({
  title, fields, templateName, sampleRow, submitLabel = 'Import',
  extraControls, onClose, onSubmit, renderResult,
}: BulkImportModalProps<R>) {
  const qc = useQueryClient();
  const [tab, setTab] = useState('file');
  const [paste, setPaste] = useState('');
  const [matrix, setMatrix] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<R | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const headers = useMemo(() => fields.map((f) => f.key), [fields]);

  // The active source → typed rows (file matrix or pasted text).
  const rows = useMemo(() => {
    const src = tab === 'file' ? matrix : (paste.trim() ? parseDelimitedText(paste) : null);
    if (!src) return [];
    return matrixToRows(src, fields);
  }, [tab, matrix, paste, fields]);

  const rowError = (r: Record<string, string>): string | null => {
    for (const f of fields) {
      if (f.required && !r[f.key]) return `${f.label} required`;
      if (f.key === 'email' && r[f.key] && !isEmail(r[f.key])) return 'Invalid email';
    }
    return null;
  };
  const valid = useMemo(() => rows.filter((r) => !rowError(r)), [rows]);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setMatrix(await readFileToMatrix(file));
      setFileName(file.name);
    } catch (e: any) {
      setError(e?.message ?? 'Could not read that file');
    }
  };

  const submit = async () => {
    setError(null);
    if (valid.length === 0) { setError('No valid rows to import'); return; }
    setBusy(true);
    try {
      setResult(await onSubmit(valid));
      qc.invalidateQueries(); // refresh the lists the import populated
    } catch (e: any) {
      setError(e?.message ?? 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  if (result !== null) {
    return (
      <Modal title={`${title} - done`} onClose={onClose}>
        {renderResult ? renderResult(result) : <p className="text-sm text-slate-600 dark:text-slate-300">Import complete.</p>}
        <div className="mt-5 flex justify-end"><Button onClick={onClose}>Done</Button></div>
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      {extraControls && <div className="mb-4">{extraControls}</div>}

      <div className="mb-4">
        <Tabs active={tab} onChange={setTab} tabs={[{ id: 'file', label: 'Upload file' }, { id: 'paste', label: 'Paste' }]} />
      </div>

      {tab === 'file' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.xlsx,.xls,.txt"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            <Button variant="outline" onClick={() => fileInput.current?.click()}>Choose CSV / Excel file</Button>
            <Button variant="ghost" size="sm" onClick={() => downloadCsvTemplate(templateName, headers, sampleRow ? [sampleRow] : [])}>
              ↓ Download template
            </Button>
            {fileName && <span className="text-sm text-slate-500 dark:text-slate-400">{fileName}</span>}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            First row must be a header. Columns: <span className="font-medium">{headers.join(', ')}</span>.
          </p>
        </div>
      ) : (
        <div>
          <Textarea
            rows={7}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={`${headers.join(', ')}\n${sampleRow?.join(', ') ?? ''}`}
          />
          <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">Paste rows (comma, tab or semicolon separated). Include a header row.</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
            Preview · <span className="text-emerald-600 dark:text-emerald-400">{valid.length} valid</span>
            {rows.length - valid.length > 0 && <span className="text-rose-600 dark:text-rose-400"> · {rows.length - valid.length} skipped</span>}
          </div>
          <div className="max-h-60 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  {fields.map((f) => <th key={f.key} className="px-3 py-2">{f.label}</th>)}
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((r, i) => {
                  const err = rowError(r);
                  return (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                      {fields.map((f) => <td key={f.key} className="px-3 py-1.5 text-slate-700 dark:text-slate-300">{r[f.key] || '-'}</td>)}
                      <td className={`px-3 py-1.5 ${err ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{err ?? 'OK'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm text-slate-500 dark:text-slate-400">{valid.length} to import</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={valid.length === 0 || busy} onClick={submit}>{busy ? 'Importing…' : `${submitLabel} ${valid.length || ''}`}</Button>
        </div>
      </div>
    </Modal>
  );
}
