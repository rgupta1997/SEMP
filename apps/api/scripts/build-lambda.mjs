// Packages apps/api into a Lambda-deployable zip.
// Does NOT touch main.ts / the Render deploy — this only reads src/lambda.ts and
// the already-generated Prisma client, and writes to apps/api/dist-lambda/.
//
// Two callers:
//   - `sam build --config-env api`, via apps/api/Makefile, which sets ARTIFACTS_DIR
//     and PRISMA_ENGINE_TARGET and lets SAM do the packaging.
//   - `npm run build:lambda --workspace @semp/api`, which writes dist-lambda.zip
//     itself. That path is the escape hatch for when sam build misbehaves.
//
// Prereq: `npm run prisma:generate --workspace @semp/api` must have already run,
// with the Lambda engine listed in binaryTargets in prisma/schema.prisma (currently
// "linux-arm64-openssl-3.0.x"), so that binary exists on disk to copy in. The
// Makefile runs generate for you; the standalone path does not.
import { build } from 'esbuild';
import { existsSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // apps/api
// `sam build` sets ARTIFACTS_DIR to an absolute path under .aws-sam/build and then
// zips + content-hashes whatever it finds there. Honouring it lets one script serve
// both the SAM build (via apps/api/Makefile) and the standalone
// `npm run build:lambda` escape hatch, so the bundling logic has exactly one home.
const outDir = process.env.ARTIFACTS_DIR ?? path.join(root, 'dist-lambda');
const zipPath = path.join(root, 'dist-lambda.zip');

// npm workspaces hoist shared deps to the monorepo root - @prisma/client and
// the generated .prisma/client (with the engine binaries) live there, not
// under apps/api/node_modules, unless a workspace-local copy also exists.
function resolveModule(name) {
  const local = path.join(root, 'node_modules', name);
  if (existsSync(local)) return local;
  const hoisted = path.join(root, '../..', 'node_modules', name);
  if (existsSync(hoisted)) return hoisted;
  throw new Error(`[build-lambda] could not find ${name} under apps/api or the monorepo root node_modules`);
}

rmSync(outDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(outDir, { recursive: true });

console.log('[build-lambda] bundling src/lambda.ts with esbuild...');
await build({
  entryPoints: [path.join(root, 'src/lambda.ts')],
  outfile: path.join(outDir, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22', // must match Runtime: in infra/semp-api.yaml
  format: 'esm',
  sourcemap: false,
  // Prisma's generated client does its own runtime resolution of the native
  // query-engine binary next to it - it does not bundle cleanly with esbuild.
  // Keep it external and copy the real package in below instead.
  external: ['@prisma/client', '.prisma/client'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});

console.log('[build-lambda] copying Prisma client...');
const nm = path.join(outDir, 'node_modules');
mkdirSync(nm, { recursive: true });
cpSync(resolveModule('@prisma/client'), path.join(nm, '@prisma/client'), { recursive: true });
cpSync(resolveModule('.prisma/client'), path.join(nm, '.prisma/client'), { recursive: true });

// Trim every generated query-engine binary except the one the target Lambda runtime
// needs, so the artifact stays small. Chosen in ONE place - apps/api/Makefile sets
// this to match Architectures: in infra/semp-api.yaml - so the architecture cannot
// drift between the template and the bundle. The default matches the arm64
// binaryTargets entry in prisma/schema.prisma.
const keep = process.env.PRISMA_ENGINE_TARGET ?? 'linux-arm64-openssl-3.0.x';
const genDir = path.join(nm, '.prisma/client');
for (const f of readdirSync(genDir)) {
  const isEngine = /^libquery_engine|^query_engine/.test(f);
  if (isEngine && !f.includes(keep)) {
    rmSync(path.join(genDir, f), { force: true });
    console.log(`[build-lambda] dropped unused engine binary: ${f}`);
  }
}
if (!readdirSync(genDir).some((f) => f.includes(keep))) {
  throw new Error(
    `[build-lambda] no "${keep}" engine binary found in .prisma/client. ` +
    `Run "npm run prisma:generate --workspace @semp/api" first, and confirm ` +
    `binaryTargets in schema.prisma includes "${keep}".`
  );
}

function dirSizeMB(p) {
  let bytes = 0;
  for (const f of readdirSync(p, { withFileTypes: true, recursive: true })) {
    if (f.isFile()) bytes += statSync(path.join(f.path ?? p, f.name)).size;
  }
  return (bytes / 1024 / 1024).toFixed(1);
}
console.log(`[build-lambda] bundle size: ~${dirSizeMB(outDir)} MB (uncompressed)`);

// Under `sam build`, SAM owns packaging: it zips ARTIFACTS_DIR itself and hashes the
// CONTENT, so an unchanged build is a genuine no-op deploy. Zipping here instead
// would defeat that - `zip` embeds mtimes, so the archive hash changes on every run
// and every deploy re-uploads and issues a real function update (and therefore a
// fresh cold start) even when nothing changed.
if (process.env.ARTIFACTS_DIR) {
  console.log(`[build-lambda] done -> ${outDir} (SAM will package it)`);
  console.log('[build-lambda] Lambda handler setting: index.handler');
  process.exit(0);
}

console.log('[build-lambda] zipping...');
if (process.platform === 'win32') {
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force`,
  ], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', zipPath, '.'], { cwd: outDir, stdio: 'inherit' });
}

console.log(`[build-lambda] done -> ${zipPath}`);
console.log('[build-lambda] Lambda handler setting: index.handler');
