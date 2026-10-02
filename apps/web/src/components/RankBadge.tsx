// Standings position: numbered gold/silver/bronze circles for the top three, plain after.
// Shared by the organiser and public points tables so the two always match.
const RANK_COLORS = [
  { bg: 'var(--gold-500)', color: '#3b1f00' },
  { bg: 'var(--silver)', color: '#1e293b' },
  { bg: 'var(--bronze)', color: '#fff7ed' },
];

export function RankBadge({ pos }: { pos: number }) {
  const c = RANK_COLORS[pos - 1];
  if (!c) return <span className="font-bold tabular-nums text-slate-400 dark:text-slate-500">{pos}</span>;
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold"
      style={{ background: c.bg, color: c.color }}
    >{pos}</span>
  );
}
