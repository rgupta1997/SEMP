import 'dotenv/config';
import { envSchema } from './env.schema.js';

// The environment, parsed once at module load. The SHAPE lives in env.schema.ts;
// this module is only the side-effecting half (dotenv + parse), so that the schema
// stays importable by tests without dragging a developer's real .env along.
//
// `.parse`, not `.safeParse`: a bad or missing variable is a boot crash on purpose.
// Under `tsx` that is a failed start; on Lambda it is an init failure on every cold
// start. Both are loud. The alternative - degrading to defaults - is what produced a
// production API with the OTP bypasses on, so there is no softer failure mode worth
// having here.
//
// `dotenv/config` is imported before the schema on purpose: ESM evaluates imports in
// order, so process.env is populated before `parse` runs.
export const env = envSchema.parse(process.env);

/**
 * One place to ask, so no call site has to re-spell the literal.
 *
 * Used for defence in depth at the points where a secret would actually leave the
 * process (see signin.routes.ts), not to re-implement the boot guards - those live
 * in env.schema.ts and have already run by the time anything reads this.
 */
export const isProduction = env.NODE_ENV === 'production';
