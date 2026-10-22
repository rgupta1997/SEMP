import type { AwardLevel, AwardRecipientKind } from '@semp/shared';

export interface AwardType {
  id: string;
  code: string;
  label: string;
  description: string | null;
  levels: AwardLevel[];
  recipient_kind: AwardRecipientKind;
  all_sports: boolean;
  is_active: boolean;
  sort_order: number;
  championship_id: string | null;
  sport_ids: string[];
  sports: Array<{ id: string; name: string }>;
  /** Admin list only: how many times it has been given. */
  usage?: number;
}

export interface AwardTypeBody {
  code?: string;
  label: string;
  description: string | null;
  levels: AwardLevel[];
  recipient_kind: AwardRecipientKind;
  is_active: boolean;
  sort_order: number;
  all_sports: boolean;
  sport_ids: string[];
}

export const LEVEL_LABEL: Record<AwardLevel, string> = {
  match: 'Match',
  tournament_sport: 'Sport in tournament',
  tournament: 'Tournament',
  championship: 'Event',
};

export const RECIPIENT_LABEL: Record<AwardRecipientKind, string> = {
  player: 'Player',
  team: 'Team',
};

/** "Best Raider" → "best_raider". */
export const codeFromLabel = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
