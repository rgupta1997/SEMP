import { z } from 'zod';

// The SHAPE of the environment, with no side effects: no dotenv, no `process.env`,
// no parse. Split out of env.ts so it can be tested directly.
//
// Why that split matters: env.ts parses at module load, against whatever the
// developer's real .env happens to contain. A test that imported the schema from
// there would execute that parse too, so an unrelated local misconfiguration (say
// MAIL_TRANSPORT=http with an empty MAIL_API_KEY) would fail the schema's own tests
// for a reason that has nothing to do with them. .env is gitignored and
// hand-maintained, so that is a matter of when, not if.

// "true"/"1"/"yes" -> true; anything else (including absent) falls back to `def`.
//
// Note the asymmetry, because it is load-bearing for the guards below: a TYPO
// ('ture', 'on') resolves to false and so fails safe, but ABSENCE resolves to
// `def`. For the two bypass flags `def` is true, which means a missing variable
// fails OPEN. That is deliberate - it is what makes a fresh clone work with no
// mail account - and it is the exact reason NODE_ENV must be mandatory: the
// production refusals are the only thing standing between "absent" and "insecure".
const bool = (def: boolean) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? def : ['true', '1', 'yes'].includes(String(v).toLowerCase())),
    z.boolean(),
  );

// Values that must never sign anything in production. Both are real: the first is
// what apps/api/.env carries (and what scripts sourcing that file would deploy),
// the second is what .env.example ships to every new clone.
const WEAK_JWT_SECRETS = new Set([
  'dev-secret-change-me',
  'change-me-in-production',
  'secret',
  'changeme',
  'password',
]);

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@semp.local'),
  SEED_ADMIN_PASSWORD: z.string().default('admin123'),
  SEED_ADMIN_NAME: z.string().default('Platform Admin'),

  // REQUIRED, and deliberately WITHOUT a default.
  //
  // Every refinement below keys off this value. While it defaulted to 'development',
  // any deploy target that did not set it booted with all of them inert - which is
  // not hypothetical: scripts/deploy-lambda.sh passed exactly three variables
  // (DATABASE_URL, JWT_SECRET, WEB_ORIGIN) and Lambda sets no NODE_ENV of its own,
  // so that path shipped an API handing out sign-in codes to anyone who asked.
  //
  // An enum rather than a string because the comparison is `=== 'production'`:
  // 'prod', 'Production' and 'staging' are all silently non-production, and a
  // typo in a deploy config must not be the thing that re-opens the bypasses.
  //
  // A single errorMap covers both failure codes - absent is invalid_type (whose
  // default zod message is a bare "Required"), a wrong value is invalid_enum_value.
  NODE_ENV: z.enum(['development', 'test', 'production'], {
    errorMap: () => ({
      message:
        'NODE_ENV must be set explicitly to "development", "test" or "production" - it has no default, ' +
        'because the production guards (OTP bypass, mail transport, JWT secret) all key off it. ' +
        'Local dev: add NODE_ENV=development to apps/api/.env (see .env.example). ' +
        'Tests: apps/api/vitest.config.ts sets it. Deploys: set NODE_ENV=production.',
    }),
  }),

  // Where the WEB app lives, as ONE origin. Deliberately not WEB_ORIGIN: that is a
  // CORS allow-list and is comma-separated in production, so you cannot build a link
  // out of it. Every absolute URL we put in an email is built from this.
  WEB_APP_URL: z.string().url().default('http://localhost:5173').transform((s) => s.replace(/\/+$/, '')),

  // ---- mail ----------------------------------------------------------------
  //
  // Delivery is a separate service (docs/integration-guide.md). We POST a task and
  // it owns rendering, retries, bounces and the audit trail.
  //
  // 'console' logs the message instead of sending it, which is what makes the whole
  // sign-in flow runnable with no mail account. 'http' talks to the real service.
  MAIL_TRANSPORT: z.enum(['console', 'http']).default('console'),

  // The base ORIGIN, not an endpoint - the client appends /mail, /templates, etc.
  // A trailing slash would produce '//mail', so it is stripped here once.
  MAIL_API_URL: z.string().url().optional().transform((s) => s?.replace(/\/+$/, '')),

  // The secret ONLY. The service is configured with `callerName:secret` pairs and
  // recognises us by the secret alone; sending the pair is a 401.
  MAIL_API_KEY: z.string().min(1).optional(),

  // The OTP send happens inline on the sign-in request and the service is a Lambda
  // that cold-starts, so an unbounded fetch would hang sign-in behind someone else's
  // cold start. Node's fetch has no default timeout; this is it.
  MAIL_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

  // ---- realtime notifications ----------------------------------------------
  //
  // Live delivery of the notification bell, via AppSync Events. Replaces Supabase
  // Realtime, which read Supabase's own Postgres WAL and so cannot survive the move
  // to RDS at all.
  //
  // Exactly the same bargain as MAIL_TRANSPORT above, for the same reason: 'off'
  // makes every notify() a feed-only write, which is what keeps a fresh clone
  // runnable with no AWS account. Production must be 'appsync' - see the refinement
  // below, and note that the mail port shipping unregistered for months is precisely
  // the failure that guard exists to prevent.
  REALTIME_TRANSPORT: z.enum(['off', 'appsync']).default('off'),

  // The fan-out queue. The API only ever enqueues; a separate Lambda publishes, and
  // the API's IAM role deliberately has no appsync:EventPublish permission at all.
  APPSYNC_NOTIFICATIONS_QUEUE_URL: z.string().url().optional(),

  // Handed to the browser in the response to POST /notifications/realtime-token,
  // NOT baked into the frontend bundle as a VITE_ constant. That is deliberate:
  // VITE_API_URL's own stack output comments at length on needing a frontend rebuild
  // whenever it changes, and this value changes whenever the stack is replaced.
  // The HTTP endpoint HOSTNAME (the Dns.Http stack output), not the realtime one.
  //
  // Counter-intuitive but load-bearing. The browser connects over WebSockets, yet
  // Amplify's events client wants the HTTP endpoint and derives the WebSocket URL
  // itself: getRealtimeEndpointUrl() in @aws-amplify/api-graphql matches
  //   ^https://\w{26}\.\w+-api\.<region>\.amazonaws\.com/event$
  // and only then rewrites `appsync-api` to `appsync-realtime-api` and appends
  // `/realtime`. Hand it the realtime hostname instead and that pattern does not
  // match, so it falls through to the CUSTOM DOMAIN branch, appends `/realtime` to
  // something that is not a URL, and the connection fails with nothing explaining
  // why. The mint endpoint assembles `https://<this>/event` from it.
  APPSYNC_EVENTS_HTTP_ENDPOINT: z.string().min(1).optional(),

  // Returned alongside the endpoint, so the browser needs NO build-time AppSync
  // configuration whatsoever. The alternative - a VITE_ var, or deriving the region
  // by regex from the endpoint hostname - is either a rebuild every time the stack
  // changes or a parse that breaks the day a custom domain appears.
  APPSYNC_EVENTS_REGION: z.string().min(1).optional(),

  // Must match NOTIFICATION_CHANNEL_NAMESPACE in
  // packages/notifications/src/core/channels.ts and the AppSync ChannelNamespace in
  // infra/semp-api.yaml. All three deploy together; a mismatch is silent - the
  // publisher succeeds against a namespace nobody is subscribed to.
  REALTIME_CHANNEL_NAMESPACE: z.string().min(1).default('notifications'),

  // Three numbers derive from this and must stay consistent: the browser
  // re-subscribes at roughly TTL minus two minutes, and the AppSync authorizer caps
  // its cached answer at the token's own remaining life. Too long and a connection
  // outlives the token behind it; too short and every user gets a gap every cycle.
  REALTIME_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  // Returns the OTP in /auth/otp/send's own response so the flow is usable without a
  // mailbox. NOT the same thing as MAIL_TRANSPORT: this one hands out sign-in codes
  // to whoever asked, which is why the refinement below refuses it in production.
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
});

