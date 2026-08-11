// Thin cross-platform launcher for deploy-lambda.sh.
// Exists only because Windows cmd.exe (what npm scripts run under by default
// on win32) mangles a quoted absolute path containing spaces (e.g.
// "C:\Program Files\Git\bin\bash.exe") when it's written directly as a
// package.json script string. Node's spawn() passes argv straight through,
// no shell re-quoting involved, so it doesn't hit that.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const shPath = path.join(scriptDir, 'deploy-lambda.sh');

const candidates = process.platform === 'win32'
  ? [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'bash', // last resort - may resolve to the WSL shim in System32 if that's earlier on PATH
    ]
  : ['bash'];

const bash = candidates.find((c) => c === 'bash' || existsSync(c)) ?? 'bash';

const result = spawnSync(bash, [shPath], { stdio: 'inherit' });
if (result.error) {
  console.error(`[deploy-lambda] failed to launch "${bash}": ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
