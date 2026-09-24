// Bundles one SMALL Lambda - the AppSync authorizer, the notification publisher -
// as a single index.mjs, with a hard size budget.
//
// Deliberately a SEPARATE script from build-lambda.mjs rather than a generalisation
// of it. That file is mostly Prisma-engine logic: resolve the hoisted client, copy
// it in, prune every engine but the arm64 one, assert one survived, chmod it. None
// of that applies here, and folding the two together would mean every future change
// to the Prisma pipeline carries a risk of breaking the function that guards every
// realtime subscription.
//
// Usage (from apps/api, via the Makefile):
//   ENTRY=src/realtime-authorizer.ts MAX_BUNDLE_KB=400 \
//   ARTIFACTS_DIR=... node scripts/build-fn.mjs
//
// ---------------------------------------------------------------------------
// The size budget is the point, not a nicety.
// ---------------------------------------------------------------------------
// These functions must not reach config/env.ts, infra/prisma.ts or http/server.ts.
// Nothing stops someone importing a helper that transitively does - the import
// compiles, the tests pass, and the only symptom is that a function on AppSync's
// latency-sensitive connect path quietly gained the whole application and half a
// second of cold start. Bundle size is the one signal that moves immediately and
// unmistakably when that happens, so it is asserted here and the build fails.

import { build } from 'esbuild';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // apps/api

const entry = process.env.ENTRY;
if (!entry) throw new Error('[build-fn] ENTRY is required, e.g. src/realtime-authorizer.ts');

const maxKb = Number(process.env.MAX_BUNDLE_KB ?? '500');

// Honour ARTIFACTS_DIR the way build-lambda.mjs does, so one script serves both
// `sam build` (which zips and content-hashes whatever lands there) and a local run.
const outDir =
  process.env.ARTIFACTS_DIR ?? path.join(root, 'dist-fn', path.basename(entry, '.ts'));

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log(`[build-fn] bundling ${entry} with esbuild...`);
await build({
  entryPoints: [path.join(root, entry)],
  outfile: path.join(outDir, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22', // must match Runtime: in infra/semp-api.yaml
  format: 'esm',
  sourcemap: false,
  // NOTHING external. Unlike the API bundle there is no Prisma here, and marking an
  // AWS SDK external would not work anyway: this output is ESM in /var/task, which
  // cannot reliably resolve the runtime's own copy.
  external: [],
  // outfile (not outdir) with splitting off, so the result is exactly one file -
  // esbuild errors if anyone turns splitting on while using outfile, which is what
  // keeps "a single inlined index.mjs" true by construction rather than by review.
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});

const bytes = statSync(path.join(outDir, 'index.mjs')).size;
const kb = Math.round(bytes / 1024);

if (bytes > maxKb * 1024) {
  throw new Error(
    `[build-fn] ${entry} bundled to ${kb} KB, over the ${maxKb} KB budget.\n` +
      'Almost always this means a new import reached config/env.ts, infra/prisma.ts\n' +
      'or http/server.ts. Find it with:\n' +
      `  npx esbuild ${entry} --bundle --platform=node --format=esm --analyze\n` +
      'Raise the budget only if the growth is genuinely intended.',
  );
}

console.log(`[build-fn] ${entry} -> ${kb} KB (budget ${maxKb} KB)`);
