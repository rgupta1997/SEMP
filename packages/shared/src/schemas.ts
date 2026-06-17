import { z } from 'zod';
import {
  ENTRY_TYPE, ENROLLMENT_STATUS, CHAMPIONSHIP_STATUS, FIXTURE_STATUS, GROUND_TYPE,
  NOTIFICATION_AUDIENCE, NOTIFICATION_REACTIONS, ORGANIZATION_MEMBER_ROLE,
  SPONSOR_TIER, TEAM_MEMBER_ROLE, TEAM_STATUS, TOURNAMENT_DISCIPLINE_STATUS,
  TOURNAMENT_STATUS,
} from './enums.js';

const uuid = z.string().uuid();
const json = z.record(z.any());

// ---------- Auth ----------
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional(),
});

// Change your own password. `current_password` is required for a normal change but
// skipped on a forced first-login change (the user just authenticated with the
// temporary password and may not know it as a "current" secret).
export const changePasswordSchema = z.object({
  current_password: z.string().optional(),
  new_password: z.string().min(6),
});

// Self-serve sign up — every login is just a user. There is no account-type
// choice: a user becomes an organiser by hosting a championship, a member by
// joining/creating an organization, an official by being assigned to one.
export const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional(),
});

// ---------- Users (admin / organiser / org-owner managed) ----------
// Creating a login for someone else (a teammate, an official, a member). The
// password is optional — the server falls back to the shared default so the
// account can sign in immediately and reset later.
export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6).optional(),
  phone: z.string().optional(),
  organization_id: uuid.nullable().optional(),
});
export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  organization_id: uuid.nullable().optional(),
  password: z.string().min(6).optional(),
});

// Bulk-create logins from a spreadsheet/paste. Each row is matched-or-created by
// email; when championship_id + role_id are supplied the new users are also
// assigned that championship-scoped role.
const bulkUserRowSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
});
export const bulkCreateUsersSchema = z.object({
  users: z.array(bulkUserRowSchema).min(1).max(500),
  organization_id: uuid.nullable().optional(),
  championship_id: uuid.optional(),
  role_id: uuid.optional(),
});

// ---------- Phase 1: platform setup ----------
export const createPermissionSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  rules: z.array(json).default([]),
});
export const updatePermissionSchema = createPermissionSchema.partial();

export const createRoleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  permission_ids: z.array(uuid).default([]),
});
export const updateRoleSchema = createRoleSchema.partial();

export const createSportSchema = z.object({
  name: z.string().min(1),
  icon: z.string().optional(),
});
export const updateSportSchema = createSportSchema.partial();

export const createDisciplineSchema = z.object({
  sport_id: uuid,
  name: z.string().min(1),
  description: z.string().optional(),
  entry_type: z.enum(ENTRY_TYPE).default('team'),
  squad_min: z.number().int().min(1).default(1),
  squad_max: z.number().int().min(1).default(15),
  display_order: z.number().int().default(0),
});
export const updateDisciplineSchema = createDisciplineSchema.partial();

export const createFormatSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  config: json.default({}),
});
export const updateFormatSchema = createFormatSchema.partial();

export const createOrganizationSchema = z.object({
  name: z.string().min(1),
  short_name: z.string().optional(),
  code: z.string().optional(),
  logo_url: z.string().optional(),
  city: z.string().optional(),
  status: z.boolean().optional(),
  country: z.string().default('India'),
});
export const updateOrganizationSchema = createOrganizationSchema.partial();

// Create an organization and (optionally) its first owner in one step. The owner
// becomes an `owner` member of the new organization.
export const createOrganizationWithOwnerSchema = createOrganizationSchema.extend({
  owner: z
    .object({
      // Either link an existing user (found by phone) ...
      user_id: uuid.optional(),
      // ... or provide details to create a new login.
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      password: z.string().min(6).optional(),
      phone: z.string().optional(),
    })
    .refine((o) => !!(o.user_id || (o.name && o.email)), { message: 'Provide an existing user or a name and email' })
    .optional(),
});

