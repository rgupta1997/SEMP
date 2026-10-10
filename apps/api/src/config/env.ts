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

  // The same bargain for SMS. No gateway is wired, and transactional SMS in India
  // additionally needs DLT registration, so this keeps phone sign-in buildable
  // while that is procured. Same production refusal as the email bypass.
  OTP_SMS_BYPASS: bool(true),

  OTP_TTL_MIN: z.coerce.number().int().positive().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  // How many accounts may share one phone number. Option B exists so one person can
  // keep work and personal apart - it is not an invitation to farm accounts on a
  // single number, and without a cap one number can mint OTPs through all of them.
  MAX_ACCOUNTS_PER_PHONE: z.coerce.number().int().positive().default(3),

  // ---- WhatsApp (AiSensy) ------------------------------------------------
  // The delivery channel for phone sign-in codes - see modules/comms/whatsapp.ts.
  // Absent a key the phone path falls back to the unwired SMS stub, so these are
  // what turn OTP_SMS_BYPASS off in practice: with a key and a campaign set, codes
  // are really sent and never come back in the response.
  AISENSY_API_KEY: z.string().default(''),
  // The campaign bound to the approved WhatsApp authentication template. Named
  // per-campaign (AISENSY_<WHAT>_CAMPAIGN) as the Sportagon FMS functions do it,
  // because a second template - an invitation, a result - will want its own.
  AISENSY_OTP_CAMPAIGN: z.string().default('otp'),
  AISENSY_API_URL: z.string().url().default('https://backend.aisensy.com/campaign/t1/api/v2'),

  // Phone numbers are stored as bare 10-digit nationals (normalizePhone keeps the
  // last 10), but WhatsApp addresses need the dialling code put back.
  OTP_PHONE_COUNTRY_CODE: z.string().regex(/^[0-9]{1,4}$/).default('91'),
});

const parsed = schema
  .refine((e) => !(e.NODE_ENV === 'production' && e.OTP_SMS_BYPASS), {
    path: ['OTP_SMS_BYPASS'],
    message: 'OTP_SMS_BYPASS must be off in production - it hands out sign-in codes to the caller',
  })
  .refine((e) => !(e.NODE_ENV === 'production' && !e.AISENSY_API_KEY), {
    path: ['AISENSY_API_KEY'],
    // Without a key the phone path falls through to sendSms(), which has no provider
    // behind it - and in production the bypass that made that survivable is refused
    // by the rule above. So booting without this is booting with phone sign-in
    // guaranteed to 500 for every user; better to say so here than at 3am.
    message: 'AISENSY_API_KEY is required in production - it is how phone sign-in codes are delivered',
  })
  .refine((e) => !(e.NODE_ENV === 'production' && e.AUTH_EMAIL_BYPASS), {
    path: ['AUTH_EMAIL_BYPASS'],
    // With the bypass on, anyone who can call /auth/otp/request can read the code
    // it just issued - which is a sign-in as any address they like. Refusing to
    // boot is the only safe failure mode; a warning would eventually get ignored.
    message: 'AUTH_EMAIL_BYPASS must be off in production - it hands out sign-in codes to the caller',
  })
  .parse(process.env);

export const env = parsed;
