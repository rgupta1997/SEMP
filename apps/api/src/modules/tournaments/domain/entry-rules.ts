import type { EntryType } from '@semp/shared';

export interface EntryRules {
  entry_type: EntryType;
  squad_min: number;
  squad_max: number;
}

interface OverrideFields {
  entry_type?: string | null;
  squad_min?: number | null;
  squad_max?: number | null;
}
interface MasterFields {
  entry_type?: string | null;
  squad_min?: number | null;
  squad_max?: number | null;
}

// Pure rule: tournament_discipline override wins, else the master discipline,
// else sane defaults (team sport with one draw, e.g. Cricket with no discipline).
export function resolveEntryRules(override: OverrideFields, master: MasterFields | null): EntryRules {
  return {
    entry_type: (override.entry_type ?? master?.entry_type ?? 'team') as EntryType,
    squad_min: override.squad_min ?? master?.squad_min ?? 1,
    squad_max: override.squad_max ?? master?.squad_max ?? 15,
  };
}
