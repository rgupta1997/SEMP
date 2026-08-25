import { describe, it, expect } from 'vitest';
import { buildApp } from './server.js';

// Are the subscription gates actually MOUNTED?
//
// entitlements.test.ts proves requireCapability decides correctly. It would have
// proved that before too, while the guard was mounted on nothing and the padlock
// on the Reports nav item was the whole of the enforcement. A correct guard nobody
// installed is indistinguishable from no guard, and only this test tells them apart.
//
// It works by name: requireCapability stamps its handler `capability:<key>`, and
// Express copies a handler's name onto the layer. Matching on the path alone would
// be vacuous - the reports ROUTER is also mounted at a path containing "reports",
// so a check for "something at /organizations/:id/reports" passes with no gate
// there at all. The name is what distinguishes the gate from what it guards.

interface Mount { path: string; name: string }

function mounts(app: any): Mount[] {
  const out: Mount[] = [];
  const walk = (stack: any[], prefix: string) => {
    for (const layer of stack ?? []) {
      const seg = layer.route?.path ?? (layer.regexp?.source ?? '');
      const here = prefix + (typeof seg === 'string' ? seg : '');
      out.push({ path: here, name: layer.name ?? '' });
      if (layer.handle?.stack) walk(layer.handle.stack, here);
    }
  };
  walk(app._router?.stack, '');
  return out;
}

describe('subscription gates are mounted, not merely written', () => {
  // buildApp only stores the client; nothing touches the database at construction.
  const all = mounts(buildApp({} as any));
  const gates = all.filter((m) => m.name.startsWith('capability:'));

  it.each([
    ['reports', 'advanced_reports', 'reports'],
    ['report jobs', 'advanced_reports', 'report-jobs'],
    ['peer benchmark', 'benchmarking', 'benchmark'],
    ['campuses and units', 'multi_campus', 'units'],
    ['audit log', 'audit_logs', 'audit'],
    ['bulk roster import', 'bulk_player_upload', 'import'],
  ])('%s is gated on %s', (_label, capability, segment) => {
    const found = gates.filter((g) => g.name === `capability:${capability}`
      && g.path.includes(segment)
      && g.path.includes('organizations'));
    expect(found.length).toBeGreaterThan(0);
  });

  it('finds gates by name at all (guards the walker itself)', () => {
    // If Express changed how it stores mounts, or the naming were dropped, every
    // assertion above would fail rather than pass vacuously - but this states the
    // expectation directly so the reason is legible when it does.
    expect(gates.length).toBeGreaterThanOrEqual(6);
    expect(all.length).toBeGreaterThan(20);
  });
});
