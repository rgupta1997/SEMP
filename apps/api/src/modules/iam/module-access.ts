import type { PermissionCode } from '@semp/shared';
import { MODULES, moduleOfPermission, type ModuleKey, type Audience } from '@semp/shared';
import type { Db } from '../../infra/prisma.js';
import { cachedForRequest } from '../../http/middleware/request-cache.js';

// Switching whole modules on and off per audience (J6-E2, module 03 §4.6).
//
// Stored in `organizations.settings.modules` - the settings blob that already
// exists - rather than a second flag table. One shape, one place:
//
//   "modules": { "people": ["staff"], "teams": ["staff","students"] }
//
// A module ABSENT from the map is ON for everyone. That default matters: adding
// a new module to the catalogue must not silently switch it off for every
// institution that has never opened the settings screen.
//
// ONE ENFORCEMENT POINT. This is a pre-check inside `can()`, not a parallel
// system of route guards - if the module is off for your audience, no permission
// inside it resolves true, however it was granted (J6-E2-S3). Navigation reads
// the same flags through `visibleModulesFor`, so a disabled module disappears
// rather than 403-ing (J6-E2-S2).

export type ModuleSettings = Partial<Record<ModuleKey, Audience[]>>;

/**
 * Which audience a person belongs to inside one institution.
 *
 * Derived from `organization_members.role` rather than stored, so it cannot
 * drift from the membership it describes. A non-member has no audience at all,
 * which fails every module check - correct, and not the same as being a student.
 */
export function audienceOfRole(role: string | null | undefined): Audience | null {
  switch (role) {
    case 'owner': case 'admin': case 'captain': return 'staff';
    case 'member': case 'alumni': return 'students';
    default: return null;
  }
}

/** Read the module map off an organisation's settings blob, defensively. */
export function moduleSettingsOf(settings: unknown): ModuleSettings {
  const raw = (settings as { modules?: unknown } | null)?.modules;
  if (!raw || typeof raw !== 'object') return {};
  const out: ModuleSettings = {};
  for (const key of Object.keys(MODULES) as ModuleKey[]) {
    const value = (raw as Record<string, unknown>)[key];
    // Anything that is not a list of audiences is treated as "not configured"
    // and therefore ON. A malformed settings blob must not lock an institution
    // out of its own workspace.
    if (Array.isArray(value)) out[key] = value.filter((v): v is Audience => v === 'staff' || v === 'students');
  }
  return out;
}

/** Is this module switched on for this audience? Absent = on. */
export function moduleEnabled(settings: ModuleSettings, module: ModuleKey, audience: Audience | null): boolean {
  const allowed = settings[module];
  if (!allowed) return true;
  return audience != null && allowed.includes(audience);
}

/**
 * The pre-check `can()` runs before it looks at any grant.
 *
 * Returns true when the permission's module is off for this person's audience in
 * this institution - meaning: refuse, regardless of what roles say. Deliberately
 * fails OPEN on the paths where the question does not apply (no org scope, no
 * permission-to-module mapping, no membership row), because a module system that
 * can accidentally deny everything is worse than one that occasionally allows.
 */
export async function moduleBlocks(
  db: Db,
  permission: PermissionCode,
  ctx: { userId: string; organizationId?: string | null; isSuperAdmin?: boolean },
): Promise<boolean> {
  // A super admin is never module-gated - they are diagnosing the institution,
  // and a switch the institution set must not lock support out of it.
  if (ctx.isSuperAdmin || !ctx.organizationId) return false;
  const module = moduleOfPermission(permission);
  if (!module) return false;

  // Both reads are memoised for the life of the request. `can()` is called
  // several times per request and would otherwise fetch the same two rows each
  // time; outside a request the memo is a pass-through (see request-cache.ts).
  const org = await cachedForRequest(
    `org.settings:${ctx.organizationId}`,
    () => db.organizations.findUnique({ where: { id: ctx.organizationId! }, select: { settings: true } }),
  );
  const settings = moduleSettingsOf(org?.settings);
  // Not configured means on, and asking for the membership would be a wasted
  // query on the overwhelmingly common path.
  if (!settings[module]) return false;

  const membership = await cachedForRequest(
    `org.member:${ctx.organizationId}:${ctx.userId}`,
    () => db.organization_members.findFirst({
      where: { user_id: ctx.userId, organization_id: ctx.organizationId!, status: 'active' },
      select: { role: true },
    }),
  );
  return !moduleEnabled(settings, module, audienceOfRole(membership?.role));
}

/**
 * Everything a person can currently reach in one institution.
 *
 * Used by the client to render navigation, so a switched-off module is absent
 * rather than a link that 403s (J6-E2-S2). It is a convenience, never the
 * boundary - the boundary is the `can()` pre-check above.
 */
export async function visibleModulesFor(
  db: Db, userId: string, organizationId: string, isSuperAdmin = false,
): Promise<{ audience: Audience | null; modules: ModuleKey[]; settings: ModuleSettings }> {
  const [org, membership] = await Promise.all([
    db.organizations.findUnique({ where: { id: organizationId }, select: { settings: true } }),
    db.organization_members.findFirst({
      where: { user_id: userId, organization_id: organizationId, status: 'active' },
      select: { role: true },
    }),
  ]);
  const settings = moduleSettingsOf(org?.settings);
  const audience = audienceOfRole(membership?.role);
  const keys = Object.keys(MODULES) as ModuleKey[];
  return {
    audience,
    // A super admin sees everything: they are diagnosing the institution, and a
    // module hidden from them is a support call nobody can answer.
    modules: isSuperAdmin ? keys : keys.filter((m) => moduleEnabled(settings, m, audience)),
    settings,
  };
}
