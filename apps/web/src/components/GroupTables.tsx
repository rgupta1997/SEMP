import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { formatPoints, type GroupRanking, type TieResolution } from '@semp/shared';
import { api } from '../lib/api';
import { useApi, useApiMutation } from '../lib/hooks';
import { Badge, Button, Modal, Spinner, Textarea, toast } from './ui';

// Group / league tables of one draw, ranked exactly as advancement and the overall
// table rank them. Teams the tie-breakers can't separate are ordered here by hand,
// with a reason, and that order feeds both the knockout slots and the placings.

interface TableRow {
  entity_id: string; name: string; short_name: string | null; rank: number;
  played: number; won: number; drawn: number; lost: number; points: number; score_for: number; score_against: number;
  /** Kho kho's average difference time, seconds. */
  adt?: number | null;
  adt_estimated?: boolean;
}
interface PoolTable { pool: number | null; label: string; complete: boolean; rows: TableRow[]; ties: string[][] }
export interface DrawTables {
  sport: string | null;
  stages: Array<{ stage: number; ranking: GroupRanking & { labels: string[] }; pools: PoolTable[] }>;
  placing_ties: Array<{ stage: number; entities: string[]; from: number; to: number }>;
  cross_group: CrossGroup[];
  resolutions: TieResolution[];
  names: Record<string, string>;
}

interface CrossGroup {
  stage: number;
  kind: 'placings' | 'semi_losers';
  rows: Array<Omit<TableRow, 'rank'> & { pool: string; place: number | null }>;
  /** Between rows[i] and rows[i + 1]: what separated them, or null = still level. */
  decided_by: Array<string | null>;
}

export const tablesPath = (drawId: string) => `/tournament-disciplines/${drawId}/standings-tables`;
/** Results land from other devices (officials scoring), so tables refresh on their own. */
export const TABLES_REFRESH_MS = 15_000;

/** How many group ties on this draw are waiting for a hand-picked order. */
// Only group ties can hold something up (who advances); a shared placing never waits.
export const openTieCount = (t?: DrawTables) =>
  t?.stages.reduce((n, s) => n + s.pools.reduce((m, p) => m + p.ties.length, 0), 0) ?? 0;

const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

interface TieTarget { scope: 'pool' | 'placing'; stage: number; pool: number | null; entities: string[]; title: string }

function ResolveModal({ drawId, target, names, onClose }: { drawId: string; target: TieTarget; names: Record<string, string>; onClose: () => void }) {
  const [order, setOrder] = useState(target.entities);
  const [reason, setReason] = useState('');
  const save = useApiMutation(
    () => api('POST', `/tournament-disciplines/${drawId}/tie-resolutions`, { scope: target.scope, stage: target.stage, pool: target.pool, order, reason }),
    [], // advancement and every standings scope can move
  );
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setOrder(next);
  };
  return (
    <Modal
      title={target.title}
      onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending || reason.trim().length < 3}
            onClick={() => save.mutate(undefined, { onSuccess: () => { toast.success('Tie resolved'); onClose(); }, onError: (e: any) => toast.error(e.message) })}>
            {save.isPending ? 'Saving…' : 'Save order'}
          </Button>
        </div>
      )}
    >
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        These teams are level on every tie-breaker. Put them in the order decided (best first) and say how it was decided.
      </p>
      <ol className="mb-4 space-y-1.5">
        {order.map((id, i) => (
          <li key={id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
            <span className="w-6 text-xs font-semibold text-slate-400">{i + 1}.</span>
            <span className="flex-1 font-medium text-slate-800 dark:text-slate-100">{names[id] ?? id}</span>
            <button type="button" className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={14} /></button>
            <button type="button" className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={14} /></button>
          </li>
        ))}
      </ol>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Reason</span>
        <Textarea rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Tie-breaker match, coin toss, fair play points" />
      </label>
    </Modal>
  );
}

