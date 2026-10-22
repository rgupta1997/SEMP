import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Award, Pencil, Plus, Trash2 } from 'lucide-react';
import { ARCHIVED_READ_ONLY_MESSAGE } from '@semp/shared';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { Badge, Button, Card, cn, confirmDialog, EmptyState, PageHeader, Spinner, toast } from '../../components/ui';
import { AwardTypeFormModal } from '../../features/awards/AwardTypeFormModal';
import { inScope, ScopeAwardsEditor, type AwardScopeRef, type ChampionshipAward } from '../../features/awards/ScopeAwardsEditor';
import { LEVEL_LABEL, RECIPIENT_LABEL, type AwardType, type AwardTypeBody } from '../../features/awards/types';
import { useEvent } from './EventLayout';

interface TournamentScope { id: string; name: string; sports: Array<{ id: string; sport_id: string; name: string }> }

const scopeKey = (s: AwardScopeRef) => `${s.level}|${s.tournament_id ?? ''}|${s.tournament_sport_id ?? ''}`;

// Awards above match level for one event: per sport within a tournament, per
// tournament, and for the whole event - plus award types that exist only here.
// Match awards stay on the match console, where the scorer gives them.
export function EventAwardsPage() {
  const { championship, eventId, canManage } = useEvent();
  const archived = !!championship.archived_at;
  const qc = useQueryClient();

  const { data: tournaments = [], isLoading } = useApi<TournamentScope[]>(canManage ? `/championships/${eventId}/awards/scopes` : null);
  const { data: awards = [] } = useApi<ChampionshipAward[]>(canManage ? `/championships/${eventId}/awards` : null);
  const ownTypesPath = `/championships/${eventId}/award-types`;
  const { data: ownTypes = [] } = useApi<AwardType[]>(canManage ? ownTypesPath : null);

  const scopes = useMemo<AwardScopeRef[]>(() => {
    const multi = tournaments.length > 1;
    const list: AwardScopeRef[] = [{
      level: 'championship', title: 'Event awards', subtitle: `Across the whole of ${championship.name}`,
    }];
    for (const t of tournaments) {
      list.push({
        level: 'tournament', tournament_id: t.id,
        title: multi ? `${t.name} - whole tournament` : 'Whole tournament',
        subtitle: `Across every sport in ${t.name}`,
      });
      for (const s of t.sports) {
        list.push({
          level: 'tournament_sport', tournament_id: t.id, tournament_sport_id: s.id,
          title: multi ? `${s.name} · ${t.name}` : s.name,
          subtitle: `Within ${s.name}${multi ? ` in ${t.name}` : ''}`,
        });
      }
    }
    return list;
  }, [tournaments, championship.name]);

  const eventSports = useMemo(() => {
    const m = new Map<string, string>();
    tournaments.forEach((t) => t.sports.forEach((s) => m.set(s.sport_id, s.name)));
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [tournaments]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = scopes.find((s) => scopeKey(s) === selectedKey) ?? scopes[0];

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AwardType | null>(null);

  // A new or changed event award type changes what every scope can offer.
  const refreshTypes = () => qc.invalidateQueries({
    predicate: (q) => {
      const k = String(q.queryKey[0] ?? '');
      return k === ownTypesPath || k.startsWith(`/championships/${eventId}/awards/options`) || k.startsWith('/award-types');
    },
  });
  const saveType = async (p: Promise<unknown>) => { const r = await p; await refreshTypes(); return r; };

  async function removeType(t: AwardType) {
    const used = t.usage ?? 0;
    const ok = await confirmDialog({
      title: used ? 'Deactivate this award' : 'Delete this award',
      confirmLabel: used ? 'Deactivate' : 'Delete',
      message: used
        ? `"${t.label}" has been given ${used} time${used === 1 ? '' : 's'}. It will stop being offered but stays on those awards.`
        : `Delete "${t.label}"?`,
    });
    if (!ok) return;
    try {
      await saveType(api('DELETE', `${ownTypesPath}/${t.id}`));
      toast.success(used ? 'Award deactivated' : 'Award deleted');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  if (!canManage) {
    return <EmptyState icon={<Award size={24} />} title="Awards" description="Only the event's organisers can give awards here." />;
  }
  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>;

  const countIn = (s: AwardScopeRef) => awards.filter((a) => inScope(a, s)).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Awards"
        subtitle="Give awards for a sport, a whole tournament or the whole event. Match awards like Player of the Match are given on each match's scoring screen."
      />

      <div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
        <Card className="h-fit p-2">
          <nav aria-label="Where the award is given" className="flex flex-col gap-0.5">
            {scopes.map((s) => {
              const active = scopeKey(s) === scopeKey(selected);
              const n = countIn(s);
              return (
                <button
                  key={scopeKey(s)}
                  type="button"
                  data-qa="award-scope"
                  onClick={() => setSelectedKey(scopeKey(s))}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm',
                    s.level === 'tournament_sport' && 'pl-6',
                    active ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                      : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800',
                  )}
                >
                  <span className="truncate">{s.title}</span>
                  {n > 0 && <Badge tone={active ? 'brand' : 'slate'}>{n}</Badge>}
                </button>
              );
            })}
          </nav>
        </Card>

        {selected && (
          <ScopeAwardsEditor
            eventId={eventId}
            scope={selected}
            saved={awards.filter((a) => inScope(a, selected))}
            readOnly={archived}
          />
        )}
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Awards for this event only</h2>
            <p className="t-meta mt-0.5">Your own awards on top of the standard list - e.g. Spirit of the Games. Nobody outside this event sees them.</p>
          </div>
          <Button size="sm" disabled={archived} title={archived ? ARCHIVED_READ_ONLY_MESSAGE : undefined} onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden /> New award
          </Button>
        </div>
        {ownTypes.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">None yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {ownTypes.map((t) => (
              <li key={t.id} className={cn('flex flex-wrap items-center justify-between gap-2 py-2', !t.is_active && 'opacity-60')}>
                <div className="min-w-0">
                  <div className="font-medium text-slate-800 dark:text-slate-200">{t.label}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {t.levels.map((l) => <Badge key={l} tone="slate">{LEVEL_LABEL[l]}</Badge>)}
                    <Badge tone={t.recipient_kind === 'team' ? 'violet' : 'info'}>{RECIPIENT_LABEL[t.recipient_kind]}</Badge>
                    <Badge tone="brand">{t.all_sports ? 'All sports' : t.sports.map((s) => s.name).join(', ')}</Badge>
                    {!t.is_active && <Badge tone="rose">inactive</Badge>}
                  </div>
                </div>
                {!archived && (
                  <div className="flex">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label={`Edit ${t.label}`} title="Edit"><Pencil size={14} /></Button>
                    {t.is_active && (
                      <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" onClick={() => removeType(t)} aria-label={`Delete ${t.label}`} title="Delete">
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {creating && (
        <AwardTypeFormModal
          sports={eventSports}
          onClose={() => setCreating(false)}
          onSubmit={(body: AwardTypeBody) => saveType(api('POST', ownTypesPath, body))}
        />
      )}
      {editing && (
        <AwardTypeFormModal
          initial={editing}
          sports={eventSports}
          onClose={() => setEditing(null)}
          onSubmit={(body: AwardTypeBody) => saveType(api('PATCH', `${ownTypesPath}/${editing.id}`, body))}
        />
      )}
    </div>
  );
}
