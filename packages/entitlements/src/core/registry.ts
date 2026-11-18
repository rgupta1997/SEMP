import type { Ladder, Tier } from './tiers.js';
import { activeCatalog } from './catalog.js';

// The capability registry - the single source of truth for what each tier buys.
//
// Adding a gated feature is an entry here, not a migration. Because this module
// is pure, the API guard and the UI lock state read the same definition and
// cannot drift; a grid duplicated between server and client always eventually
// disagrees, and the failure is silent in the direction that matters (the UI
// offers something the API then refuses).
//
// `surface` is what the capability gates, in the words a person would use. It is
// not decoration: the locked state names the capability and what it unlocks,
// NEVER the price tier. That rule is stated outright in the prototype's Help
// page, and the ordinal model makes it easy to break, because once you hold a
// Tier the tier name is the nearest thing to hand.

export interface CapabilityDef {
  /** Which ladder governs this capability. The two never cross. */
  ladder: Ladder;
  /** Lowest tier that grants it. Anything at or above this rank gets it. */
  minTier: Tier;
  /** Human name, shown on the locked state. */
  label: string;
  /** What it unlocks, for the locked state's explanatory line. */
  surface: string;
}

export const CAPABILITIES = {
  // ---- Organisation ladder ------------------------------------------
  create_event: {
    ladder: 'org', minTier: 'free',
    label: 'Create events',
    surface: 'Creating an event, and the Host an event action on My Events',
  },
  stamped_certificates: {
    ladder: 'org', minTier: 'free',
    label: 'Sportagon certificates',
    surface: 'Issuing certificates on the Sportagon template',
  },
  bulk_player_upload: {
    ladder: 'org', minTier: 'pro',
    label: 'Bulk roster upload',
    surface: 'Importing a player roster from a file',
  },
  custom_certificates: {
    ladder: 'org', minTier: 'pro',
    label: 'Custom certificates',
    surface: 'Your own template, logo and signatories, stamp removal, bulk issuance and QR verification',
  },
  advanced_reports: {
    ladder: 'org', minTier: 'pro',
    label: 'Reports',
    surface: 'The Reports page - participation, performance, engagement, event and player reports',
  },
  // ---- Event-level (added with the SaaS plans, 2026-11-08) ---------------
  // Gate what an EVENT may do. Resolved against the event's own plan (see
  // eventPlan.ts), not only the caller's home org.
  advanced_formats: {
    ladder: 'org', minTier: 'starter',
    label: 'All tournament formats',
    surface: 'League, round robin, groups + knockout and multi-stage draws, beyond the default format',
  },
  manual_schedule: {
    ladder: 'org', minTier: 'starter',
    label: 'Manual schedule changes',
    surface: 'Adding, removing or re-pairing fixtures by hand after the schedule is generated',
  },
  standard_points: {
    ladder: 'org', minTier: 'starter',
    label: 'Points systems',
    surface: 'League points, medal tally and placement-plus-match-points standings, beyond the default',
  },
  custom_points: {
    ladder: 'org', minTier: 'pro',
    label: 'Custom points',
    surface: 'Entering your own points for every match',
  },
  intra_department: {
    ladder: 'org', minTier: 'starter',
    label: 'Department events',
    surface: 'Internal events where your departments or batches compete against each other',
  },
  intra_campus: {
    ladder: 'org', minTier: 'pro',
    label: 'Campus events',
    surface: 'Internal events where your campuses compete against each other',
  },
  event_communications: {
    ladder: 'org', minTier: 'starter',
    label: 'Event communications',
    surface: 'Announcements and messages to an event’s participants',
  },
  event_awards: {
    ladder: 'org', minTier: 'starter',
    label: 'Awards',
    surface: 'Awards for players and teams at an event',
  },
  share_links: {
    ladder: 'org', minTier: 'starter',
    label: 'Public share links',
    surface: 'View-only public links to an event’s overview and standings',
  },
  white_label: {
    ladder: 'org', minTier: 'max',
    label: 'White label',
    surface: 'Your own brand on event pages and emails, with no Sportagon branding',
  },
  multi_campus: {
    ladder: 'org', minTier: 'pro',
    label: 'Campuses and units',
    surface: 'Campuses and nested units, and the campus breakdown on the dashboard',
  },
  advanced_permissions: {
    ladder: 'org', minTier: 'max',
    label: 'Custom roles',
    surface: 'Creating roles beyond the system set, and editing their permissions',
  },
  benchmarking: {
    ladder: 'org', minTier: 'max',
    label: 'Benchmarking',
    surface: 'Comparing this organisation against peer institutions',
  },
  sso: {
    ladder: 'org', minTier: 'max',
    label: 'Single sign-on',
    surface: 'SAML and OIDC sign-in, JIT provisioning and SCIM sync',
  },
  api: {
    ladder: 'org', minTier: 'max',
    label: 'API access',
    surface: 'API keys, webhooks and sandbox mode',
  },
  audit_logs: {
    ladder: 'org', minTier: 'max',
    label: 'Audit logs',
    surface: 'The timestamped record of who did what',
  },

  // ---- Personal ladder ----------------------------------------------
  play_events: {
    ladder: 'personal', minTier: 'free',
    label: 'Play events',
    surface: 'Discover and My Events',
  },
  view_results: {
    ladder: 'personal', minTier: 'free',
    label: 'Results',
    surface: 'Results and My Game',
  },
  basic_profile: {
    ladder: 'personal', minTier: 'free',
    label: 'Sports profile',
    surface: 'My Sports Profile',
  },
  certificates: {
    ladder: 'personal', minTier: 'free',
    label: 'Certificates',
    surface: 'The certificates on your profile',
  },
  advanced_stats: {
    ladder: 'personal', minTier: 'pro',
    label: 'Detailed statistics',
    surface: 'The Statistics tab on your profile',
  },
  sports_cv: {
    ladder: 'personal', minTier: 'pro',
    label: 'Sports CV',
    surface: 'Exporting your record as a sports CV',
  },
  premium_insights: {
    ladder: 'personal', minTier: 'pro',
    label: 'Insights',
    surface: 'The insight panels on your profile',
  },
  performance_analytics: {
    ladder: 'personal', minTier: 'max',
    label: 'Performance analytics',
    surface: 'Percentiles and performance trends on your profile',
  },
  ai_insights: {
    ladder: 'personal', minTier: 'max',
    label: 'AI insights',
    surface: 'The AI panel on your profile',
  },
  ai_coach: {
    ladder: 'personal', minTier: 'max',
    label: 'AI coach',
    surface: 'The AI coach',
  },
} as const satisfies Record<string, CapabilityDef>;

export type CapabilityKey = keyof typeof CAPABILITIES;

export type OrgCapabilityKey = {
  [K in CapabilityKey]: (typeof CAPABILITIES)[K]['ladder'] extends 'org' ? K : never;
}[CapabilityKey];

export type PersonalCapabilityKey = {
  [K in CapabilityKey]: (typeof CAPABILITIES)[K]['ladder'] extends 'personal' ? K : never;
}[CapabilityKey];

export const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as CapabilityKey[];

export function capabilitiesFor(ladder: Ladder): CapabilityKey[] {
  return CAPABILITY_KEYS.filter((k) => CAPABILITIES[k].ladder === ladder);
}

/**
 * The lowest tier that grants a capability, AS CONFIGURED. Every reader in the
 * package goes through this rather than `CAPABILITIES[k].minTier`, which is only
 * the code default the super-admin console may have moved.
 */
export function minTierOf(key: CapabilityKey): Tier {
  return activeCatalog().minTiers[key] ?? CAPABILITIES[key].minTier;
}
