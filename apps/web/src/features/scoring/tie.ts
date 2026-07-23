// Tie-level engine now lives in @semp/shared so the API (demo seeder, scripts) can
// build tie states from the same implementation. Re-exported so existing
// `from '.../tie'` imports (console, seed) keep working.

export {
  rubberDef,
  tieTarget,
  initTie,
  hydrateTie,
  rubbersWon,
  tieWinner,
  applyDead,
  decideRubber,
  reopenRubber,
} from '@semp/shared';
export type { RubberStatus, RubberInstance, TieState } from '@semp/shared';
