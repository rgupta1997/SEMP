import { z } from 'zod';
import {
  AUTH_METHOD, PUBLIC_EMAIL_DOMAINS,
  DEMO_REQUEST_STATUS, FEEDBACK_STATUS, ENTRY_TYPE, ENROLLMENT_STATUS, CHAMPIONSHIP_STATUS, CHAMPIONSHIP_VISIBILITY, FIXTURE_STATUS, GROUND_TYPE,
  CHAMPIONSHIP_TYPE, NOTIFICATION_AUDIENCE, NOTIFICATION_REACTIONS, ORGANIZATION_MEMBER_ROLE,
  SPONSOR_TIER, STANDINGS_RULE_SCOPE, STANDINGS_TIEBREAKER, TEAM_MEMBER_ROLE,
  TEAM_STATUS, TOURNAMENT_DISCIPLINE_STATUS, TOURNAMENT_STATUS,
} from './enums.js';
import { disciplineFormatConfigSchema } from './scoring.js';

const uuid = z.string().uuid();
const json = z.record(z.any());

// A valid mobile is 10–15 digits (10-digit number, optionally a country code),
// matching the phone lookup which keys off the last 10 digits. Used both as a
// required field (create-a-login flows) and validated-when-present elsewhere.
const PHONE_ERROR = 'Enter a valid mobile number (at least 10 digits)';
const isValidPhone = (v: string) => {
  const d = v.replace(/\D/g, '');
  return d.length >= 10 && d.length <= 15;
};
const optionalPhone = z.string().refine(isValidPhone, PHONE_ERROR).optional();
const nullableOptionalPhone = z.string().refine(isValidPhone, PHONE_ERROR).nullable().optional();
// Required variant: a clear message when the field is missing/blank, and the
// format message when something invalid is typed.
const requiredPhone = z
  .string({ required_error: 'Phone number is required', invalid_type_error: 'Phone number is required' })
  .min(1, 'Phone number is required')
  .refine(isValidPhone, PHONE_ERROR);

// ---------- Auth ----------
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  phone: requiredPhone,
});

// Change your own password. `current_password` is required for a normal change but
// skipped on a forced first-login change (the user just authenticated with the
// temporary password and may not know it as a "current" secret).
export const changePasswordSchema = z.object({
  current_password: z.string().optional(),
  new_password: z.string().min(6),
});

// Self-serve sign up - every login is just a user. There is no account-type
// choice: a user becomes an organiser by hosting a championship, a member by
// joining/creating an organization, an official by being assigned to one.
export const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  phone: requiredPhone,
});

// ---------- Email-first sign-in (FR-AUTH-1/2/4) ----------
// Step 1: which organisation does this address belong to? Answered from the domain
// alone - the handler never reads `users`, so the reply cannot be used to probe
// whether an account exists.
export const identifySchema = z.object({
  email: z.string().email(),
});

// A one-time code proves you own an address. It is never a way to sign in - it
// gates the two things that need that proof: creating an account, and setting a new
// password when the old one is forgotten.
export const VERIFICATION_PURPOSE = ['signup', 'password_reset'] as const;
export type VerificationPurpose = (typeof VERIFICATION_PURPOSE)[number];

// Step 2: send a one-time code to that address.
export const otpRequestSchema = z.object({
  email: z.string().email(),
  purpose: z.enum(VERIFICATION_PURPOSE).default('signup'),
});

// Step 3: check the code. Returns a short-lived verification ticket - NOT a session.
export const otpVerifySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  purpose: z.enum(VERIFICATION_PURPOSE).default('signup'),
});

// Step 4a: finish signing up. The ticket carries the proof of ownership, so the
// email is taken from it and not from the body - a caller cannot verify one address
// and register another.
export const verifiedSignupSchema = z.object({
  verification_token: z.string().min(1),
  name: z.string().min(1),
  phone: requiredPhone,
  password: z.string().min(6),
});

// Step 4b: finish a password reset.
export const resetPasswordSchema = z.object({
  verification_token: z.string().min(1),
  password: z.string().min(6),
});

// ---------- Organisation email domains (super-admin managed) ----------
// Normalised on the way in so "@IIMB.ac.in", "www.iimb.ac.in" and "iimb.ac.in " all
// store as one value - the DB's unique index is on lower(domain), and sign-in looks
// up the bare host of the address.
const DOMAIN_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
export const normalizeDomain = (raw: string): string =>
  raw.trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

