// The permission catalogue (J6-E1-S1).
//
// Code-owned, not user-created: a permission is a thing the product knows how to
// enforce, so inventing one through a UI could only ever produce a row nothing reads.
// The `permissions` table is a synced copy of this list (bootstrap-catalog.ts), which
// is what lets the role matrix be generated rather than hand-maintained.
//
// Typed codes mean `can(user, 'fixture.lok')` is a compile error rather than a silent
// false - which, in an authorisation check, is the difference between a bug and a
// breach.

export interface PermissionDef {
  label: string;
  /** Where the grant is meaningful: within an organisation, or within a championship. */
  scope: 'org' | 'championship';
  /** Grouping for the matrix UI. */
  area: string;
}

export const PERMISSIONS = {
  'org.manage': { label: 'Manage organisation settings', scope: 'org', area: 'Organisation' },
  'org.member.manage': { label: 'Add & remove members', scope: 'org', area: 'Organisation' },
  'org.structure.manage': { label: 'Edit programmes & batches', scope: 'org', area: 'Organisation' },
  'audit.view': { label: 'View the audit trail', scope: 'org', area: 'Organisation' },

  'people.view': { label: 'View the people directory', scope: 'org', area: 'People' },
  'people.verify': { label: 'Verify players', scope: 'org', area: 'People' },

  'team.manage': { label: 'Manage teams & squads', scope: 'org', area: 'Teams' },
  'team.create': { label: 'Create teams', scope: 'org', area: 'Teams' },

  'event.create': { label: 'Create championships', scope: 'org', area: 'Championships' },
  'event.manage': { label: 'Manage a championship', scope: 'championship', area: 'Championships' },
  'event.approve': { label: 'Approve registrations', scope: 'championship', area: 'Championships' },
  // Entering YOUR organisation into somebody else's championship. Separate from
  // event.approve, which is the host deciding who gets in: they sit on opposite sides
  // of the same handshake, and the guard that checks entry was reading the host's
  // permission by mistake.
  'event.enroll': { label: 'Enter this organisation into championships', scope: 'org', area: 'Championships' },

  'fixture.score': { label: 'Record scores', scope: 'championship', area: 'Results' },
  'fixture.lock': { label: 'Lock a scorecard', scope: 'championship', area: 'Results' },
  // Deliberately separate from fixture.lock: locking is a review, correcting a
  // published result is a heavier act, and J6-E4-S5 asks for it to be separately
  // grantable.
  'fixture.unlock': { label: 'Reverse a locked result', scope: 'championship', area: 'Results' },

  'achievement.validate': { label: 'Validate achievement claims', scope: 'org', area: 'Records' },
  'certificate.issue': { label: 'Issue certificates', scope: 'org', area: 'Records' },
  'report.view': { label: 'View reports', scope: 'org', area: 'Reports' },
} as const satisfies Record<string, PermissionDef>;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

// ---------- Modules (J6-E2 / FR-ADM-4) ----------

// The two audiences an institution can switch a module for. Derived from
// `organization_members.role`, never stored: owner/admin/captain are staff,
// member/alumni are students.
export const AUDIENCES = ['staff', 'students'] as const;
export type Audience = (typeof AUDIENCES)[number];

// A module is a whole area of the workspace that can be switched off for an
// audience in one place. The `area` on each permission above is the same
// vocabulary in prose; this maps it to a stable key so the setting survives a
// label being reworded.
export const MODULES = {
  people: { label: 'People', areas: ['People'] },
  teams: { label: 'Teams', areas: ['Teams'] },
  championships: { label: 'Championships', areas: ['Championships'] },
  results: { label: 'Results', areas: ['Results'] },
  records: { label: 'Records & certificates', areas: ['Records'] },
  reports: { label: 'Reports', areas: ['Reports'] },
  administration: { label: 'Administration', areas: ['Organisation'] },
} as const satisfies Record<string, { label: string; areas: readonly string[] }>;

export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

// Which module a permission belongs to, derived from its `area` so the two can
// never drift. A permission whose area maps to no module is unmodulated and
// therefore never blocked - that is deliberate, so adding a permission cannot
// accidentally make it unreachable.
const MODULE_BY_AREA = new Map<string, ModuleKey>(
  MODULE_KEYS.flatMap((key) => MODULES[key].areas.map((area) => [area, key] as const)),
);

export function moduleOfPermission(code: PermissionCode): ModuleKey | null {
  const def = PERMISSIONS[code] as PermissionDef | undefined;
  return (def?.area && MODULE_BY_AREA.get(def.area)) || null;
}

export const permissionsByArea = (): Array<{ area: string; permissions: Array<{ code: PermissionCode } & PermissionDef> }> => {
  const areas = new Map<string, Array<{ code: PermissionCode } & PermissionDef>>();
  for (const code of PERMISSION_CODES) {
    const def = PERMISSIONS[code] as PermissionDef;
    if (!areas.has(def.area)) areas.set(def.area, []);
    areas.get(def.area)!.push({ code, ...def });
  }
  return [...areas].map(([area, permissions]) => ({ area, permissions }));
};
