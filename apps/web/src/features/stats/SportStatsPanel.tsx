import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Medal, RotateCw, ShieldCheck, Trophy, X } from 'lucide-react';
import { isRankingSport, type MatchPosition } from '@semp/shared';
import { useApi, fmtDate } from '../../lib/hooks';
import { EmptyState, PILL_PICK, cn } from '../../components/ui';
import { PickList } from '../../components/PickList';
import { ViewTabs } from '../schedule/ScheduleParts';
import { useSportIcon } from '../personal/SportFilter';

// ============================================================================
// A person's record, by sport - and NOT as one undifferentiated number.
//
// Every sport shows the combined record first, then the tiers that make it up:
// INTER (against other institutions) and INTRA (between departments or campuses of
// one). Adding those together is the thing a career page must not do.
//
// The rollup is READ from the server, never summed here: it is stored alongside its
// parts in the same transaction, so a screen that recomputed it could only disagree.
//
// Disciplines sit under their sport, collapsed - the second question, one click away.
// ============================================================================

interface Metric {
  key: string; label: string; short: string; value: number;
  /** Ready-made display text, where the number alone would mislead - "5/23". */
  text?: string;
  /** A cricket high score that was unbeaten: printed 84*, not 84. */
  notOut?: boolean;
  percent?: boolean; headline?: boolean; higherIsBetter?: boolean;
}
interface TierRecord {
  tier: 'all' | 'inter' | 'intra';
  label: string; hint?: string;
  played: number; won: number; lost: number; drawn: number;
  winPct: number | null;
  gold: number; silver: number; bronze: number; awards: number;
  firstOn: string | null; lastOn: string | null;
  metrics: Metric[];
}
interface DisciplineRecord {
  disciplineId: string; discipline: string;
  overall: TierRecord; tiers: TierRecord[];
  /** Tie rubbers played inside a team discipline. */
  rubbers?: Array<{ label: string; played: number; won: number; lost: number }>;
}
interface PositionRecord {
  position: MatchPosition;
  overall: TierRecord; tiers: TierRecord[];
}
interface SportRecord {
  sportId: string; sport: string;
  overall: TierRecord; tiers: TierRecord[];
  disciplines: DisciplineRecord[];
  /** Singles and doubles - racquet sports, once results say which. */
  positions?: PositionRecord[];
}
interface PersonRecord { userId: string; name: string; played: number; won: number; lost: number }
/** One opposing side: a player in singles, a pair in doubles. */
interface OpponentRecord {
  position: MatchPosition; userIds: string[]; names: string[];
  partnerId: string | null; partnerName: string | null;
  played: number; won: number; lost: number;
}
interface Relations { partners: PersonRecord[]; opponents: OpponentRecord[] }
interface Payload {
  sports: SportRecord[];
  filters: Array<{ sportId: string; sport: string; disciplines: Array<{ id: string; name: string }> }>;
}

const LABEL = 'text-[10px] font-black uppercase tracking-[0.14em] text-slate-400';
const TOGGLE = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:text-[var(--accent-deep)] hover:ring-[var(--accent-deep)]/40 dark:text-slate-200 dark:ring-slate-700';
const MEDAL_TONE = { gold: 'text-amber-500', silver: 'text-slate-400', bronze: 'text-orange-600' } as const;

const fmt = (m: Metric) =>
  m.text ?? (m.percent ? `${m.value}%` : `${m.value}${m.notOut ? '*' : ''}`);

// Null (not 0%) with nothing played yet - "always loses" and "hasn't competed" aren't the
// same fact. Capped at 100: `played` is per FIXTURE but medals are per RACE.
const podiumPct = (r: TierRecord): number | null =>
  r.played > 0 ? Math.min(100, Math.round(((r.gold + r.silver + r.bronze) / r.played) * 1000) / 10) : null;

/** The record as chips: played, then W / L / D in colour - or podium rate for a ranking sport,
 *  which has no opponent to beat. */
