import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Award, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useApi, useApiMutation, useTableControls } from '../../lib/hooks';
import { Badge, Button, Card, confirmDialog, EmptyState, PageHeader, Pagination, SearchInput, Select, Spinner, toast } from '../../components/ui';
import { AwardTypeFormModal } from '../../features/awards/AwardTypeFormModal';
import { LEVEL_LABEL, RECIPIENT_LABEL, type AwardType, type AwardTypeBody } from '../../features/awards/types';

interface Sport { id: string; name: string }

const LIST = '/platform/award-types';

// Super admin: the global award catalogue and which sports each award is offered
// for. Scorers and organisers pick from this list instead of typing award names.
export function AwardTypesPage() {
  const [sportFilter, setSportFilter] = useState('');
  const listPath = sportFilter ? `${LIST}?sport_id=${sportFilter}` : LIST;
  const { data: types = [], isLoading } = useApi<AwardType[]>(listPath);
  const { data: sports = [] } = useApi<Sport[]>('/sports');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AwardType | null>(null);
  const qc = useQueryClient();
  // Every cached copy of the list, whichever sport filter it was fetched with.
  const saved = async <T,>(p: Promise<T>) => {
    const r = await p;
    await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? '').startsWith(LIST) });
    return r;
  };

  const del = useApiMutation((id: string) => api<{ result: 'deleted' | 'deactivated' }>('DELETE', `${LIST}/${id}`), [LIST]);

  const sortedSports = useMemo(() => [...sports].sort((a, b) => a.name.localeCompare(b.name)), [sports]);

  const t = useTableControls(types, {
    search: (a) => `${a.label} ${a.code} ${a.sports.map((s) => s.name).join(' ')}`,
    sorts: { order: (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label) },
    initialSort: 'order',
    pageSize: 20,
  });

  async function remove(a: AwardType) {
    const used = a.usage ?? 0;
    const ok = await confirmDialog({
      title: used ? 'Deactivate award type' : 'Delete award type',
      confirmLabel: used ? 'Deactivate' : 'Delete',
      message: used
        ? `"${a.label}" has been given ${used} time${used === 1 ? '' : 's'}. It will be hidden from the dropdowns but kept on past awards.`
        : `Delete "${a.label}"? It has never been given.`,
    });
    if (!ok) return;
    del.mutate(a.id, {
      onSuccess: (r) => { void saved(Promise.resolve()); toast.success(r.result === 'deleted' ? 'Award type deleted' : 'Award type deactivated'); },
      onError: (e: any) => toast.error(e.message),
    });
  }

  return (
    <div>
      <PageHeader
        title="Award Types"
        subtitle="The awards scorers and organisers can give, the sports each one is offered for, and whether it goes to a player or a team."
      >
        <Button onClick={() => setCreating(true)}><Plus size={15} aria-hidden /> New award type</Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={t.query} onChange={t.setQuery} placeholder="Search awards…" className="w-56" />
        <Select value={sportFilter} onChange={(e) => setSportFilter(e.target.value)} aria-label="Filter by sport">
          <option value="">All sports</option>
          {sortedSports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>

      {isLoading ? (
        <div className="grid h-40 place-items-center"><Spinner /></div>
      ) : types.length === 0 ? (
        <EmptyState
          icon={<Award size={24} />}
          title={sportFilter ? 'No awards for this sport' : 'No award types'}
          description={sportFilter ? 'Map an award type to this sport, or offer one for all sports.' : 'Create the first award type.'}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm dark:divide-slate-800">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2">Award</th>
                <th className="px-4 py-2">Given at</th>
                <th className="px-4 py-2">Goes to</th>
                <th className="px-4 py-2">Sports</th>
                <th className="px-4 py-2 text-right">Given</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {t.view.map((a) => (
                <tr key={a.id} className={a.is_active ? '' : 'opacity-60'}>
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-800 dark:text-slate-200">{a.label}</div>
                    <div className="font-mono text-xs text-slate-400 dark:text-slate-500">{a.code}</div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {a.levels.map((l) => <Badge key={l} tone="slate">{LEVEL_LABEL[l]}</Badge>)}
                    </div>
                  </td>
                  <td className="px-4 py-2"><Badge tone={a.recipient_kind === 'team' ? 'violet' : 'info'}>{RECIPIENT_LABEL[a.recipient_kind]}</Badge></td>
                  <td className="max-w-xs px-4 py-2 text-slate-600 dark:text-slate-300">
                    {a.all_sports ? <Badge tone="brand" className="whitespace-nowrap">All sports</Badge> : (
                      <span title={a.sports.map((s) => s.name).join(', ')}>
                        {a.sports.slice(0, 4).map((s) => s.name).join(', ')}
                        {a.sports.length > 4 && <span className="text-slate-400"> +{a.sports.length - 4} more</span>}
                      </span>
                    )}
                  </td>
                  <td className="t-num px-4 py-2 text-right text-slate-600 dark:text-slate-300">{a.usage ?? 0}</td>
                  <td className="px-4 py-2">{a.is_active ? <Badge tone="green">active</Badge> : <Badge tone="rose">inactive</Badge>}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(a)} aria-label={`Edit ${a.label}`} title="Edit">
                      <Pencil size={14} />
                    </Button>
                    {a.is_active && (
                      <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" onClick={() => remove(a)}
                        aria-label={`Delete ${a.label}`} title={a.usage ? 'Deactivate' : 'Delete'}>
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 pb-3"><Pagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} /></div>
        </Card>
      )}

      {creating && (
        <AwardTypeFormModal
          sports={sortedSports}
          onClose={() => setCreating(false)}
          onSubmit={(body: AwardTypeBody) => saved(api('POST', LIST, body))}
        />
      )}
      {editing && (
        <AwardTypeFormModal
          initial={editing}
          sports={sortedSports}
          onClose={() => setEditing(null)}
          onSubmit={(body: AwardTypeBody) => saved(api('PATCH', `${LIST}/${editing.id}`, body))}
        />
      )}
    </div>
  );
}
