import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useTableControls } from '../lib/hooks';
import { usePermissions } from '../lib/permissions';
import type { FieldDef, ResourceConfig } from '../lib/resources';
import { EVENT_STATUS_OPTIONS } from '../lib/resources';
import { BulkBar, Button, Checkbox, Field, Input, ListToolbar, Modal, Pagination, SearchInput, Select, Textarea, toast } from './ui';

function RelationSelect({ field, value, onChange }: { field: FieldDef; value: string; onChange: (v: string) => void }) {
  const { path, labelKey, nullable } = field.relation!;
  const { data = [] } = useQuery({ queryKey: [path], queryFn: () => api('GET', path) });
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{nullable ? '— none —' : '— select —'}</option>
      {data.map((o: any) => <option key={o.id} value={o.id}>{o[labelKey] ?? o.id}</option>)}
    </Select>
  );
}

function initialValues(config: ResourceConfig, row: any | null): Record<string, any> {
  const v: Record<string, any> = {};
  for (const f of config.fields) {
    if (row) {
      const raw = row[f.name];
      if (f.type === 'json') v[f.name] = JSON.stringify(raw ?? f.default ?? null, null, 2);
      else if (f.type === 'date') v[f.name] = raw ? String(raw).slice(0, 10) : '';
      else if (f.type === 'checkbox') v[f.name] = Boolean(raw);
      else v[f.name] = raw ?? '';
    } else {
      if (f.type === 'json') v[f.name] = JSON.stringify(f.default ?? null, null, 2);
      else if (f.type === 'checkbox') v[f.name] = f.default ?? false;
      else v[f.name] = f.default ?? '';
    }
  }
  return v;
}

function buildPayload(config: ResourceConfig, values: Record<string, any>, isEdit: boolean): any {
  const out: Record<string, any> = {};
  for (const f of config.fields) {
    if (f.createOnly && isEdit) continue;
    const v = values[f.name];
    switch (f.type) {
      case 'number':
        if (v !== '' && v !== null && v !== undefined) out[f.name] = Number(v);
        break;
      case 'checkbox':
        out[f.name] = Boolean(v);
        break;
      case 'json':
        out[f.name] = JSON.parse(v || 'null');
        break;
      case 'relation':
        if (v) out[f.name] = v;
        else if (f.relation?.nullable) out[f.name] = null;
        break;
      case 'select':
      case 'date':
      case 'text':
      case 'textarea':
      default:
        if (typeof v === 'string' ? v.trim() !== '' : v != null) out[f.name] = v;
    }
  }
  return out;
}