const domainField = z
  .string()
  .min(1, 'Domain is required')
  .transform(normalizeDomain)
  .refine((d) => DOMAIN_SHAPE.test(d), 'Enter a domain like iimb.ac.in')
  .refine(
    (d) => !(PUBLIC_EMAIL_DOMAINS as readonly string[]).includes(d),
    'Public mailbox providers cannot be claimed by an organisation',
  );

export const createOrgDomainSchema = z.object({
  organization_id: uuid,
  domain: domainField,
  // Super-admin-entered domains are verified by definition; the flag exists so a
  // future org-admin self-claim can land unverified and be approved here.
  verified: z.boolean().default(true),
});
export const updateOrgDomainSchema = z.object({
  organization_id: uuid.optional(),
  domain: domainField.optional(),
  verified: z.boolean().optional(),
});

// ---------- Organisation invitations (J1-E3) ----------
// Invite someone to an organisation by email, with the role they will hold. The role
// is part of the invitation because that is what distinguishes inviting from letting
// someone request to join.
export const inviteOrgMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(ORGANIZATION_MEMBER_ROLE).default('member'),
});

// The same thing for a pasted list or an uploaded sheet. A per-row role is optional
// because most batches are one role for everybody; rows without one take the
// top-level `role`. Partial success is the point: one bad or duplicate address must
// not cost the other 199 their invitation, so the route reports per address rather
// than failing the batch.
export const bulkInviteOrgMembersSchema = z.object({
  invites: z.array(z.object({
    // Deliberately NOT .email() here, unlike the single-invite schema: a rejected
    // body is all-or-nothing, so one typo in a pasted list of 200 would 400 the
    // other 199. The address is checked per row in the service instead, where a bad
    // one lands in `skipped` with the rest of the batch still sent.
    email: z.string().min(1).max(320),
    role: z.enum(ORGANIZATION_MEMBER_ROLE).optional(),
  })).min(1).max(200),
  role: z.enum(ORGANIZATION_MEMBER_ROLE).default('member'),
});

// Accepting. Name/phone/password are required only when the address has no account
// yet - the server decides, since only it knows.
export const acceptInvitationSchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).optional(),
  phone: optionalPhone,
  password: z.string().min(6).optional(),
});

// ---------- Organisation settings (jsonb, validated on write) ----------
// The `settings` bag carries what would otherwise be a dozen sparse columns. Only
// the auth block is read today; the rest are declared so the shape is agreed before
// modules 03/08 start writing to it.
export const orgSettingsSchema = z.object({
  auth: z.object({
    methods: z.array(z.enum(AUTH_METHOD)).min(1).default(['otp', 'password']),
    sso: z.array(z.string()).default([]),
  }).default({ methods: ['otp', 'password'], sso: [] }),
  nav: z.record(z.boolean()).default({}),
  modules: z.record(z.array(z.string())).default({}),
  flags: z.record(z.boolean()).default({}),
  brand: z.record(z.any()).default({}),
}).partial();

// ---------- Users (admin / organiser / org-owner managed) ----------
// Creating a login for someone else (a teammate, an official, a member). The
// password is optional - the server falls back to the shared default so the
// account can sign in immediately and reset later.
export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6).optional(),
  phone: requiredPhone,
  organization_id: uuid.nullable().optional(),
});
export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  phone: nullableOptionalPhone,
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
  phone: optionalPhone,
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
      phone: optionalPhone,
    })
    .refine((o) => !!(o.user_id || (o.name && o.email)), { message: 'Provide an existing user or a name and email' })
    .optional(),
});

// Add / invite a member to an organization with a per-org role.
export const addOrganizationMemberSchema = z.object({
  user_id: uuid.optional(),
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: optionalPhone,
  role: z.enum(ORGANIZATION_MEMBER_ROLE).default('member'),
}).refine((m) => !!(m.user_id || m.email || m.phone), { message: 'Provide a user, a phone, or an email' });
// Bulk-add several existing users to an org in one request (multi-select picker).
// Invite-by-phone/email creation stays on the single endpoint; this only takes ids.
export const bulkAddOrganizationMembersSchema = z.object({
  user_ids: z.array(uuid).min(1).max(200),
  role: z.enum(ORGANIZATION_MEMBER_ROLE).default('member'),
});
export const updateOrganizationMemberSchema = z.object({
  role: z.enum(ORGANIZATION_MEMBER_ROLE).optional(),
  status: z.enum(['pending', 'active', 'past', 'rejected'] as const).optional(),
});

