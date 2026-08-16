import { describe, it, expect } from 'vitest';
import {
  audienceOfRole, moduleBlocks, moduleEnabled, moduleSettingsOf, visibleModulesFor,
  type ModuleSettings,
} from './module-access.js';

// Switching a module off has to mean it is off (J6-E2-S3): not hidden in the
// navigation while the endpoint still answers, and not overridable by a role
// somebody was granted earlier. The gate sits in front of the permission engine,
// so these tests are the closest thing to a proof of that.

const db = ({ modules, role }: { modules?: unknown; role?: string | null }) => ({
  organizations: { findUnique: async () => ({ settings: modules === undefined ? {} : { modules } }) },
  organization_members: { findFirst: async () => (role === undefined ? null : role === null ? null : { role }) },
}) as any;

describe('audienceOfRole', () => {
  it('maps the membership roles onto the two audiences', () => {
    expect(['owner', 'admin', 'captain'].map(audienceOfRole)).toEqual(['staff', 'staff', 'staff']);
    expect(['member', 'alumni'].map(audienceOfRole)).toEqual(['students', 'students']);
  });

  // A non-member is not a student. Treating them as one would hand an outsider
  // whatever students can reach.
  it('gives a non-member no audience at all', () => {
    expect(audienceOfRole(null)).toBeNull();
    expect(audienceOfRole('spectator')).toBeNull();
  });
});

describe('moduleSettingsOf', () => {
  it('reads a well-formed map and ignores unknown keys', () => {
    expect(moduleSettingsOf({ modules: { reports: ['staff'], nonsense: ['staff'] } }))
      .toEqual({ reports: ['staff'] });
  });

  // A settings blob mangled by hand must not lock an institution out of its own
  // workspace, so anything unreadable is treated as "not configured" = on.
  it('treats a malformed blob as not configured rather than as denial', () => {
    expect(moduleSettingsOf(null)).toEqual({});
    expect(moduleSettingsOf({ modules: 'off' })).toEqual({});
    expect(moduleSettingsOf({ modules: { reports: 'staff' } })).toEqual({});
  });

  it('drops audiences it does not recognise', () => {
    expect(moduleSettingsOf({ modules: { reports: ['staff', 'parents'] } })).toEqual({ reports: ['staff'] });
  });
});

describe('moduleEnabled', () => {
  // The default that matters: adding a module to the catalogue must not switch
  // it off for every institution that has never opened the settings screen.
  it('is on when the module is absent from the map', () => {
    expect(moduleEnabled({}, 'reports', 'students')).toBe(true);
    expect(moduleEnabled({}, 'reports', null)).toBe(true);
  });

  it('is on only for the audiences listed', () => {
    const s: ModuleSettings = { reports: ['staff'] };
    expect(moduleEnabled(s, 'reports', 'staff')).toBe(true);
    expect(moduleEnabled(s, 'reports', 'students')).toBe(false);
  });

  it('is off for everyone when the list is empty', () => {
    expect(moduleEnabled({ reports: [] }, 'reports', 'staff')).toBe(false);
  });
});

describe('moduleBlocks · the can() pre-check', () => {
  it('blocks a permission whose module is off for this person\'s audience', async () => {
    const blocked = await moduleBlocks(db({ modules: { reports: ['staff'] }, role: 'member' }), 'report.view', {
      userId: 'u1', organizationId: 'o1',
    });
    expect(blocked).toBe(true);
  });

  it('lets the same permission through for an audience that still has it', async () => {
    const blocked = await moduleBlocks(db({ modules: { reports: ['staff'] }, role: 'admin' }), 'report.view', {
      userId: 'u1', organizationId: 'o1',
    });
    expect(blocked).toBe(false);
  });

  // The gate is per module, not per permission - switching Reports off must not
  // take People with it.
  it('does not block a permission from a different module', async () => {
    const blocked = await moduleBlocks(db({ modules: { reports: ['staff'] }, role: 'member' }), 'people.view', {
      userId: 'u1', organizationId: 'o1',
    });
    expect(blocked).toBe(false);
  });

  it('never blocks a super admin - support has to be able to see the institution', async () => {
    const blocked = await moduleBlocks(db({ modules: { reports: [] }, role: 'member' }), 'report.view', {
      userId: 'u1', organizationId: 'o1', isSuperAdmin: true,
    });
    expect(blocked).toBe(false);
  });

  // Championship-scoped checks carry no organisation, and a module map belongs
  // to an institution - so there is nothing to apply, and it fails open.
  it('is inert with no organisation in scope', async () => {
    expect(await moduleBlocks(db({ modules: { reports: [] } }), 'report.view', { userId: 'u1' })).toBe(false);
    expect(await moduleBlocks(db({ modules: { reports: [] } }), 'report.view', { userId: 'u1', organizationId: null })).toBe(false);
  });

  it('blocks a non-member of the institution outright when the module is restricted', async () => {
    const blocked = await moduleBlocks(db({ modules: { reports: ['staff'] }, role: null }), 'report.view', {
      userId: 'stranger', organizationId: 'o1',
    });
    expect(blocked).toBe(true);
  });
});

describe('visibleModulesFor · what navigation renders', () => {
  it('hides a module switched off for the caller\'s audience', async () => {
    const view = await visibleModulesFor(db({ modules: { reports: ['staff'] }, role: 'member' }), 'u1', 'o1');
    expect(view.audience).toBe('students');
    expect(view.modules).not.toContain('reports');
    expect(view.modules).toContain('teams');
  });

  it('shows everything to a super admin regardless of the switches', async () => {
    const view = await visibleModulesFor(db({ modules: { reports: [], people: [] }, role: 'member' }), 'u1', 'o1', true);
    expect(view.modules).toContain('reports');
    expect(view.modules).toContain('people');
  });

  it('shows every module when nothing has been configured', async () => {
    const view = await visibleModulesFor(db({ role: 'admin' }), 'u1', 'o1');
    expect(view.modules).toContain('reports');
    expect(view.modules.length).toBeGreaterThan(3);
  });
});