function ResourceForm({ config, row, onClose }: { config: ResourceConfig; row: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!row;
  const [values, setValues] = useState(() => initialValues(config, row));
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (payload: any) =>
      isEdit ? api('PATCH', `${config.path}/${row.id}`, payload) : api('POST', config.path, payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [config.path] }); onClose(); },
    onError: (e: any) => setError(e.message ?? 'Error'),
  });

  const set = (name: string, v: any) => setValues((s) => ({ ...s, [name]: v }));

  const submit = () => {
    setError(null);
    let payload;
    try { payload = buildPayload(config, values, isEdit); }
    catch (e: any) { setError('Invalid JSON: ' + e.message); return; }
    mut.mutate(payload);
  };

  return (
    <Modal title={`${isEdit ? 'Edit' : 'New'} ${config.title.replace(/s$/, '')}`} onClose={onClose}>
      {config.fields.map((f) => {
        if (f.createOnly && isEdit) return null;
        return (
          <Field key={f.name} label={f.label}>
            {f.type === 'relation' ? (
              <RelationSelect field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />
            ) : f.type === 'select' ? (
              <Select value={values[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">— select —</option>
                {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            ) : f.type === 'checkbox' ? (
              <input type="checkbox" checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
            ) : f.type === 'json' || f.type === 'textarea' ? (
              <Textarea rows={f.type === 'json' ? 4 : 2} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} />
            ) : (
              <Input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} />
            )}
          </Field>
        );
      })}
      {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
      <div className="flex justify-end gap-2 mt-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  );
}

function cell(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '✓' : '';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 40 ? s.slice(0, 37) + '…' : s;
}

export function ResourcePage({ config }: { config: ResourceConfig }) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canManage = can('masterdata.manage');
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data = [], isLoading, error } = useQuery({ queryKey: [config.path], queryFn: () => api('GET', config.path) });

  const del = useMutation({
    mutationFn: (id: string) => api('DELETE', `${config.path}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [config.path] }),
  });
  const bulkDel = useMutation({
    mutationFn: async (ids: string[]) => { await Promise.all(ids.map((id) => api('DELETE', `${config.path}/${id}`))); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [config.path] }); setSelected(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });
  const selectable = !config.noDelete && canManage;
  const cols = useMemo(() => config.columns, [config]);

  const sorts = useMemo(() => {
    const m: Record<string, (a: any, b: any) => number> = {};
    for (const c of cols) {
      m[c.key] = (a, b) => String(a[c.key] ?? '').localeCompare(String(b[c.key] ?? ''), undefined, { numeric: true });
    }
    return m;
  }, [cols]);

  const t = useTableControls<any>(data, {
    search: (row) => cols.map((c) => String(row[c.key] ?? '')).join(' '),
    sorts,
    pageSize: 15,
  });
  const rows = t.view;

  const allSelected = rows.length > 0 && rows.every((r: any) => selected.has(r.id));
  const someSelected = rows.some((r: any) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    if (allSelected) rows.forEach((r: any) => n.delete(r.id));
    else rows.forEach((r: any) => n.add(r.id));
    return n;
  });
  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api('PATCH', `${config.path}/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [config.path] }),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <h2 className="text-xl font-semibold">{config.title}</h2>
        <ListToolbar inline>
          <SearchInput value={t.query} onChange={t.setQuery} placeholder={`Search ${config.title.toLowerCase()}…`} className="w-56" />
          {canManage && <Button onClick={() => setCreating(true)}>+ Add</Button>}
        </ListToolbar>
      </div>
      {isLoading && <p className="text-slate-500 dark:text-slate-400">Loading…</p>}
      {error && <p className="text-red-600">{(error as any).message}</p>}
      {selectable && (
        <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
          <Button size="sm" variant="danger" disabled={bulkDel.isPending}
            onClick={() => { if (confirm(`Delete ${selected.size} ${config.title.toLowerCase()}?`)) bulkDel.mutate([...selected]); }}>
            Delete selected
          </Button>
        </BulkBar>
      )}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-500 dark:text-slate-400">
            <tr>
              {selectable && <th className="px-3 py-2 w-px"><Checkbox checked={allSelected} indeterminate={someSelected && !allSelected} onChange={toggleAll} /></th>}
              {cols.map((c) => (
                <th key={c.key} className="px-3 py-2 font-medium">
                  <button type="button" onClick={() => t.toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
                    {c.label}
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">{t.sortKey === c.key ? (t.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </button>
                </th>
              ))}
              <th className="px-3 py-2 w-px">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: any) => (
              <tr key={row.id} className={`border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 ${selected.has(row.id) ? 'bg-brand-50/50 dark:bg-brand-500/10' : ''}`}>
                {selectable && <td className="px-3 py-2"><Checkbox checked={selected.has(row.id)} onChange={() => toggle(row.id)} /></td>}
                {cols.map((c) => <td key={c.key} className="px-3 py-2">{cell(row[c.key])}</td>)}
                <td className="px-3 py-2 whitespace-nowrap flex gap-1 items-center">
                  {config.statusEndpoint && canManage && (
                    <select className="border rounded text-xs px-1 py-0.5 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100" value={row.status}
                      onChange={(e) => statusMut.mutate({ id: row.id, status: e.target.value })}>
                      {EVENT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                  {!config.noEdit && canManage && <Button variant="ghost" onClick={() => setEditing(row)}>Edit</Button>}
                  {!config.noDelete && canManage && <Button variant="danger" onClick={() => { if (confirm('Delete?')) del.mutate(row.id); }}>Del</Button>}
                  {!canManage && <span className="text-xs text-slate-400 dark:text-slate-500">—</span>}
                </td>
              </tr>
            ))}
            {t.total === 0 && !isLoading && (
              <tr><td colSpan={cols.length + (selectable ? 2 : 1)} className="px-3 py-6 text-center text-slate-400 dark:text-slate-500">{data.length === 0 ? 'No records' : 'No matches for your search'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} />
      {creating && <ResourceForm config={config} row={null} onClose={() => setCreating(false)} />}
      {editing && <ResourceForm config={config} row={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
