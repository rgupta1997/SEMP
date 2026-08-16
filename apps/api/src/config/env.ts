import 'dotenv/config';
import { z } from 'zod';

// "true"/"1"/"yes" -> true; anything else (including absent) falls back to `def`.
const bool = (def: boolean) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? def : ['true', '1', 'yes'].includes(String(v).toLowerCase())),
    z.boolean(),
  );

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@semp.local'),
  SEED_ADMIN_PASSWORD: z.string().default('admin123'),
  SEED_ADMIN_NAME: z.string().default('Platform Admin'),

  NODE_ENV: z.string().default('development'),

  // Email delivery is not wired yet (module 02). While this is on, /auth/otp/request
  // returns the code in its own response so the flow is usable end to end.
  // See the refinement below - this must never be on in production.
  AUTH_EMAIL_BYPASS: bool(true),
  OTP_TTL_MIN: z.coerce.number().int().positive().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
});

const parsed = schema
  .refine((e) => !(e.NODE_ENV === 'production' && e.AUTH_EMAIL_BYPASS), {
    path: ['AUTH_EMAIL_BYPASS'],
    // With the bypass on, anyone who can call /auth/otp/request can read the code
    // it just issued - which is a sign-in as any address they like. Refusing to
    // boot is the only safe failure mode; a warning would eventually get ignored.
    message: 'AUTH_EMAIL_BYPASS must be off in production - it hands out sign-in codes to the caller',
  })
  .parse(process.env);

export const env = parsed;