// ---------- Phase 2: championship creation ----------
export const createChampionshipSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'lowercase letters, numbers, hyphens only'),
  description: z.string().optional(),
  // The host city is required - it doubles as the championship's default venue.
  venue: z.string().min(1, 'Host city is required'),
  start_date: z.coerce.date(),
  end_date: z.coerce.date(),
  status: z.enum(CHAMPIONSHIP_STATUS).optional(),
  // 'private' hides the championship from Discover/Browse; orgs join by invite only.
  visibility: z.enum(CHAMPIONSHIP_VISIBILITY).optional(),
  // What kind of event this is - nullable, because it is a question older
  // championships were never asked (J2-E1-S2).
  type: z.enum(CHAMPIONSHIP_TYPE).nullable().optional(),
  // Where it is. `region` is never accepted from a client - the server derives it
  // from the country so the filter can't disagree with the data (J3-E4-S2).
  country: z.string().min(1).nullable().optional(),
  // Whether people with no institution may enter (J3-E1-S5). Omitted on create means
  // "decide from the visibility", which is what an organiser almost always means.
  allow_individual_entry: z.boolean().optional(),
});

// Applying a template to a fresh draft: sports, disciplines, formats and the
// standings scheme in one call, rather than an organiser configuring six sports from
// an empty form.
export const applyTemplateSchema = z.object({
  // A championship_templates row id - either a built-in or one somebody saved.
  template: z.string().uuid(),
});

// Saving the setup of a championship you just built as a template you can start from
// next time. The name is the user's, which is the whole point: the product derives the
// shape, the organiser says what it is called.
export const saveTemplateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(280).optional().nullable(),
  // Present = the organisation owns it and it outlives the person who saved it.
  organization_id: z.string().uuid().optional().nullable(),
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
  format_config: disciplineFormatConfigSchema.default({}),
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
// Bulk-assign one championship role to several users at once (multi-select picker).
export const bulkAssignRoleSchema = z.object({ user_ids: z.array(uuid).min(1).max(200), role_id: uuid });
// Bulk-assign several users as championship officials at once (multi-select picker).
export const bulkAssignOfficialsSchema = z.object({ user_ids: z.array(uuid).min(1).max(200), notes: z.string().optional() });

// ---------- Phase 3b: host → organization invitations ----------
// Host invites an organization by picking it from the master list; the request
// goes straight to that org's owners/admins (no POC mobile number).
export const createInvitationSchema = z.object({
  organization_id: uuid,
});
// Accepting needs no body - the invitation already names the organization, and
// only its owners/admins can see it.

// ---------- Phase 3c: invite a person by mobile to a role ----------
// Add an org member / co-organiser / official by mobile number. If no user has
// that number yet, the invite is auto-applied when they sign in with it.
export const USER_INVITATION_TARGET = ['org_member', 'championship_organiser', 'championship_official'] as const;
export const createUserInvitationSchema = z.object({
  mobile: z.string().min(5),
  target_type: z.enum(USER_INVITATION_TARGET),
  target_id: uuid,
  role: z.enum(ORGANIZATION_MEMBER_ROLE).optional(),
});

// ---------- Phase 4: teams ----------
// Create a team. Only name + sport + org are required - a team is a standalone
// organization asset. Pass the championship fields to enter it into a championship
// at creation (the old all-in-one flow); otherwise enter it into championships
// later via POST /teams/:id/entries (a roster can join many championships).
export const createTeamSchema = z.object({
  sport_id: uuid,
  organization_id: uuid,
  name: z.string().min(1),
  championship_id: uuid.optional(),
  championship_organization_id: uuid.optional(),
  tournament_discipline_id: uuid.optional(),
});
// Enter an existing roster into one or more championships at once. Each entry
// names an approved enrollment; the discipline draw is OPTIONAL - a team can enter
// a championship first and pick its discipline afterwards (chosen via
// updateTeamEntrySchema). When given, the draw must match the team's sport.
export const enterChampionshipsSchema = z.object({
  entries: z.array(z.object({
    championship_organization_id: uuid,
    tournament_discipline_id: uuid.nullable().optional(),
  })).min(1).max(50),
});
// Set (or change) the discipline draw of an existing championship entry - the
// "choose your discipline once you're in" step. Pass null to clear it again.
export const updateTeamEntrySchema = z.object({
  tournament_discipline_id: uuid.nullable(),
});
export const updateTeamSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(TEAM_STATUS).optional(),
  // A coach is a property of the team, not a squad member, so they never count
  // against squad size (J3-E2-S3). null clears it - a team may have no coach.
  coach_user_id: uuid.nullable().optional(),
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
// Edit an existing roster row - e.g. promote a player to captain, or set a jersey.
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