// Add / invite a member to an organization with a per-org role.
export const addOrganizationMemberSchema = z.object({
  user_id: uuid.optional(),
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  role: z.enum(ORGANIZATION_MEMBER_ROLE).default('member'),
}).refine((m) => !!(m.user_id || m.email || m.phone), { message: 'Provide a user, a phone, or an email' });
export const updateOrganizationMemberSchema = z.object({
  role: z.enum(ORGANIZATION_MEMBER_ROLE).optional(),
  status: z.enum(['active', 'past'] as const).optional(),
});

// ---------- Phase 2: championship creation ----------
export const createChampionshipSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'lowercase letters, numbers, hyphens only'),
  description: z.string().optional(),
  venue: z.string().optional(),
  start_date: z.coerce.date(),
  end_date: z.coerce.date(),
  status: z.enum(CHAMPIONSHIP_STATUS).optional(),
});
export const updateChampionshipSchema = createChampionshipSchema.partial();
export const updateChampionshipStatusSchema = z.object({ status: z.enum(CHAMPIONSHIP_STATUS) });

export const createVenueSchema = z.object({
  championship_id: uuid,
  name: z.string().min(1),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().default('India'),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});
export const updateVenueSchema = createVenueSchema.partial();

export const createGroundSchema = z.object({
  venue_id: uuid,
  name: z.string().min(1),
  ground_type: z.enum(GROUND_TYPE).optional(),
  capacity: z.number().int().optional(),
  display_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
});
export const updateGroundSchema = createGroundSchema.partial();

export const bulkCreateVenuesSchema = z.object({
  venues: z.array(createVenueSchema).min(1).max(100),
}).refine((d) => new Set(d.venues.map((v) => v.championship_id)).size === 1, {
  message: 'All venues must belong to the same championship',
});

export const bulkCreateGroundsSchema = z.object({
  grounds: z.array(createGroundSchema).min(1).max(100),
}).refine((d) => new Set(d.grounds.map((g) => g.venue_id)).size === 1, {
  message: 'All grounds must belong to the same venue',
});

export const createSponsorSchema = z.object({
  championship_id: uuid,
  name: z.string().min(1),
  logo_url: z.string().optional(),
  tier: z.enum(SPONSOR_TIER).default('community'),
  website_url: z.string().optional(),
  display_order: z.number().int().default(0),
});
export const updateSponsorSchema = createSponsorSchema.partial();

export const createTournamentSchema = z.object({
  championship_id: uuid,
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(TOURNAMENT_STATUS).optional(),
});
export const updateTournamentSchema = createTournamentSchema.partial();

export const createTournamentSportSchema = z.object({
  tournament_id: uuid,
  sport_id: uuid,
  format_id: uuid,
  format_config: json.default({}),
  display_order: z.number().int().default(0),
});
export const updateTournamentSportSchema = createTournamentSportSchema.partial();

export const createTournamentDisciplineSchema = z.object({
  tournament_sport_id: uuid,
  discipline_id: uuid.nullable().optional(),
  format_id: uuid.nullable().optional(),
  format_config: json.default({}),
  venue_id: uuid.nullable().optional(),
  rulebook_url: z.string().optional(),
  entry_type: z.enum(ENTRY_TYPE).optional(),
  squad_min: z.number().int().optional(),
  squad_max: z.number().int().optional(),
  status: z.enum(TOURNAMENT_DISCIPLINE_STATUS).default('upcoming'),
  display_order: z.number().int().default(0),
});
export const updateTournamentDisciplineSchema = createTournamentDisciplineSchema.partial();

// ---------- Phase 3: enrollment ----------
export const enrollOrganizationSchema = z.object({ organization_id: uuid });
export const reviewEnrollmentSchema = z.object({
  status: z.enum(['approved', 'rejected'] as const),
  rejection_note: z.string().optional(),
});
export const assignRoleSchema = z.object({ user_id: uuid, role_id: uuid });

// ---------- Phase 3b: host → organization invitations ----------
// Host invites an org by display name + the POC's mobile (neither need exist yet).
export const createInvitationSchema = z.object({
  org_name: z.string().min(1),
  poc_mobile: z.string().min(5),
});
// The invited POC accepts, choosing which org they own/administer applies.
export const acceptInvitationSchema = z.object({ organization_id: uuid });

