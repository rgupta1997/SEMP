import { defineConfig } from 'vitest/config';

// The only reason this file exists: NODE_ENV is a required enum with no default
// (src/config/env.schema.ts), and the test suite transitively imports config/env.ts
// through http/server.ts, iam/auth-tokens.service.ts and modules/certificates. A test
// run with NODE_ENV unset would fail at import time, before a single assertion.
//
// Vitest 2 does set NODE_ENV=test itself, but as an undocumented internal of a
// ^-ranged devDependency (`process.env.NODE_ENV ??= "test"` in its cli-api chunk).
// That is too thin a thread to hang "can the suite import its own modules" on, so
// pin it here: `test.env` is merged LAST when the worker environment is built, so
// this wins over both the ambient value and anything dotenv loaded from .env.
//
// Deliberately NOT done as `"test": "NODE_ENV=test vitest run"` in package.json:
// that syntax fails under Windows cmd.exe, and this repo supports Windows
// contributors (scripts/deploy-lambda.mjs exists solely to work around cmd.exe
// quoting, and scripts/build-lambda.mjs branches on win32).
//
// `include`/`exclude` are left at their defaults on purpose - narrowing them here
// would silently drop test files from the run.
export default defineConfig({
  test: {
    env: { NODE_ENV: 'test' },
  },
});