// ---------- Championship setup matrix import ----------
// A 2D spreadsheet (section columns × sport/discipline rows) parsed by the web app
// into this normalized shape. People are matched to existing users by phone only, so
// phone is kept as a free string (we match on its digits and report misses) rather
// than the strict phone validator - one malformed cell must not reject the upload.
const matrixPerson = z.object({ name: z.string().default(''), phone: z.string().min(1) });
export const matrixImportSchema = z.object({
  default_format_id: uuid,                                  // required: tournament_sports.format_id is NOT NULL
  // People whose phone matches no existing user can be provisioned as new logins
  // (name+phone from the sheet, firstname@last4 password). Choose where: an explicit
  // org, or each person's own section org (create_missing_in_section). When neither is
  // set, unmatched people are skipped and reported.
  create_missing_org_id: uuid.nullable().optional(),
  create_missing_in_section: z.boolean().optional(),
  sections: z.array(z.string().min(1)).min(1).max(50),
  owners: z.array(matrixPerson.extend({ section: z.string().min(1) })).max(1000).default([]),
  units: z.array(z.object({
    sport: z.string().min(1),
    discipline: z.string().min(1).nullable().default(null),
    teams: z.array(z.object({
      section: z.string().min(1),
      captain: matrixPerson.nullish(),
      poc: matrixPerson.nullish(),
    })).max(200),
  })).max(200),
});

// ---------- Phase 5: fixtures ----------
export const generateFixturesSchema = z.object({
  // ordered team ids = seed order; empty -> use teams registered to the discipline
  team_ids: z.array(uuid).optional(),
  params: json.default({}),
});
const fixtureFields = z.object({
  tournament_discipline_id: uuid,
  home_team_id: uuid.nullable().optional(),
  away_team_id: uuid.nullable().optional(),
  venue_ground_id: uuid.nullable().optional(),
  round: z.string().optional(),
  pool_number: z.number().int().optional(),
  bracket_position: z.number().int().optional(),
  scheduled_at: z.coerce.date().nullable().optional(),
  duration_minutes: z.number().int().min(1).nullable().optional(),
  status: z.enum(FIXTURE_STATUS).default('scheduled'),
  official_id: uuid.nullable().optional(),
  notes: z.string().optional(),
  home_score: z.number().int().min(0).nullable().optional(),
  away_score: z.number().int().min(0).nullable().optional(),
  winner_team_id: uuid.nullable().optional(),
});
// A team can never be scheduled against itself.
const distinctTeams = (d: { home_team_id?: string | null; away_team_id?: string | null }) =>
  !(d.home_team_id && d.away_team_id && d.home_team_id === d.away_team_id);
const sameTeamError = { message: 'A team cannot play against itself', path: ['away_team_id'] };
export const createFixtureSchema = fixtureFields.refine(distinctTeams, sameTeamError);
export const updateFixtureSchema = fixtureFields.partial().refine(distinctTeams, sameTeamError);

// Result entry from the official's match console: scores + optional winner +
// a result note. Winner is derived from scores when omitted.
export const fixtureResultSchema = z.object({
  home_score: z.number().int().min(0).nullable().optional(),
  away_score: z.number().int().min(0).nullable().optional(),
  winner_team_id: uuid.nullable().optional(),
  status: z.enum(FIXTURE_STATUS).optional(),
  notes: z.string().optional(),
});

// Championship points awarded per side for a single result, entered by the organiser
// when the discipline uses the "custom" point system. Either side may be null/blank
// until set; the standings engine sums whatever is present.
export const fixturePointsSchema = z.object({
  home_points: z.number().int().min(0).nullable().optional(),
  away_points: z.number().int().min(0).nullable().optional(),
});

