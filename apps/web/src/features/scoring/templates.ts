// Resolves the FormatTemplate that drives the scoring console for a fixture.
//
// Order of precedence:
//   1. The draw's explicit config  (tournament_disciplines.format_config.scoring)
//   2. A built-in default derived from the sport's archetype (today's behaviour)
//
// So the hardcoded per-sport `DEFS` in engine.ts is now just the *default library*;
// any client can override per draw without code changes. Single-contest sports keep
// behaving exactly as before when no override is set.

import type { FormatTemplate, ScoringMode } from '@semp/shared';
import { eventTemplateFor, tieTemplateFor } from '@semp/shared';
import { sportDef, type SportDef } from './engine';

// Event (ranking) and tie templates now live in @semp/shared so the API shares them;
// re-export so existing `from '.../templates'` imports (console, seed, setup) keep working.
export { eventTemplateFor, tieTemplateFor };

// Measured / judged sports (athletics, swimming, lifts, chess result) have no
// per-event ticks, so they default to manual entry. Everything else defaults to the
// live, event-by-event console. The organiser can still flip the mode per draw.
function defaultMode(def: SportDef): ScoringMode {
  return def.archetype === 'time' ? 'manual' : 'detailed';
}

function isFormatTemplate(v: any): v is FormatTemplate {
  return !!v && (v.fixtureType === 'single' || v.fixtureType === 'tie' || v.fixtureType === 'event');
}

export function resolveTemplate(fixture: any): FormatTemplate {
  const stored = fixture?.tournament_disciplines?.format_config?.scoring;
  if (isFormatTemplate(stored)) {
    // Persisted templates are validated server-side; trust the shape but backfill a
    // default contest for a single template that predates richer config.
    if (stored.fixtureType === 'single' && !stored.single) {
      stored.single = sportDef(sportName(fixture));
    }
    return stored;
  }
  const def = sportDef(sportName(fixture));
  return { fixtureType: 'single', scoringMode: defaultMode(def), single: def };
}

function sportName(fixture: any): string | null | undefined {
  return fixture?.tournament_disciplines?.tournament_sports?.sports?.name;
}