function Record({ r, ranking, size = 'md' }: { r: TierRecord; ranking?: boolean; size?: 'md' | 'sm' }) {
  const chip = cn('inline-flex items-center rounded-md font-black tabular-nums', size === 'md' ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-px text-[11px]');
  const pct = ranking ? podiumPct(r) : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={cn(chip, 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200')}>{r.played} played</span>
      {ranking ? (pct != null && <span className={cn(chip, 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200')}>{pct}% podium</span>) : (
        <>
          <span className={cn(chip, 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300')}>{r.won}W</span>
          <span className={cn(chip, 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300')}>{r.lost}L</span>
          {r.drawn > 0 && <span className={cn(chip, 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>{r.drawn}D</span>}
        </>
      )}
    </span>
  );
}

function Medals({ r }: { r: TierRecord }) {
  if (!r.gold && !r.silver && !r.bronze && !r.awards) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2.5 text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">
      {(['gold', 'silver', 'bronze'] as const).map((m) => r[m] > 0 && (
        <span key={m} className="inline-flex items-center gap-0.5" title={`${r[m]} ${m}`}><Medal size={14} className={MEDAL_TONE[m]} aria-hidden />{r[m]}</span>
      ))}
      {r.awards > 0 && <span className="inline-flex items-center gap-0.5 text-violet-600 dark:text-violet-300"><Trophy size={13} aria-hidden />{r.awards} award{r.awards === 1 ? '' : 's'}</span>}
    </span>
  );
}

/** The sport's own measures, as soft tiles. Empty is normal - not every result records them. */
function Metrics({ metrics, dense }: { metrics: Metric[]; dense?: boolean }) {
  if (!metrics.length) return null;
  const shown = dense ? metrics.filter((m) => m.headline).slice(0, 6) : metrics;
  if (!shown.length) return null;
  return (
    <div className={cn('mt-3 grid gap-2', dense ? 'grid-cols-[repeat(auto-fill,minmax(96px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(120px,1fr))]')}>
      {shown.map((m) => (
        <div key={m.key} className="min-w-0 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
          <div className={cn('font-black tabular-nums', dense ? 'text-base' : 'text-lg', m.higherIsBetter === false ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-slate-100')}>{fmt(m)}</div>
          <div className="text-[11px] font-semibold leading-tight text-slate-500 dark:text-slate-400">{m.label}</div>
        </div>
      ))}
    </div>
  );
}

/** One competition level under a sport. */
function TierRow({ r, ranking }: { r: TierRecord; ranking?: boolean }) {
  return (
    <div className="border-t border-slate-100 py-3 first:border-t-0 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">{r.label}</span>
          {r.hint && <span className="block text-[11.5px] text-slate-500 dark:text-slate-400">{r.hint}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-3"><Medals r={r} /><Record r={r} ranking={ranking} size="sm" /></span>
      </div>
      <Metrics metrics={r.metrics} dense />
    </div>
  );
}

interface InsightItem {
  key: string; tone: 'strength' | 'weakness' | 'up' | 'down'; text: string;
  /** The counts behind it and the rule that made it a strength, a weakness or a trend. */
  evidence?: { facts: Array<{ label: string; value: string }>; rule: string };
  /** Based on little data - shown, but marked as an early sign. */
  early?: boolean;
}

/** A small tag on an insight built on little data, so it is read as a hint, not a verdict. */
const EarlySign = () => (
  <span title="Based on only a little data so far - it may change as more matches are played"
    className="ml-1.5 whitespace-nowrap rounded-md px-1.5 py-px text-[9px] font-black uppercase tracking-wider text-slate-500 ring-1 ring-slate-200 dark:text-slate-400 dark:ring-slate-700">
    early sign
  </span>
);
interface InsightReport {
  enoughData: boolean;
  strengths: InsightItem[]; weaknesses: InsightItem[]; trends: InsightItem[];
  form: Array<'W' | 'L' | 'D'>;
}

const FORM_CHIP: Record<string, string> = { W: 'bg-emerald-500 text-white', L: 'bg-rose-500 text-white', D: 'bg-slate-400 text-white' };
const TONE = {
  strength: { mark: '✓', cls: 'text-emerald-600 dark:text-emerald-400' },
  weakness: { mark: '!', cls: 'text-rose-500' },
  up: { mark: '▲', cls: 'text-emerald-600 dark:text-emerald-400' },
  down: { mark: '▼', cls: 'text-rose-500' },
} as const;

/** Plain-word insights; the card flips to show the counts and rule behind each, so none is taken on trust. */
function InsightsCard({ userId, sportId, view }: { userId?: string; sportId: string; view: PlayView }) {
  const base = userId ? `/people/${userId}/sport-insights` : '/me/sport-insights';
  // Follows the All / Singles / Doubles switch: a format's tab reads that format only.
  const { data } = useApi<InsightReport | null>(`${base}?sport=${sportId}${view === 'all' ? '' : `&position=${view}`}`);
  const [face, setFace] = useState<'front' | 'back'>('front');
  const [angle, setAngle] = useState(0);
  // A two-step turn - to edge-on, swap the face, back to flat - so the card takes the
  // height of whichever side is showing rather than the taller of the two.
  const flip = () => {
    const swap = () => setFace((f) => (f === 'front' ? 'back' : 'front'));
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { swap(); return; }
    setAngle(90);
    window.setTimeout(() => { swap(); setAngle(0); }, 180);
  };
  if (!data) return null;
  if (!data.enoughData) {
    return <p className="mb-3 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 dark:border-slate-700">Insights appear after a few more {view === 'all' ? '' : `${view} `}results.</p>;
  }
  const block = (title: string, items: InsightItem[], tint: string) => items.length > 0 && (
    <div className={cn('min-w-0 rounded-xl px-3 py-2.5', tint)}>
      <div className={cn(LABEL, 'mb-1.5')}>{title}</div>
      {items.map((i) => (
        <div key={i.key} className="mb-1 flex gap-2 text-[13px] leading-snug last:mb-0">
          <span className={cn('font-black', TONE[i.tone].cls)}>{TONE[i.tone].mark}</span>
          <span className="text-slate-700 dark:text-slate-200">{i.text}{i.early && <EarlySign />}</span>
        </div>
      ))}
    </div>
  );
  const flipButton = (label: string) => (
    <button type="button" onClick={flip} className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-[var(--accent-deep)] hover:underline dark:text-[var(--accent)]">
      {label}<RotateCw size={12} aria-hidden />
    </button>
  );

  const front = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {data.form.length > 0 ? (
          <span className="flex items-center gap-1.5">
            <span className={LABEL}>Last {data.form.length}</span>
            {data.form.map((r, n) => <span key={n} className={cn('grid h-5 w-5 place-items-center rounded-md text-[10px] font-black', FORM_CHIP[r])}>{r}</span>)}
          </span>
        ) : <span />}
        {flipButton('How is this worked out?')}
      </div>
      <div className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        {block('Strengths', data.strengths, 'bg-emerald-50/70 dark:bg-emerald-500/5')}
        {block('Work on', data.weaknesses, 'bg-rose-50/70 dark:bg-rose-500/5')}
        {block('Trend', data.trends, 'bg-slate-50 dark:bg-slate-800/40')}
      </div>
    </>
  );

  // The back: each insight with its counts and its rule.
  const all = [...data.strengths, ...data.weaknesses, ...data.trends];
  const back = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={LABEL}>How these are worked out</span>
        {flipButton('Back to insights')}
      </div>
      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Counted from the points recorded by the scorer in locked matches. The figures are exact counts;
        whether one is called a strength or something to work on follows the rule shown under it.
        Where enough other players have played, you are compared with what is typical for them.
        Pressure figures come from singles when there is enough - in doubles they belong to the pair.
        An &ldquo;early sign&rdquo; is based on only a little data so far.
      </p>
      <div className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
        {all.map((i) => (
          <div key={`${i.tone}-${i.key}`} className="grid gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-700">
            <div className="flex gap-2 text-[13px] font-bold leading-snug">
              <span className={cn('font-black', TONE[i.tone].cls)}>{TONE[i.tone].mark}</span>
              <span>{i.text}{i.early && <EarlySign />}</span>
            </div>
            {i.evidence && (
              <>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  {i.evidence.facts.map((f) => (
                    <div key={f.label} className="contents">
                      <span className="text-slate-500 dark:text-slate-400">{f.label}</span>
                      <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{f.value}</span>
                    </div>
                  ))}
                </div>
                <div className="text-[11.5px] italic text-slate-500 dark:text-slate-400">Rule: {i.evidence.rule}</div>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div className="mb-4 [perspective:1200px]">
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 transition-transform duration-200 ease-in-out dark:border-slate-700 dark:bg-slate-900"
        style={{ transform: `rotateY(${angle}deg)` }}>
        {face === 'front' ? front : back}
      </div>
    </div>
  );
}

/** Who they play with and against. Fetched only when opened - most visits never ask. */
function PeopleSection({ userId, sportId, view }: { userId?: string; sportId: string; view: PlayView }) {
  const [open, setOpen] = useState(false);
  const base = userId ? `/people/${userId}/sport-relations` : '/me/sport-relations';
  const { data, isLoading } = useApi<Relations>(open ? `${base}?sport=${sportId}` : null);
  const row = (key: string, who: ReactNode, r: { won: number; lost: number; played: number }) => (
    <div key={key} className="flex items-center justify-between gap-3 border-t border-slate-100 py-2 text-[13px] first:border-t-0 dark:border-slate-800">
      <span className="min-w-0 text-slate-700 dark:text-slate-200">{who}</span>
      <span className="shrink-0 text-xs font-bold tabular-nums">
        <span className="text-emerald-600 dark:text-emerald-400">{r.won}W</span> <span className="text-rose-500">{r.lost}L</span>
        <span className="font-semibold text-slate-400"> · {r.played} played</span>
      </span>
    </div>
  );
  // Each match is one row, so the rows add up to the matches played. A doubles row names both pairs.
  const opponents = (position: MatchPosition) => {
    const rows = data?.opponents.filter((o) => o.position === position) ?? [];
    if (!rows.length) return null;
    return (
      <div className="mt-2">
        <div className={cn(LABEL, 'mb-1')}>{position === 'singles' ? 'Singles' : 'Doubles'}</div>
        {rows.map((o) => row(
          `${o.partnerId ?? ''}|${o.userIds.join('|')}`,
          <>{o.partnerName && <>with <b>{o.partnerName}</b>{' '}</>}vs <b>{o.names.join(' / ')}</b></>,
          o,
        ))}
      </div>
    );
  };
  // Follows the All / Singles / Doubles tab above.
  const shown = view === 'all' ? ['singles', 'doubles'] as const : [view] as const;
  const any = !!data?.opponents.some((o) => (shown as readonly string[]).includes(o.position));
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={TOGGLE}>
        {open ? 'Hide' : 'Show'} {view === 'singles' ? 'head-to-head' : 'partners & head-to-head'}
        <ChevronDown size={13} className={cn('transition', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (isLoading ? <p className="mt-2 text-xs text-slate-400">Loading…</p> : !any ? (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">No named opponents{view === 'all' ? '' : ` in ${view}`} yet - they appear once matches record who played.</p>
      ) : (
        <div className="mt-2 rounded-xl bg-slate-50/70 px-3 py-1 dark:bg-slate-800/30">{shown.map((p) => <div key={p}>{opponents(p)}</div>)}</div>
      ))}
    </div>
  );
}

type PlayView = 'all' | MatchPosition;

function SportCard({ s, userId }: { s: SportRecord; userId?: string }) {
  const iconOf = useSportIcon();
  const [open, setOpen] = useState(false);
  // Singles and doubles are different games; the split is one tap away when known.
  const [view, setView] = useState<PlayView>('all');
  const positions = s.positions ?? [];
  const picked = view === 'all' ? null : positions.find((p) => p.position === view) ?? null;
  const shown = picked ? { overall: picked.overall, tiers: picked.tiers } : { overall: s.overall, tiers: s.tiers };
  // A ranking event has no opponent, so "won/lost" doesn't describe it.
  const ranking = isRankingSport(s.sport);
  const headline = ranking ? podiumPct(shown.overall) : shown.overall.winPct;
  const o = s.overall;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#0a1630] text-2xl" aria-hidden>{iconOf(s.sport)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-black text-slate-900 dark:text-slate-100">{s.sport}</span>
          {o.lastOn && <span className="block text-xs text-slate-500 dark:text-slate-400">Last played {fmtDate(o.lastOn)}{o.firstOn && o.firstOn !== o.lastOn ? ` · since ${fmtDate(o.firstOn)}` : ''}</span>}
        </span>
        {/* The one number someone came for: win rate, or podium rate in a ranking sport. */}
        <span className="text-right">
          <span className="block text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">{headline != null ? `${headline}%` : '-'}</span>
          <span className={LABEL}>{ranking ? 'Podium rate' : 'Win rate'}</span>
        </span>
      </div>

      <div className="space-y-4 p-4">
        {positions.length > 0 && (
          <ViewTabs size="sm" value={view} onChange={setView}
            options={(['all', ...positions.map((p) => p.position)] as PlayView[]).map((v) => ({ value: v, label: v === 'all' ? 'All' : v === 'singles' ? 'Singles' : 'Doubles' }))} />
        )}

        {/* What the numbers mean, before the numbers - under the switch, which it follows. */}
        {!ranking && <InsightsCard userId={userId} sportId={s.sportId} view={view} />}

        {/* The combined record leads, because it is the number somebody came for. */}
        <div>
          <div className="flex flex-wrap items-center gap-3"><Record r={shown.overall} ranking={ranking} /><Medals r={shown.overall} /></div>
          <Metrics metrics={shown.overall.metrics} />
          {/* Doubles has both: pair tiles for the side, the rest personal. */}
          {view !== 'singles' && positions.some((p) => p.position === 'doubles') && shown.overall.metrics.some((m) => m.key === 'service_points_played') && (
            <p className="mt-2 text-[11.5px] text-slate-500 dark:text-slate-400">Doubles: "Points your pair served / received" count the whole pair. The other serve and receive tiles count only your own serves and returns.</p>
          )}
        </div>

        {/* The split, only when there IS one - a zeroed row would read as something missing. */}
        {shown.tiers.length > 1 && (
          <div>
            <div className={cn(LABEL, 'mb-1')}>By competition level</div>
            <div className="rounded-xl border border-slate-100 px-3 dark:border-slate-800">{shown.tiers.map((t) => <TierRow key={t.tier} r={t} ranking={ranking} />)}</div>
          </div>
        )}
        {shown.tiers.length === 1 && <p className="text-xs text-slate-500 dark:text-slate-400">All {shown.tiers[0].label.toLowerCase()}.</p>}

        <div className="flex flex-wrap gap-2">
          {!ranking && <PeopleSection userId={userId} sportId={s.sportId} view={view} />}
          {view === 'all' && s.disciplines.length > 0 && (
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={cn(TOGGLE, 'self-start')}>
              {open ? 'Hide' : 'Show'} {s.disciplines.length} discipline{s.disciplines.length === 1 ? '' : 's'}
              <ChevronDown size={13} className={cn('transition', open && 'rotate-180')} aria-hidden />
            </button>
          )}
        </div>
        {view === 'all' && open && (
          <div className="rounded-xl border border-slate-100 px-3 dark:border-slate-800">
            {s.disciplines.map((d) => (
              <div key={d.disciplineId} className="border-t border-slate-100 py-3 first:border-t-0 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{d.discipline}</span>
                  <Record r={d.overall} ranking={ranking} size="sm" />
                </div>
                {/* A team discipline names the rubbers inside it: "Mixed · Men's Singles rubber · 0W 1L". */}
                {d.rubbers?.map((r) => (
                  <div key={r.label} className="mt-1 text-xs tabular-nums text-slate-600 dark:text-slate-300">
                    {d.discipline} · {r.label} rubber · {r.won}W {r.lost}L
                    {r.played > r.won + r.lost && <span className="text-slate-400"> · {r.played} played</span>}
                  </div>
                ))}
                {d.tiers.length > 1 && (
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {d.tiers.map((t) => ranking
                      ? `${t.label}: ${t.played} played${podiumPct(t) != null ? `, ${podiumPct(t)}% podium` : ''}`
                      : `${t.label}: ${t.played} played, ${t.won}W ${t.lost}L`).join('  ·  ')}
                  </div>
                )}
                <Metrics metrics={d.overall.metrics} dense />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function SportStatsPanel({ userId }: { userId?: string }) {
  const [sportId, setSportId] = useState('');
  const [disciplineId, setDisciplineId] = useState('');

  const qs = new URLSearchParams();
  if (sportId) qs.set('sport', sportId);
  if (disciplineId) qs.set('discipline', disciplineId);
  const base = userId ? `/people/${userId}/sport-stats` : '/me/sport-stats';
  const { data, isLoading } = useApi<Payload>(`${base}${qs.toString() ? `?${qs}` : ''}`);

  // The discipline list follows the chosen sport; with none chosen the sport goes in
  // front, so three identical "Men's" options each say what they are.
  const disciplines = useMemo(() => {
    if (!data) return [];
    if (sportId) {
      return (data.filters.find((f) => f.sportId === sportId)?.disciplines ?? []).map((d) => ({ value: d.id, label: d.name }));
    }
    return data.filters.flatMap((f) => f.disciplines.map((d) => ({ value: d.id, label: `${f.sport} · ${d.name}` })));
  }, [data, sportId]);

  if (isLoading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading">
        <span className="block h-9 w-80 max-w-full animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
        {[0, 1].map((i) => <span key={i} className="block h-56 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />)}
      </div>
    );
  }
  if (!data || !data.sports.length) {
    return (
      <EmptyState
        icon={<Trophy size={22} />}
        title={sportId || disciplineId ? 'Nothing under that filter' : 'No statistics yet'}
        description={sportId || disciplineId
          ? 'You have no record in that sport or discipline. Clear the filter to see everything.'
          : 'Your record fills in as results are made official. Play a match and ask the organiser to lock the scorecard.'}
        action={sportId || disciplineId ? <button type="button" onClick={() => { setSportId(''); setDisciplineId(''); }}><X size={14} aria-hidden />Clear filters</button> : undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-48">
          <PickList value={sportId} onChange={(v) => { setSportId(v); setDisciplineId(''); }} ariaLabel="Sport" className={PILL_PICK} searchPlaceholder="Search sports"
            options={[{ value: '', label: 'All sports' }, ...[...data.filters].sort((a, b) => a.sport.localeCompare(b.sport)).map((f) => ({ value: f.sportId, label: f.sport }))]} />
        </div>
        {disciplines.length > 0 && (
          <div className="w-full sm:w-60">
            <PickList value={disciplineId} onChange={setDisciplineId} ariaLabel="Discipline" className={PILL_PICK} searchPlaceholder="Search disciplines"
              options={[{ value: '', label: 'All disciplines' }, ...disciplines]} />
          </div>
        )}
        {(sportId || disciplineId) && (
          <button type="button" onClick={() => { setSportId(''); setDisciplineId(''); }}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-50 dark:text-rose-300 dark:ring-rose-500/30">
            <X size={12} aria-hidden />Clear
          </button>
        )}
      </div>

      {data.sports.map((s) => <SportCard key={s.sportId} s={s} userId={userId} />)}

      <p className="flex items-start gap-2 text-[11.5px] text-slate-500 dark:text-slate-400">
        <ShieldCheck size={14} className="mt-px shrink-0 text-emerald-600" aria-hidden />
        Only results from locked scorecards count. A result unlocked for a correction drops out until it is locked again - these figures are rebuilt from the record each time, never adjusted by hand.
      </p>
    </div>
  );
}