// Per-match awards entered by the scorer: an award name + a recipient who is a
// player on one of the two competing teams. Saved with replace-all semantics.
//
// `award_type_id` points at the catalogue, and is what makes "MVP awards" a
// countable number rather than three spellings of one thing (J4-E4-S2).
// `award_name` stays required and free: an official who needs an award the
// catalogue does not have must not be blocked mid-match, and the free text they
// type is preserved untyped rather than guessed at.
export const fixtureAwardSchema = z.object({
  award_name: z.string().min(1).max(120),
  award_type_id: uuid.nullable().optional(),
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

// ---------- Standings rules ----------
// A typed, discriminated scoring rule. Stored as the `config` jsonb on a
// standings_rules row and parsed by the recompute engine. One variant per scheme.

// `participation` is awarded once to every organization that takes part in a
// discipline (played ≥ 1 completed fixture), on top of the scheme's own points -
// the classic "participation vs performance" split. Shared by every scheme.
const participation = z.number().int().min(0).default(0);

export const leaguePointsRuleSchema = z.object({
  scheme: z.literal('league_points'),
  win: z.number().int().min(0).default(3),
  draw: z.number().int().min(0).default(1),
  loss: z.number().int().min(0).default(0),
  participation,
  tiebreakers: z.array(z.enum(STANDINGS_TIEBREAKER)).min(1).default(['points', 'wins', 'lost']),
});

// points keyed by canonical placement (winner / runner_up / semi_finalist / …).
// Missing placements score 0, so a partial map is fine.
export const placementRuleSchema = z.object({
  scheme: z.literal('placement'),
  points: z.record(z.number().int().min(0)).default({ winner: 7, runner_up: 5, semi_finalist: 3, quarter_finalist: 1 }),
  participation,
});

export const medalRuleSchema = z.object({
  scheme: z.literal('medal'),
  gold: z.number().int().min(0).default(5),
  silver: z.number().int().min(0).default(3),
  bronze: z.number().int().min(0).default(1),
  participation,
});

// Custom points: no auto formula. The organiser awards championship points to each
// side by hand on the Results page after a match; the engine simply sums them.
export const customRuleSchema = z.object({
  scheme: z.literal('custom'),
  participation,
});

// Ranking events (swimming/powerlifting/athletics): `places[i]` is the championship
// points for finishing place i+1 (places[0] = 1st, places[1] = 2nd, …). Places beyond
// the array score 0 (or `participation`). The event console's final ranking awards these.
export const rankingRuleSchema = z.object({
  scheme: z.literal('ranking'),
  places: z.array(z.number().int().min(0)).min(1).default([5, 3, 1]),
  participation,
});

export const standingsRuleSchema = z.discriminatedUnion('scheme', [
  leaguePointsRuleSchema,
  placementRuleSchema,
  medalRuleSchema,
  customRuleSchema,
  rankingRuleSchema,
]);
export type StandingsRule = z.infer<typeof standingsRuleSchema>;

// The implicit default applied when no standings_rules row matches - preserves the
// historical behaviour (win = 3, draw = 1, loss = 0). Single source of truth shared
// by the engine and the rules editor UI.
export const DEFAULT_STANDINGS_RULE: StandingsRule = {
  scheme: 'league_points',
  win: 3,
  draw: 1,
  loss: 0,
  participation: 0,
  tiebreakers: ['points', 'wins', 'lost'],
};

// Upsert one scoping rule. scope_id is required for format/discipline rules and must
// be empty for the championship default.
export const upsertStandingsRuleSchema = z
  .object({
    scope_type: z.enum(STANDINGS_RULE_SCOPE),
    scope_id: uuid.nullable().optional(),
    config: standingsRuleSchema,
  })
  .refine((r) => (r.scope_type === 'championship' ? !r.scope_id : !!r.scope_id), {
    message: 'scope_id is required for format/discipline rules and must be empty for the championship default',
  });

// ---------- Demo requests ("Book a demo" leads) ----------
// Submitted from the public, unauthenticated landing page. Only name + email are
// required; the rest help the team tailor the demo. `message` is trimmed/capped to
// keep the capture endpoint from being abused as free storage.
export const createDemoRequestSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  organization: z.string().max(160).optional(),
  role: z.string().max(80).optional(),
  sport: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  message: z.string().max(2000).optional(),
});

