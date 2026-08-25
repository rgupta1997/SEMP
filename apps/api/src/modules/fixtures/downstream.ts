import type { Db } from '../../infra/prisma.js';
import type { FixtureParticipants } from './participants.js';
import {
  supersedeAchievements, supersedeLifetimeEntries,
  writeAchievementsFor, writeLifetimeEntriesFor,
} from '../records/records.service.js';

// The seams the lock transaction propagates through.
//
// Two of the three are live as of Wave 3: the lifetime timeline (J4-E2) and
// typed achievements (J4-E4). Certificates (J4-E7) remain a no-op, deliberately -
// the call sits here now so module 07b fills in a body instead of reopening the
// lock and re-deriving its atomicity guarantees a third time.
//
// Every one takes the transaction client: whatever they write has to commit or
// roll back with the lock that produced it.
//
// Each seam derives independently from the same in-transaction snapshot, using
// the same pure function. They stay separately failure-injectable (the lock's
// atomicity tests fail each step in turn, and a step that cannot fail proves
// nothing) while still agreeing on what the result meant.

export interface SupersedeOptions {
  /** Set when unlocking: everything generated from this lock version is now stale. */
  supersedeVersion?: number;
  /**
   * Who the result belongs to, resolved once by the lock (J4-E1-S3) rather than
   * three times by three modules. Team members plus any ranking-event competitor
   * whose phone matched an account.
   */
  participants?: FixtureParticipants;
}

const NO_PARTICIPANTS: FixtureParticipants = { resolved: [], unmatched: [] };

// module 04b - a permanent entry on every participant's lifetime timeline.
export async function writeLifetimeEntries(db: Db, fixtureId: string, opts: SupersedeOptions = {}): Promise<void> {
  // Unlocking: retire what that version said rather than deleting it. A withdrawn
  // result is a fact the record keeps (J4-E2-S2, J4-E4-S3).
  if (opts.supersedeVersion != null) return supersedeLifetimeEntries(db, fixtureId, opts.supersedeVersion);
  return writeLifetimeEntriesFor(db, fixtureId, opts.participants ?? NO_PARTICIPANTS);
}

// module 07a - medals, placements and awards derived from the verified result.
export async function deriveAchievements(db: Db, fixtureId: string, opts: SupersedeOptions = {}): Promise<void> {
  if (opts.supersedeVersion != null) return supersedeAchievements(db, fixtureId, opts.supersedeVersion);
  return writeAchievementsFor(db, fixtureId, opts.participants ?? NO_PARTICIPANTS);
}

// module 07b - certificates queued for generation off the back of a verified result.
export async function queueCertificates(_db: Db, _fixtureId: string, _opts: SupersedeOptions = {}): Promise<void> {
  // TODO(J4-E7): enqueue certificate jobs for this lock_version; on supersede,
  // revoke certificates issued from the superseded version.
}
