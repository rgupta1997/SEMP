import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { SETUP_EVENT_TYPE_INFO, type EventSetupBlueprint } from '@semp/shared';
import { Button, cn, SURFACE } from '../../../components/ui';
import {
  generatedDraws, matchPreviewRows, peopleCounts, squadPreviewRows, type SidePreview,
} from '../preview';
import { FOCUS_RING, Tile } from './pills';

const PREVIEW_PAGE = 200;

/** A <details> drawn as a card: closed by default, because these lists are long. */
function Collapsible({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <details className={cn('group overflow-hidden', SURFACE)}>
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-bold text-slate-800 select-none dark:text-slate-200 [&::-webkit-details-marker]:hidden',
          'rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500',
        )}
      >
        <ChevronRight size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-90" aria-hidden />
        <span className="flex-1">{title}</span>
        {count !== undefined && <span className="t-num font-mono text-xs font-semibold text-slate-400">{count.toLocaleString()}</span>}
      </summary>
      <div className="border-t border-slate-100 dark:border-slate-800">{children}</div>
    </details>
  );
}

function MoreButton({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <div className="flex justify-center border-t border-slate-100 p-2 dark:border-slate-800">
      <Button variant="ghost" size="sm" className={FOCUS_RING} onClick={onMore}>
        Show more ({(total - shown).toLocaleString()} left)
      </Button>
    </div>
  );
}

const TH = 'px-3 py-2 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400';
const TD = 'px-3 py-2 align-top';

function Side({ side }: { side: SidePreview }) {
  return side.kind === 'winner'
    ? <span className="italic text-slate-400 dark:text-slate-500">Winner of {side.matchId}</span>
    : <span className="text-slate-800 dark:text-slate-200">{side.name}</span>;
}

function SquadsPreview({ bp }: { bp: EventSetupBlueprint }) {
  const rows = useMemo(() => squadPreviewRows(bp), [bp]);
  const [shown, setShown] = useState(PREVIEW_PAGE);
  const competitor = SETUP_EVENT_TYPE_INFO[bp.eventType]?.competitor ?? 'Plays for';
  const multiDraw = bp.draws.length > 1;
  return (
    <Collapsible title="Squads" count={rows.length}>
      {rows.length === 0 ? <p className="t-meta p-4">No squads.</p> : (
        <>
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="sticky top-0 bg-white dark:bg-slate-900">
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th scope="col" className={TH}>Squad</th>
                  <th scope="col" className={TH}>Short</th>
                  {multiDraw && <th scope="col" className={TH}>Draw</th>}
                  <th scope="col" className={TH}>{competitor}</th>
                  <th scope="col" className={TH}>Section</th>
                  <th scope="col" className={cn(TH, 'text-right')}>Members</th>
                  <th scope="col" className={TH}>Captain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.slice(0, shown).map((r) => (
                  <tr key={r.key}>
                    <td className={cn(TD, 'font-semibold text-slate-900 dark:text-slate-100')}>{r.name}</td>
                    <td className={cn(TD, 'font-mono text-xs text-slate-500')}>{r.shortName}</td>
                    {multiDraw && <td className={cn(TD, 'text-slate-500')}>{r.draw}</td>}
                    <td className={cn(TD, 'text-slate-700 dark:text-slate-300')}>{r.competitor}</td>
                    <td className={cn(TD, 'text-slate-500')}>{r.section || '-'}</td>
                    <td className={cn(TD, 't-num text-right text-slate-700 dark:text-slate-300')}>{r.members}</td>
                    <td className={cn(TD, 'text-slate-700 dark:text-slate-300')}>{r.captain || <span className="text-rose-600">none</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MoreButton shown={shown} total={rows.length} onMore={() => setShown((n) => n + PREVIEW_PAGE)} />
        </>
      )}
    </Collapsible>
  );
}

function SchedulePreview({ bp }: { bp: EventSetupBlueprint }) {
  const rows = useMemo(() => matchPreviewRows(bp), [bp]);
  const generated = useMemo(() => generatedDraws(bp), [bp]);
  const [shown, setShown] = useState(PREVIEW_PAGE);
  const multiDraw = bp.draws.length > 1;
  return (
    <Collapsible title="Schedule" count={rows.length}>
      {generated.length > 0 && (
        <ul className="flex flex-col gap-1 bg-slate-50/60 px-4 py-2.5 text-[13px] text-slate-600 dark:bg-slate-800/30 dark:text-slate-300">
          {generated.map((g) => (
            <li key={g.draw}>
              <strong className="font-semibold">{g.draw}</strong>: no schedule rows, so the draw is generated from its {g.squads} squads in sheet order.
            </li>
          ))}
        </ul>
      )}
      {rows.length === 0 ? (generated.length === 0 && <p className="t-meta p-4">No matches.</p>) : (
        <>
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="sticky top-0 bg-white dark:bg-slate-900">
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th scope="col" className={TH}>Date</th>
                  <th scope="col" className={TH}>Kickoff</th>
                  <th scope="col" className={TH}>Ground</th>
                  <th scope="col" className={TH}>Match</th>
                  {multiDraw && <th scope="col" className={TH}>Draw</th>}
                  <th scope="col" className={TH}>Side 1</th>
                  <th scope="col" className={TH}>Side 2</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.slice(0, shown).map((r) => (
                  <tr key={r.key}>
                    <td className={cn(TD, 't-num whitespace-nowrap text-slate-600 dark:text-slate-300')}>{r.date}</td>
                    <td className={cn(TD, 't-num text-slate-600 dark:text-slate-300')}>{r.kickoff}</td>
                    <td className={cn(TD, 'whitespace-nowrap text-slate-600 dark:text-slate-300')}>{r.ground}</td>
                    <td className={cn(TD, 'whitespace-nowrap font-mono text-xs text-slate-500')}>{r.matchId}</td>
                    {multiDraw && <td className={cn(TD, 'text-slate-500')}>{r.draw}</td>}
                    <td className={TD}><Side side={r.home} /></td>
                    <td className={TD}><Side side={r.away} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MoreButton shown={shown} total={rows.length} onMore={() => setShown((n) => n + PREVIEW_PAGE)} />
        </>
      )}
    </Collapsible>
  );
}

function PeoplePreview({ bp }: { bp: EventSetupBlueprint }) {
  const c = useMemo(() => peopleCounts(bp), [bp]);
  return (
    <Collapsible title="People" count={c.people + c.staff}>
      <div className="grid grid-cols-2 gap-2.5 p-3 sm:grid-cols-4">
        <Tile label="Players" value={c.people.toLocaleString()} />
        <Tile label="With mobile" value={c.withMobile.toLocaleString()} hint={`of ${c.people.toLocaleString()}`} />
        <Tile label="With email" value={c.withEmail.toLocaleString()} />
        <Tile label="With member ID" value={c.withMemberCode.toLocaleString()} />
        <Tile label="Staff" value={c.staff} />
        <Tile label="Organisers" value={c.organisers} />
        <Tile label="Officials" value={c.officials} />
        <Tile label="POCs" value={c.pocs} />
      </div>
    </Collapsible>
  );
}

/** What the run will build, read back from the validated blueprint. */
export function BlueprintPreviews({ bp }: { bp: EventSetupBlueprint }) {
  return (
    <div className="flex flex-col gap-2.5">
      <SquadsPreview bp={bp} />
      <SchedulePreview bp={bp} />
      <PeoplePreview bp={bp} />
    </div>
  );
}
