import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// A static source-text linter, in the style of component-safety.test.ts.
//
// It enforces three architectural rules that nothing else in this repo can, because
// there is no CI and no lint step. Each of them is the kind that holds for three
// months and then quietly stops when somebody adds an import in a hurry:
//
//   1. Only lib/realtime-appsync.ts may import aws-amplify. That single dynamic
//      import is what keeps a few hundred KB of Amplify out of the main bundle and
//      off the login page; a static import anywhere else silently undoes it, and
//      the only symptom is a bigger chunk nobody looks at.
//   2. packages/notifications never imports aws-amplify. That package is
//      deliberately transport-agnostic - the whole reason the port interface in its
//      client/realtime.ts exists.
//   3. Nothing anywhere still references @supabase/supabase-js. A half-finished
//      revert would otherwise leave a dead import or a phantom dependency that
//      typechecks fine until someone runs an install.
//
// fileURLToPath, NOT a slice of import.meta.url: this repository lives in a
// directory whose name contains a space, so the raw URL arrives percent-encoded and
// readdirSync fails with ENOENT on a path containing "%20". component-safety.test.ts
// makes exactly that mistake and has therefore been collecting nothing at all.

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/src/lib
const webSrc = dirname(here); // apps/web/src
const repoRoot = join(webSrc, '..', '..', '..'); // repo root
const notificationsSrc = join(repoRoot, 'packages', 'notifications', 'src');

const AMPLIFY_ADAPTER = join(webSrc, 'lib', 'realtime-appsync.ts');

// This file is excluded from its own scan, and not as a convenience: it necessarily
// contains every string it forbids - in the regexes, and in comments that quote the
// forbidden import to explain it. Matching plain source text cannot tell a comment
// from code, which is the accepted limitation of this whole style of check (see
// component-safety.test.ts, which makes the same trade). Verified: without this
// exclusion the Amplify rule matched the snippet `import { events } from
// 'aws-amplify/data'` inside the comment two blocks below.
const SELF = fileURLToPath(import.meta.url);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const webFiles = sourceFiles(webSrc).filter((f) => f !== SELF);
const notificationFiles = sourceFiles(notificationsSrc);

/** Matches a real import of the package, not a mention of it in a comment. */
const IMPORTS_AMPLIFY = /(?:from\s+|import\s*\(\s*)['"]aws-amplify(?:\/[\w-]+)?['"]/;
const MENTIONS_SUPABASE_JS = /@supabase\/supabase-js/;

describe('the sources exist to be checked', () => {
  // Without this, a broken path silently turns every assertion below into a
  // vacuous pass over an empty list - which is precisely how component-safety.test.ts
  // came to be inert.
  it('found web and notification sources', () => {
    expect(webFiles.length).toBeGreaterThan(20);
    expect(notificationFiles.length).toBeGreaterThan(5);
  });
});

describe('aws-amplify stays behind one adapter', () => {
  it('is imported by exactly one file in apps/web', () => {
    const importers = webFiles.filter((f) => IMPORTS_AMPLIFY.test(readFileSync(f, 'utf8')));
    expect(importers.map((f) => relative(repoRoot, f))).toEqual([
      relative(repoRoot, AMPLIFY_ADAPTER),
    ]);
  });

  // The rule that keeps the shared package usable by any transport.
  it('is never imported by packages/notifications', () => {
    const importers = notificationFiles
      .filter((f) => IMPORTS_AMPLIFY.test(readFileSync(f, 'utf8')))
      .map((f) => relative(repoRoot, f));
    expect(importers).toEqual([]);
  });

  // Reached only through `await import(...)`, which is what earns it its own chunk.
  // A plain `import { events } from 'aws-amplify/data'` in lib/realtime.ts would
  // typecheck, work, and quietly move Amplify into the entry bundle.
  it('is reached only through a dynamic import', () => {
    const realtime = readFileSync(join(webSrc, 'lib', 'realtime.ts'), 'utf8');
    expect(realtime).toMatch(/await import\(['"]\.\/realtime-appsync['"]\)/);
    expect(IMPORTS_AMPLIFY.test(realtime)).toBe(false);
  });
});

describe('the Supabase client is gone', () => {
  it('is referenced by no source file', () => {
    const offenders = [...webFiles, ...notificationFiles]
      .filter((f) => MENTIONS_SUPABASE_JS.test(readFileSync(f, 'utf8')))
      .map((f) => relative(repoRoot, f));
    expect(offenders).toEqual([]);
  });

  it('is not a dependency of any workspace', () => {
    for (const pkg of [
      join(repoRoot, 'package.json'),
      join(repoRoot, 'apps', 'web', 'package.json'),
      join(repoRoot, 'apps', 'api', 'package.json'),
      join(repoRoot, 'packages', 'notifications', 'package.json'),
    ]) {
      expect(readFileSync(pkg, 'utf8')).not.toMatch(MENTIONS_SUPABASE_JS);
    }
  });
});
