// Packages apps/api into a Lambda-deployable zip.
// Does NOT touch main.ts / the Render deploy — this only reads src/lambda.ts and
// the already-generated Prisma client, and writes to apps/api/dist-lambda/.
//
// Usage: npm run build:lambda --workspace @semp/api
// Prereq: `npm run prisma:generate --workspace @semp/api` must have already run
// with binaryTargets = ["native", "rhel-openssl-3.0.x"] in schema.prisma, so the
// Lambda-compatible query engine binary exists on disk to copy in.
import { build } from 'esbuild';
import { existsSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // apps/api
const outDir = path.join(root, 'dist-lambda');
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
  target: 'node20',
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

// Trim every generated query-engine binary except the one Lambda's nodejs20.x
// (Amazon Linux 2023, x86_64) runtime needs, so the zip stays small.
const keep = 'rhel-openssl-3.0.x';
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
