import { Badge } from '../ui';
import type { MatchResult } from './types';

const CONFIG: Record<MatchResult, { tone: 'green' | 'rose' | 'amber' | 'slate'; label: string }> = {
  won: { tone: 'green', label: 'Won' },
  lost: { tone: 'rose', label: 'Lost' },
  draw: { tone: 'amber', label: 'Draw' },
  pending: { tone: 'slate', label: 'Upcoming' },
};

// Coloured pill for a participant's result in a match.
export function ResultBadge({ result }: { result: MatchResult }) {
  const c = CONFIG[result] ?? CONFIG.pending;
  return <Badge tone={c.tone}>{c.label}</Badge>;
}
