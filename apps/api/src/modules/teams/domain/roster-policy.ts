import type { EntryRules } from '../../tournaments/domain/entry-rules.js';
import { BusinessRuleError } from '../../../shared/errors.js';

// Adding one more member must not exceed squad_max.
export function assertCanAddMember(rules: EntryRules, currentCount: number): void {
  if (currentCount + 1 > rules.squad_max) {
    throw new BusinessRuleError(
      `Squad full: ${rules.entry_type} draw allows at most ${rules.squad_max} member(s)`,
    );
  }
}

// Locking requires the roster size to be within [squad_min, squad_max].
export function assertCanLockRoster(rules: EntryRules, count: number): void {
  if (count < rules.squad_min || count > rules.squad_max) {
    throw new BusinessRuleError(
      `Roster must have between ${rules.squad_min} and ${rules.squad_max} member(s) for a ${rules.entry_type} draw (has ${count})`,
    );
  }
}
