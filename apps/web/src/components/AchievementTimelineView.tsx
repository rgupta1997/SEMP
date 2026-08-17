import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, BadgeCheck, ChevronDown, Medal, Trophy } from 'lucide-react';
import { useApi } from '../lib/hooks';
import { Button, EmptyState, Skeleton, cn } from './ui';

// The Achievement Timeline.
//
// A vertical spine with month markers and cards alternating either side of it. The
// alternation is decorative on a wide screen and actively harmful on a narrow one, so
// below `lg` everything collapses to a single left-aligned column against the spine.
//
// ONE COMPONENT, EVERY SCOPE. An institution's history and a person's are the same
// shape of fact, so they are the same view pointed at a different endpoint - not two
// timelines that drift apart a release at a time. The caller supplies the path and
// says whose history it is; everything below is identical either way, which is the
// point: somebody who plays for their institution and also runs it reads one design
// twice, not two designs once each.

interface Item {
  id: string; date: string; title: string; detail: string | null;
  kind: string; medal: string | null; sport: string | null; recipient: string | null;
  championship_id: string | null; source: string; tags: string[];
}
interface Page { items: Item[]; next_cursor: { date: string; id: string } | null; years: number[] }

const monthKey = (d: string) => d.slice(0, 7);
const monthLabel = (d: string) =>
  new Date(`${d}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', day: '2-digit', year: 'numeric', timeZone: 'UTC' });

/** The icon says what KIND of thing this was, at a glance down the spine. */
function ItemIcon({ item }: { item: Item }) {
  const Icon = item.source === 'validated_claim' ? BadgeCheck : item.medal ? Medal : item.kind === 'award' ? Award : Trophy;
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
      <Icon size={18} aria-hidden />
    </span>
  );
}

function Entry({ item, side, showRecipient }: { item: Item; side: 'left' | 'right'; showRecipient: boolean }) {
  return (
    <li className="relative grid gap-0 lg:grid-cols-[1fr_auto_1fr] lg:gap-8">
      {/* The node on the spine. Filled for a locked result, hollow for a claim -
          so the two kinds of fact stay distinguishable at a glance. */}
      <span
        aria-hidden
        className={cn(
          'absolute left-[7px] top-6 h-2.5 w-2.5 -translate-x-1/2 rounded-full lg:left-1/2',
          item.source === 'validated_claim'
            ? 'border-2 border-slate-400 bg-white dark:bg-slate-900'
            : 'bg-slate-800 dark:bg-slate-200',
        )}
      />
      {side === 'right' && <div className="hidden lg:block" />}
      <div className={cn('ml-7 lg:ml-0', side === 'left' ? 'lg:col-start-1' : 'lg:col-start-3')}>
        <article className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            <ItemIcon item={item} />
            <div className="min-w-0">
              <h3 className="text-base font-semibold leading-tight text-slate-900 dark:text-slate-100">{item.title}</h3>
              <p className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">{longDate(item.date)}</p>
            </div>
          </div>
          {/* The claim's own words if there are any. Otherwise just who it was for -
              echoing the title back as a sentence fills the card without adding
              anything the reader has not already read one line above. On a person's
              own timeline the recipient is always them, so naming them every card is
              noise rather than information. */}
          {item.detail ? (
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{item.detail}</p>
          ) : showRecipient && item.recipient ? (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
              <span className="text-slate-400 dark:text-slate-500">Awarded to </span>
              <span className="font-medium text-slate-800 dark:text-slate-200">{item.recipient}</span>
            </p>
          ) : null}
          {item.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {item.tags.map((t, i) => (
                <span
                  key={t}
                  className={cn('rounded px-2 py-0.5 font-mono text-xs',
                    // The last tag is the distinguishing one (the medal, or that it was
                    // a claim) and carries the emphasis; the rest are context.
                    i === item.tags.length - 1 && (item.medal || item.source === 'validated_claim')
                      ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}
                >{t}</span>
              ))}
            </div>
          )}
          {item.championship_id && (
            <Link
              to={`/championships/${item.championship_id}`}
              className="mt-3 inline-block text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
            >View the event</Link>
          )}
        </article>
      </div>
    </li>
  );
}

export function AchievementTimelineView({ path, title, subtitle, emptyDescription, showRecipient = true }: {
  /** The timeline endpoint for this scope, without query string. Null while unknown. */
  path: string | null;
  title: string;
  /** Whose history this is. Says it in words, so two open tabs are never confusable. */
  subtitle: string;
  emptyDescription?: string;
  showRecipient?: boolean;
}) {
  const [year, setYear] = useState<number | 'all'>('all');
  // Pages accumulate rather than replace: "Load more history" must extend the story,
  // not navigate away from the part already being read.
  const [pages, setPages] = useState<Item[][]>([]);
  const [cursor, setCursor] = useState<{ date: string; id: string } | null>(null);

  const qs = new URLSearchParams({ limit: '20', ...(year !== 'all' ? { year: String(year) } : {}) });
  if (cursor) { qs.set('cursor_date', cursor.date); qs.set('cursor_id', cursor.id); }
  const { data, isLoading } = useApi<Page>(path ? `${path}?${qs}` : null);

  // Everything loaded so far, in order, with the current request on the end.
  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...pages.flat(), ...(data?.items ?? [])].filter((i) => !seen.has(i.id) && seen.add(i.id));
  }, [pages, data]);

  const groups = useMemo(() => {
    const out: Array<{ month: string; items: Item[] }> = [];
    for (const i of items) {
      const k = monthKey(i.date);
      if (out[out.length - 1]?.month !== k) out.push({ month: k, items: [] });
      out[out.length - 1].items.push(i);
    }
    return out;
  }, [items]);

  const pickYear = (y: number | 'all') => { setYear(y); setPages([]); setCursor(null); };
  const loadMore = () => {
    if (!data?.next_cursor) return;
    setPages((p) => [...p, data.items]);
    setCursor(data.next_cursor);
  };

  const chip = (active: boolean) => cn(
    'rounded-full px-4 py-1.5 font-mono text-sm transition',
    active ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
      : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700',
  );

  let index = -1; // Alternation runs across the whole timeline, not restarted per month.

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(data?.years ?? []).slice(0, 4).map((y) => (
            <button key={y} type="button" className={chip(year === y)} onClick={() => pickYear(y)} aria-pressed={year === y}>{y}</button>
          ))}
          <button type="button" className={chip(year === 'all')} onClick={() => pickYear('all')} aria-pressed={year === 'all'}>All time</button>
        </div>
      </div>

      {isLoading && items.length === 0 ? <Skeleton className="h-96" /> : items.length === 0 ? (
        <EmptyState
          icon={<Trophy size={28} />}
          title={year === 'all' ? 'No history yet' : `Nothing recorded in ${year}`}
          description={emptyDescription ?? 'Milestones appear here the moment a result is locked, or when a claimed achievement is validated.'}
        />
      ) : (
        <div className="relative">
          {/* The spine. Left-aligned on narrow screens, centred once cards alternate. */}
          {/* pointer-events-none is load-bearing, not tidiness: the spine runs the full
              height of the timeline at the horizontal centre, which is exactly where the
              centred "Load more history" button sits. Without this it paints over the
              button's midpoint and swallows the click - the button looks enabled and
              simply does nothing. */}
          <span aria-hidden className="pointer-events-none absolute bottom-0 left-[7px] top-0 w-px bg-slate-200 dark:bg-slate-700 lg:left-1/2" />

          <div className="grid gap-8">
            {groups.map((g) => (
              <section key={g.month} className="grid gap-6">
                <div className="relative flex lg:justify-center">
                  <span className="ml-7 rounded-full bg-slate-100 px-3 py-1 font-mono text-xs tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300 lg:ml-0">
                    {monthLabel(g.month)}
                  </span>
                </div>
                <ul className="grid gap-6">
                  {g.items.map((i) => {
                    index += 1;
                    return <Entry key={i.id} item={i} side={index % 2 === 0 ? 'left' : 'right'} showRecipient={showRecipient} />;
                  })}
                </ul>
              </section>
            ))}
          </div>

          <div className="mt-8 flex justify-center">
            {data?.next_cursor ? (
              <Button variant="ghost" onClick={loadMore} disabled={isLoading}>
                {isLoading ? 'Loading…' : 'Load more history'}<ChevronDown size={15} aria-hidden />
              </Button>
            ) : (
              <p className="font-mono text-xs text-slate-400 dark:text-slate-500">
                {year === 'all' ? 'That is the whole history.' : `That is all of ${year}.`}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