// Teams from different groups compared for a placing: who was compared, their records,
// the place each got, and which tie-breaker (or hand-picked order) settled each pair.
function CrossGroupView({ c, multiStage }: { c: CrossGroup; multiStage: boolean }) {
  const placed = c.rows.map((r) => r.place).filter((p): p is number => p != null);
  const title = c.kind === 'semi_losers'
    ? 'Semi-final losers, ranked by group record'
    : placed.length
      ? `Ranking across groups: ${placed.length > 1 ? `places ${ordinal(Math.min(...placed))}-${ordinal(Math.max(...placed))}` : `${ordinal(placed[0])} place`}`
      : 'Ranking across groups';
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 dark:border-slate-800">
      <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-100">
        {title}{multiStage ? <span className="ml-2 text-xs font-normal text-slate-400">Stage {c.stage}</span> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
              <th className="px-3 py-1.5 text-left">Team</th>
              <th className="px-2 py-1.5 text-left">Group</th>
              {['P', 'W', 'D', 'L', 'Diff', 'For', 'Pts'].map((h) => <th key={h} className="px-2 py-1.5 text-right">{h}</th>)}
              <th className="px-3 py-1.5 text-right">Place</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.entity_id}>
                <td className="max-w-[12rem] truncate px-3 py-1.5 font-medium text-slate-800 dark:text-slate-100" title={r.name}>{r.short_name || r.name}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-slate-500 dark:text-slate-400">{r.pool}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.played}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.won}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.drawn}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.lost}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatPoints(r.score_for - r.score_against)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatPoints(r.score_for)}</td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatPoints(r.points)}</td>
                <td className="px-3 py-1.5 text-right">{r.place != null ? <Badge tone="brand">{ordinal(r.place)}</Badge> : <span className="text-slate-400">-</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-0.5 border-t border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        {c.decided_by.map((d, i) => (
          <li key={i}>
            <span className="font-medium text-slate-700 dark:text-slate-200">{c.rows[i].short_name || c.rows[i].name}</span>
            {' above '}
            <span className="font-medium text-slate-700 dark:text-slate-200">{c.rows[i + 1].short_name || c.rows[i + 1].name}</span>
            {': '}
            {d ? <>decided by <span className="font-semibold">{d.toLowerCase()}</span></> : <span className="text-slate-600 dark:text-slate-300">level, so they share the place</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PoolTableView({ pool, ranking, canManage, onResolve, names }: {
  pool: PoolTable; ranking: DrawTables['stages'][number]['ranking']; canManage: boolean; names: Record<string, string>;
  onResolve: (entities: string[]) => void;
}) {
  const tiedIds = new Set(pool.ties.flat());
  // Kho kho tables carry ADT (the server sends it only for kho kho).
  const showAdt = pool.rows.some((r) => r.adt !== undefined);
  // Teams level on every tie-breaker share a position (2, 2, 4) until an order is set.
  const shownRank = (r: PoolTable['rows'][number]) => {
    const tie = pool.ties.find((t) => t.includes(r.entity_id));
    return tie ? Math.min(...pool.rows.filter((x) => tie.includes(x.entity_id)).map((x) => x.rank ?? Infinity)) : r.rank;
  };
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{pool.label}</span>
        {pool.complete ? <Badge tone="green">Final</Badge> : <Badge tone="slate">In progress</Badge>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
              <th className="px-3 py-1.5 text-left">#</th>
              <th className="px-2 py-1.5 text-left">Team</th>
              {['P', 'W', 'D', 'L', 'For', 'Ag', 'Diff', 'Pts'].map((h) => <th key={h} className="px-2 py-1.5 text-right">{h}</th>)}
              {showAdt && (
                <th className="px-2 py-1.5 text-right normal-case" title="Average difference time, seconds: time defended per player out, minus time chased per opponent out. Group matches, regulation turns only.">ADT</th>
              )}
            </tr>
          </thead>
          <tbody>
            {pool.rows.map((r) => (
              <tr key={r.entity_id} className={tiedIds.has(r.entity_id) ? 'bg-amber-50 dark:bg-amber-500/10' : ''}>
                <td className="px-3 py-1.5 text-slate-400">{shownRank(r)}</td>
                <td className="max-w-[12rem] truncate px-2 py-1.5 font-medium text-slate-800 dark:text-slate-100" title={r.name}>{r.short_name || r.name}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.played}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.won}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.drawn}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.lost}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatPoints(r.score_for)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatPoints(r.score_against)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatPoints(r.score_for - r.score_against)}</td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-slate-900 dark:text-white">{formatPoints(r.points)}</td>
                {showAdt && (
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums"
                    title={r.adt_estimated ? 'A turn clock was not run: its full length was used.' : undefined}>
                    {r.adt == null ? <span className="text-slate-400">-</span> : `${r.adt.toFixed(3)}${r.adt_estimated ? '*' : ''}`}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showAdt && pool.rows.some((r) => r.adt_estimated) && (
        <p className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400 dark:border-slate-800">* A turn's clock was not run, so its full length was used.</p>
      )}
      {pool.ties.map((t) => (
        <div key={t.join()} className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <span>Tied: {t.map((id) => names[id] ?? id).join(', ')}. Level on {ranking.labels.join(', ').toLowerCase()}.</span>
          {canManage && <Button size="sm" variant="outline" onClick={() => onResolve(t)}>Resolve</Button>}
        </div>
      ))}
    </div>
  );
}

export function GroupTables({ drawId, canManage }: { drawId: string; canManage: boolean }) {
  const { data, isLoading } = useApi<DrawTables>(tablesPath(drawId), true, { refetchInterval: TABLES_REFRESH_MS });
  const [target, setTarget] = useState<TieTarget | null>(null);
  const clear = useApiMutation((id: string) => api('DELETE', `/tournament-disciplines/${drawId}/tie-resolutions/${id}`), []);
  if (isLoading || !data) return <Spinner label="Loading tables…" />;
  if (data.stages.length === 0) return null;
  const multi = data.stages.length > 1;
  return (
    <div className="space-y-4">
      {data.stages.map((s) => (
        <div key={s.stage} className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{multi ? `Stage ${s.stage} tables` : 'Tables'}</span>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              Win {s.ranking.win} · Draw {s.ranking.draw} · Loss {s.ranking.loss} · ranked by {s.ranking.labels.join(', ').toLowerCase()}
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {s.pools.map((p) => (
              <PoolTableView key={p.label} pool={p} ranking={s.ranking} canManage={canManage} names={data.names}
                onResolve={(entities) => setTarget({ scope: 'pool', stage: s.stage, pool: p.pool, entities, title: `Resolve the tie in ${p.label}` })} />
            ))}
          </div>
        </div>
      ))}

      {data.cross_group.length > 0 && (
        // Full width: these few-row tables need every column, Place most of all.
        <div className="space-y-3">
          {data.cross_group.map((c, i) => <CrossGroupView key={`${c.stage}-${c.kind}-${i}`} c={c} multiStage={multi} />)}
        </div>
      )}

      {data.placing_ties.map((t) => (
        <div key={t.entities.join()} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          <span>
            {t.entities.map((id) => data.names[id] ?? id).join(' and ')} are level and share {ordinal(t.from)} place, with its points each. To split them instead, set an order.
          </span>
          {canManage && <Button size="sm" variant="outline" onClick={() => setTarget({ scope: 'placing', stage: t.stage, pool: null, entities: t.entities, title: `Order ${ordinal(t.from)} place` })}>Set order</Button>}
        </div>
      ))}

      {data.resolutions.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Hand-picked orders</span>
          {data.resolutions.map((r) => (
            <div key={r.id ?? r.at} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-800">
              <span className="text-slate-600 dark:text-slate-300">
                <span className="font-semibold">{r.order.map((id) => data.names[id] ?? id).join(' > ')}</span>
                {' · '}{r.reason}{r.by_name ? ` · ${r.by_name}` : ''}{r.at ? ` · ${new Date(r.at).toLocaleDateString()}` : ''}
              </span>
              {canManage && r.id && (
                <Button size="sm" variant="ghost" disabled={clear.isPending}
                  title="Clearing does not empty a knockout slot already filled from this order"
                  onClick={() => clear.mutate(r.id!, { onSuccess: () => toast.success('Order cleared'), onError: (e: any) => toast.error(e.message) })}>
                  Clear
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {target && <ResolveModal drawId={drawId} target={target} names={data.names} onClose={() => setTarget(null)} />}
    </div>
  );
}