// Admin-only triage update - move a lead through its lifecycle and/or annotate it.
export const updateDemoRequestSchema = z
  .object({
    status: z.enum(DEMO_REQUEST_STATUS).optional(),
    message: z.string().max(2000).nullable().optional(),
  })
  .refine((d) => d.status !== undefined || d.message !== undefined, { message: 'Nothing to update' });

// Public feedback capture. Only `message` is required; name/email/context/championship
// are optional. Mounted before auth, so it's trimmed/capped to avoid abuse as storage.
export const createFeedbackSchema = z.object({
  message: z.string().min(1).max(4000),
  name: z.string().max(120).optional(),
  email: z.string().email().max(160).optional().or(z.literal('')),
  context: z.string().max(200).optional(),
  championship_id: uuid.optional(),
});

// Admin-only triage update for a feedback row.
export const updateFeedbackSchema = z
  .object({ status: z.enum(FEEDBACK_STATUS).optional() })
  .refine((d) => d.status !== undefined, { message: 'Nothing to update' });

// ---------- Demo sandboxes ----------
// Super-admin creates a personalized, isolated demo environment per client. Only
// client_name is required; everything else has defaults derived from it (the form
// pre-fills them and the admin tweaks only when the client wants something specific).
export const createDemoSandboxSchema = z.object({
  client_name: z.string().min(2).max(60),
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  // Applied to all four seeded championships; default public.
  visibility: z.enum(CHAMPIONSHIP_VISIBILITY).optional(),
  // Sports for the demo draws; defaults to DEMO_DEFAULT_SPORTS. Validated against
  // the sports catalog server-side so a typo fails fast instead of mid-seed. The cap
  // only bounds seeding time (each sport adds ~32 teams / ~160 players / ~32 fixtures
  // across the 4 championships) - it is not a technical limit.
  sports: z.array(z.string().min(1)).min(1).max(30).optional(),
  // Per-championship-kind participating organization names (up to 8 each);
  // missing kinds/slots fill from templates like "<Client> Institute of Technology".
  org_names: z
    .object({
      college: z.array(z.string().min(1).max(120)).max(8).optional(),
      school: z.array(z.string().min(1).max(120)).max(8).optional(),
      corporate: z.array(z.string().min(1).max(120)).max(8).optional(),
      public: z.array(z.string().min(1).max(120)).max(8).optional(),
    })
    .optional(),
  // Real stakeholder names to sprinkle in as team captains so the client sees
  // familiar people on rosters and podiums.
  custom_names: z.array(z.string().min(2).max(80)).max(20).optional(),
  organiser: z
    .object({
      mode: z.enum(['create', 'attach']),
      email: z.string().email().optional(), // required when mode = 'attach'
    })
    .refine((o) => o.mode !== 'attach' || !!o.email, { message: 'Email is required to attach an existing user' })
    .default({ mode: 'create' }),
});
export type CreateDemoSandboxInput = z.infer<typeof createDemoSandboxSchema>;

export { ENROLLMENT_STATUS };

// ---------- Bulk registration review (J2-E2-S2) ----------
// One decision applied to a whole selection. The cap is a Lambda budget, not a
// technical limit: each enrolment is its own transaction plus an audit line and a
// notification, and the batch must still answer inside the 15s function timeout.
export const bulkReviewEnrollmentsSchema = z.object({
  ids: z.array(uuid).min(1).max(50),
  status: z.enum(['approved', 'rejected'] as const),
  rejection_note: z.string().optional(),
});

// ---------------------------------------------------------------------------
// J2-E4 · Schedule fixtures & assign officials
// ---------------------------------------------------------------------------

// Draw generation as the organiser actually asks for it. `replace` is what stops an
// existing draw being silently overwritten: rebuilding a knockout throws away every
// fixture in it, so the caller has to say it means to.
export const generateDrawSchema = generateFixturesSchema.extend({
  replace: z.boolean().optional(),
});
export type GenerateDrawInput = z.infer<typeof generateDrawSchema>;

// Assigning (or clearing) the official responsible for scoring one match. Its own
// route rather than a field on the fixture update, because the assignment has to
// notify the person it names.
export const assignFixtureOfficialSchema = z.object({
  official_id: uuid.nullable(),
});
