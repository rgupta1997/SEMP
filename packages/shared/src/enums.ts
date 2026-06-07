// Enum unions mirroring the DB CHECK constraints. Arrays double as <select> options.

export const EVENT_STATUS = ['draft', 'registration_open', 'ongoing', 'completed'] as const;
export type EventStatus = (typeof EVENT_STATUS)[number];

export const TOURNAMENT_STATUS = ['draft', 'active', 'completed', 'cancelled'] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUS)[number];

export const TOURNAMENT_DISCIPLINE_STATUS = ['upcoming', 'ongoing', 'completed'] as const;
export type TournamentDisciplineStatus = (typeof TOURNAMENT_DISCIPLINE_STATUS)[number];

export const TEAM_STATUS = ['forming', 'submitted', 'approved', 'roster_locked'] as const;
export type TeamStatus = (typeof TEAM_STATUS)[number];

export const TEAM_MEMBER_ROLE = ['captain', 'vice_captain', 'player', 'substitute'] as const;
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLE)[number];

export const FIXTURE_STATUS = [
  'scheduled', 'live', 'completed', 'postponed', 'cancelled', 'bye', 'walkover',
] as const;
export type FixtureStatus = (typeof FIXTURE_STATUS)[number];

export const SPONSOR_TIER = ['title', 'gold', 'silver', 'community'] as const;
export type SponsorTier = (typeof SPONSOR_TIER)[number];

export const GROUND_TYPE = ['court', 'field', 'pool', 'track', 'ring', 'table'] as const;
export type GroundType = (typeof GROUND_TYPE)[number];

export const ENTRY_TYPE = ['team', 'individual', 'doubles', 'relay'] as const;
export type EntryType = (typeof ENTRY_TYPE)[number];

export const ENROLLMENT_STATUS = ['pending', 'approved', 'rejected'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUS)[number];

// Global account type — the user's default app shell. Event-scoped roles
// (user_event_roles) refine capabilities per event; platform admins are flagged
// by users.is_super_admin.
export const ACCOUNT_TYPE = ['organiser', 'institution', 'official', 'participant'] as const;
export type AccountType = (typeof ACCOUNT_TYPE)[number];

// The set of shells the UI can render. 'system' is reserved for super admins.
export const APP_ROLE = ['system', 'organiser', 'institution', 'official', 'participant'] as const;
export type AppRole = (typeof APP_ROLE)[number];

// Legal event status transitions (enforced by the EventLifecycle domain service).
export const EVENT_STATUS_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  draft: ['registration_open'],
  registration_open: ['ongoing', 'draft'],
  ongoing: ['completed'],
  completed: [],
};