// ---------- Phase 4: teams ----------
export const createTeamSchema = z.object({
  championship_id: uuid,
  sport_id: uuid,
  organization_id: uuid,
  championship_organization_id: uuid,
  tournament_discipline_id: uuid,
  name: z.string().min(1),
});
export const updateTeamSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(TEAM_STATUS).optional(),
  tournament_discipline_id: uuid.optional(),
});
export const addTeamMemberSchema = z.object({
  user_id: uuid,
  role: z.enum(TEAM_MEMBER_ROLE).default('player'),
  jersey_number: z.number().int().optional(),
});
export const joinTeamSchema = z.object({
  role: z.enum(TEAM_MEMBER_ROLE).default('player'),
  jersey_number: z.number().int().optional(),
});
// Edit an existing roster row — e.g. promote a player to captain, or set a jersey.
export const updateTeamMemberSchema = z
  .object({
    role: z.enum(TEAM_MEMBER_ROLE).optional(),
    jersey_number: z.number().int().nullable().optional(),
  })
  .refine((m) => m.role !== undefined || m.jersey_number !== undefined, {
    message: 'Nothing to update',
  });

// ---------- Bulk operations ----------
// A single member in a bulk roster import: either an existing user_id, or a
// name+email pair that will be resolved (created or matched) under the team's
// organization.
export const bulkTeamMemberSchema = z
  .object({
    user_id: uuid.optional(),
    name: z.string().optional(),
    email: z.string().email().optional(),
    role: z.enum(TEAM_MEMBER_ROLE).default('player'),
    jersey_number: z.number().int().nullable().optional(),
  })
  .refine((m) => !!(m.user_id || m.email), { message: 'Each row needs a user or an email' });
export const bulkAddTeamMembersSchema = z.object({
  members: z.array(bulkTeamMemberSchema).min(1).max(200),
});

// Create many teams in one shot (e.g. an organization entering every discipline).
export const bulkCreateTeamsSchema = z.object({
  teams: z.array(createTeamSchema).min(1).max(100),
});

// ---------- Phase 5: fixtures ----------
export const generateFixturesSchema = z.object({
  // ordered team ids = seed order; empty -> use teams registered to the discipline
  team_ids: z.array(uuid).optional(),
  params: json.default({}),
});
export const createFixtureSchema = z.object({
  tournament_discipline_id: uuid,
  home_team_id: uuid.nullable().optional(),
  away_team_id: uuid.nullable().optional(),
  venue_ground_id: uuid.nullable().optional(),
  round: z.string().optional(),
  pool_number: z.number().int().optional(),
  bracket_position: z.number().int().optional(),
  scheduled_at: z.coerce.date().nullable().optional(),
  duration_minutes: z.number().int().optional(),
  status: z.enum(FIXTURE_STATUS).default('scheduled'),
  official_id: uuid.nullable().optional(),
  notes: z.string().optional(),
  home_score: z.number().int().min(0).nullable().optional(),
  away_score: z.number().int().min(0).nullable().optional(),
  winner_team_id: uuid.nullable().optional(),
});
export const updateFixtureSchema = createFixtureSchema.partial();

// Result entry from the official's match console: scores + optional winner +
// a result note. Winner is derived from scores when omitted.
export const fixtureResultSchema = z.object({
  home_score: z.number().int().min(0).nullable().optional(),
  away_score: z.number().int().min(0).nullable().optional(),
  winner_team_id: uuid.nullable().optional(),
  status: z.enum(FIXTURE_STATUS).optional(),
  notes: z.string().optional(),
});

// Per-match awards entered by the scorer: free-text award name + a recipient who is
// a player on one of the two competing teams. Saved with replace-all semantics.
export const fixtureAwardSchema = z.object({
  award_name: z.string().min(1).max(120),
  recipient_user_id: uuid,
});
export const fixtureAwardsSchema = z.object({
  awards: z.array(fixtureAwardSchema).max(50).default([]),
});

// ---------- Notifications ----------
// Push a manual notification. type is fixed server-side ('manual'); sender is the
// authenticated user; lifecycle/approval notifications are produced by hooks, not
// this endpoint.
export const createNotificationSchema = z.object({
  championship_id: uuid,
  title: z.string().min(1).max(200),
  body: z.string().max(4000).optional(),
  audience: z.enum(NOTIFICATION_AUDIENCE).default('all'),
});
export const reactNotificationSchema = z.object({
  reaction: z.enum(NOTIFICATION_REACTIONS),
});

export { ENROLLMENT_STATUS };