// Chained .refine deliberately, NOT .superRefine with `fatal: true`: chained
// refinements do not short-circuit, so a minimally-configured deploy reports every
// problem it has in ONE crash and an operator fixes the whole thing in one pass.
// env.schema.test.ts asserts that property directly - converting these to a
// short-circuiting form would quietly break it.
export const envSchema = schema
  .refine((e) => !(e.NODE_ENV === 'production' && e.OTP_SMS_BYPASS), {
    path: ['OTP_SMS_BYPASS'],
    message: 'OTP_SMS_BYPASS must be off in production - it hands out sign-in codes to the caller',
  })
  .refine((e) => !(e.NODE_ENV === 'production' && e.AUTH_EMAIL_BYPASS), {
    path: ['AUTH_EMAIL_BYPASS'],
    // With the bypass on, anyone who can call /auth/otp/request can read the code
    // it just issued - which is a sign-in as any address they like. Refusing to
    // boot is the only safe failure mode; a warning would eventually get ignored.
    //
    // This refusal is real only because NODE_ENV above is mandatory. It was always
    // written as though it were unconditional; for every deploy target that never
    // set NODE_ENV, it did nothing at all.
    message: 'AUTH_EMAIL_BYPASS must be off in production - it hands out sign-in codes to the caller',
  })
  // Separate from the bypass on purpose. The two used to be one flag, which meant
  // "stop printing codes to the caller" and "start sending real mail" could not be
  // decided independently - and turning the bypass off without a transport left
  // sendEmail() throwing on every sign-in.
  .refine((e) => !(e.NODE_ENV === 'production' && e.MAIL_TRANSPORT !== 'http'), {
    path: ['MAIL_TRANSPORT'],
    message: 'MAIL_TRANSPORT must be "http" in production - "console" silently discards every email',
  })
  .refine((e) => e.MAIL_TRANSPORT !== 'http' || (!!e.MAIL_API_URL && !!e.MAIL_API_KEY), {
    path: ['MAIL_API_URL'],
    // Failing at boot beats failing on the first password reset of the day.
    message: 'MAIL_TRANSPORT=http needs MAIL_API_URL and MAIL_API_KEY',
  })
  // Mirrors the MAIL_TRANSPORT pair above exactly. 'off' in production means the
  // bell silently stops updating live and degrades to its 2-minute poll - which is
  // a perfectly usable product and therefore something nobody would report for
  // weeks. Refusing to boot is the only failure mode that gets noticed.
  //
  // NOTE for the Render deployment: render.yaml sets NODE_ENV=production, so this
  // guard stops that service booting until it either gets the two values below plus
  // AWS credentials, or is retired in favour of Lambda (which is the plan).
  .refine((e) => !(e.NODE_ENV === 'production' && e.REALTIME_TRANSPORT !== 'appsync'), {
    path: ['REALTIME_TRANSPORT'],
    message:
      'REALTIME_TRANSPORT must be "appsync" in production - "off" silently drops every live ' +
      'notification, and the bell degrades to polling with nothing anywhere reporting it.',
  })
  .refine(
    (e) =>
      e.REALTIME_TRANSPORT !== 'appsync' ||
      (!!e.APPSYNC_NOTIFICATIONS_QUEUE_URL &&
        !!e.APPSYNC_EVENTS_HTTP_ENDPOINT &&
        !!e.APPSYNC_EVENTS_REGION),
    {
      path: ['APPSYNC_NOTIFICATIONS_QUEUE_URL'],
      // Failing at boot beats every notify() logging an enqueue error all day.
      message:
        'REALTIME_TRANSPORT=appsync needs APPSYNC_NOTIFICATIONS_QUEUE_URL, ' +
        'APPSYNC_EVENTS_HTTP_ENDPOINT and APPSYNC_EVENTS_REGION',
    },
  )
  // JWT_SECRET signs FIVE different things, and only the first is a session:
  //   - session tokens          (http/middleware/auth.ts)
  //   - verification tickets    (modules/iam/verification-ticket.ts)
  //   - certificate signatures  (modules/certificates/certificates.service.ts)
  //   - public share links      (modules/public/share-token.ts)
  //   - realtime tokens, via an HKDF-DERIVED key (modules/realtime/token-key.ts) -
  //     derived rather than used directly precisely so a realtime token cannot also
  //     be presented as a session token
  // So a guessable value here is not "sessions are weak", it is a forged super-admin
  // JWT on demand, with no OTP and no password involved - strictly worse than the
  // bypass leak the rest of this file is about. `.min(1)` on the field was the only
  // check, and the two values below were sitting in .env / .env.example.
  //
  // Note what this guard cannot do: it fires at BOOT, so it stops the next deploy,
  // not the current one. If a weak secret has already been live, rotating it is the
  // fix - and rotation invalidates every issued certificate's signature and every
  // distributed share link, so read the rotation note in the plan before doing it.
  .refine(
    (e) => !(e.NODE_ENV === 'production' && (e.JWT_SECRET.length < 32 || WEAK_JWT_SECRETS.has(e.JWT_SECRET))),
    {
      path: ['JWT_SECRET'],
      message:
        'JWT_SECRET must be a unique random value of at least 32 characters in production - ' +
        'it signs session tokens, verification tickets, certificate signatures and public share links. ' +
        'Rotating it signs everyone out AND invalidates verification of already-issued certificates.',
    },
  );

export type Env = z.infer<typeof envSchema>;
