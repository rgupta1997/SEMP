// Timetable contradictions: a team cannot be in two places at once, a ground can
// only host one match at a time, and an official can only score one of them.
//
// Pure on purpose - the scheduling rules are the part worth testing, and keeping
// them free of Prisma means they can be exercised without a database and reused by
// anything that already holds the fixture list (the organiser's Schedule view, a
// future auto-scheduler, a validation step on import).
//
// Advisory, never a refusal: an organiser mid-shuffle is legitimately double-booked
// for a few seconds, and a scheduler that rejects the intermediate state is a
// scheduler nobody uses.

export type ClashKind = 'ground' | 'team' | 'official';

export interface SchedulableFixture {
  id: string;
  scheduledAt: Date | string | null | undefined;
  durationMinutes?: number | null;
  groundId?: string | null;
  officialId?: string | null;
  teamIds?: Array<string | null | undefined>;
  status?: string | null;
}

export interface Clash {
  kind: ClashKind;
  /** The earlier-starting fixture of the overlapping pair. */
  fixture_id: string;
  other_fixture_id: string;
  /** The ground / team / official that is double-booked. */
  subject_id: string;
}

// A match with no stated duration still occupies its ground and its teams. An hour
// is what the timeline already assumes when it lays an unsized match out.
export const DEFAULT_DURATION_MINUTES = 60;

// Statuses where nobody actually turns up, so sharing a slot is not a clash.
const NOT_CONTESTED = new Set(['cancelled', 'postponed', 'bye', 'walkover']);

interface Slot {
  id: string;
  start: number;
  end: number;
  groundId: string | null;
  officialId: string | null;
  teamIds: string[];
}

function toSlot(f: SchedulableFixture, defaultDuration: number): Slot | null {
  if (!f.scheduledAt) return null; // an unplaced match cannot clash with anything
  if (f.status && NOT_CONTESTED.has(f.status)) return null;
  const start = new Date(f.scheduledAt).getTime();
  if (Number.isNaN(start)) return null;
  const minutes = f.durationMinutes && f.durationMinutes > 0 ? f.durationMinutes : defaultDuration;
  return {
    id: f.id,
    start,
    end: start + minutes * 60_000,
    groundId: f.groundId ?? null,
    officialId: f.officialId ?? null,
    teamIds: (f.teamIds ?? []).filter((t): t is string => !!t),
  };
}

/**
 * Every clash in the given fixtures, one entry per overlapping pair per reason - a
 * pair sharing both a ground and a team reports both, because they are two separate
 * things for the organiser to fix.
 */
export function findClashes(
  fixtures: SchedulableFixture[],
  defaultDurationMinutes = DEFAULT_DURATION_MINUTES,
): Clash[] {
  const slots = fixtures
    .map((f) => toSlot(f, defaultDurationMinutes))
    .filter((s): s is Slot => s !== null)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));

  const out: Clash[] = [];
  for (let i = 0; i < slots.length; i++) {
    const a = slots[i];
    for (let j = i + 1; j < slots.length; j++) {
      const b = slots[j];
      // Sorted by start, so once b begins at or after a ends, so does everything
      // after it - nothing further can overlap a.
      if (b.start >= a.end) break;

      if (a.groundId && a.groundId === b.groundId) {
        out.push({ kind: 'ground', fixture_id: a.id, other_fixture_id: b.id, subject_id: a.groundId });
      }
      for (const team of a.teamIds) {
        if (b.teamIds.includes(team)) {
          out.push({ kind: 'team', fixture_id: a.id, other_fixture_id: b.id, subject_id: team });
        }
      }
      if (a.officialId && a.officialId === b.officialId) {
        out.push({ kind: 'official', fixture_id: a.id, other_fixture_id: b.id, subject_id: a.officialId });
      }
    }
  }
  return out;
}

/**
 * The same clashes indexed by fixture, both ways round - the UI marks a row from
 * whichever side of the pair it is rendering.
 */
export function clashesByFixture(clashes: Clash[]): Record<string, Clash[]> {
  const out: Record<string, Clash[]> = {};
  const add = (id: string, c: Clash) => { (out[id] ??= []).push(c); };
  for (const c of clashes) {
    add(c.fixture_id, c);
    add(c.other_fixture_id, c);
  }
  return out;
}
