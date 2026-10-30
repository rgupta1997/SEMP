import { Medal } from 'lucide-react';
import { Card } from '../../components/ui';

export interface BoardEventAward {
  id: string;
  level: 'tournament_sport' | 'tournament' | 'championship';
  tournament_name: string | null;
  sport_name: string | null;
  award_name: string;
  recipient_name: string | null;
  recipient_kind: 'player' | 'team';
}

export interface BoardMatchAward {
  id: string;
  fixture_id: string;
  award_name: string;
  recipient_name: string | null;
  team_award: boolean;
}

export interface AwardsBoardData { event: BoardEventAward[]; match: BoardMatchAward[] }

const scopeOf = (a: BoardEventAward) =>
  a.level === 'championship' ? 'Event'
    : a.level === 'tournament' ? a.tournament_name ?? 'Tournament'
      : a.sport_name ?? 'Sport';

// The event's honours above match level - who won what for a sport, a tournament or
// the whole event. Shown on Results to everybody who can see the results.
export function AwardsBoard({ awards }: { awards: BoardEventAward[] }) {
  if (awards.length === 0) return null;
  const order = { championship: 0, tournament: 1, tournament_sport: 2 } as const;
  const sorted = [...awards].sort((a, b) => order[a.level] - order[b.level] || scopeOf(a).localeCompare(scopeOf(b)));
  return (
    <Card className="p-4" data-qa="awards-board">
      <div className="mb-2 flex items-center gap-2">
        <Medal size={16} className="text-amber-500" aria-hidden />
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Awards</h2>
      </div>
      <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {sorted.map((a) => (
          <li key={a.id} className="flex min-w-0 items-baseline gap-2 text-sm">
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{scopeOf(a)}</span>
            <span className="min-w-0 truncate">
              <span className="font-medium text-slate-800 dark:text-slate-200">{a.award_name}</span>
              <span className="text-slate-500 dark:text-slate-400"> · {a.recipient_name ?? '-'}{a.recipient_kind === 'team' ? ' (team)' : ''}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** One line under a match: "🏅 Player of the Match: Asha · Fair Play: Riders". */
export function MatchAwardsLine({ awards }: { awards: BoardMatchAward[] }) {
  if (awards.length === 0) return null;
  return (
    <div data-qa="match-awards" className="flex min-w-0 items-center gap-1.5 truncate text-[12px] text-slate-500 dark:text-slate-400">
      <Medal size={12} className="shrink-0 text-amber-500" aria-hidden />
      <span className="truncate">
        {awards.map((a) => `${a.award_name}: ${a.recipient_name ?? '-'}`).join(' · ')}
      </span>
    </div>
  );
}
