import { CHAMPIONSHIP_STATUS_TRANSITIONS, type ChampionshipStatus } from '@semp/shared';
import { BusinessRuleError } from '../../../shared/errors.js';

// Pure domain rule: is moving from -> to a legal championship status transition?
export function assertChampionshipTransition(from: ChampionshipStatus, to: ChampionshipStatus): void {
  if (from === to) return;
  const allowed = CHAMPIONSHIP_STATUS_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new BusinessRuleError(`Cannot move championship from '${from}' to '${to}'`);
  }
}
