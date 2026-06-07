import { EVENT_STATUS_TRANSITIONS, type EventStatus } from '@semp/shared';
import { BusinessRuleError } from '../../../shared/errors.js';

// Pure domain rule: is moving from -> to a legal event status transition?
export function assertEventTransition(from: EventStatus, to: EventStatus): void {
  if (from === to) return;
  const allowed = EVENT_STATUS_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new BusinessRuleError(`Cannot move event from '${from}' to '${to}'`);
  }
}
