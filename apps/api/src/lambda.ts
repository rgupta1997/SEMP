// AWS Lambda entry point: fetch configuration, THEN load the app.
//
// The ordering problem this solves: config/env.ts calls `envSchema.parse(process.env)`
// at module load, and infra/prisma.ts constructs its PrismaClient at module load. So
// by the time any normal import of the app has finished evaluating, the environment
// has already been read. A static import here would therefore run before a single
// secret could be fetched, and DATABASE_URL would have to arrive as a plaintext
// Lambda environment variable - readable by anyone with lambda:GetFunctionConfiguration,
// visible in console screenshots, and stale the moment the secret rotates.
//
// ESM top-level await plus a DYNAMIC import fixes it without touching anything
// downstream: the awaits below complete first, so the whole existing module graph -
// env.ts, the eager prisma singleton, all ~40 routers - keeps working untouched.
//
// Secrets are read from the AWS Parameters and Secrets Lambda Extension on
// localhost:2773 rather than through the AWS SDK. The extension caches per
// container, so this is one loopback request per COLD START (~10-40ms), not an
// internet round trip to Secrets Manager (~100-300ms) and not 1-3 MB of SDK added
// to the bundle and parsed on every cold start. Warm invocations pay nothing: this
// module body runs once per container, not once per request.

/** One secret, as the JSON object it stores. */
async function getSecret(arn: string): Promise<Record<string, string>> {
  const token = process.env.AWS_SESSION_TOKEN;
  if (!token) {
    throw new Error(
      'AWS_SESSION_TOKEN is missing - the Parameters and Secrets extension refuses ' +
      'requests without it. This module only runs on Lambda; use main.ts locally.',
    );
  }

  const res = await fetch(
    `http://localhost:2773/secretsmanager/get?secretId=${encodeURIComponent(arn)}`,
    { headers: { 'X-Aws-Parameters-Secrets-Token': token } },
  );

  if (!res.ok) {
    // Surfaced verbatim because the usual causes are all configuration, and each
    // has a different fix: a missing extension layer (connection refused), an ARN
    // the function's role cannot read (403), or a secret that does not exist (404).
    throw new Error(`secret fetch failed for ${arn}: ${res.status} ${await res.text()}`);
  }

  const { SecretString } = (await res.json()) as { SecretString?: string };
  if (!SecretString) throw new Error(`secret ${arn} has no SecretString`);
  return JSON.parse(SecretString) as Record<string, string>;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set - it is supplied by infra/semp-api.yaml`);
  return v;
}

const [db, app] = await Promise.all([
  getSecret(required('DB_SECRET_ARN')),
  getSecret(required('APP_SECRET_ARN')),
]);

// Assembled here rather than in the CloudFormation template so the password never
// becomes a function environment variable. encodeURIComponent because a single '#'
// in a generated password turns the rest of the connection string into a URL
// fragment and Prisma then fails with something entirely unrelated-looking.
//
// connection_limit=1 because each Lambda container serves one request at a time, so
// it never needs more; the bound on total database connections is that times the
// function's reserved concurrency.
process.env.DATABASE_URL =
  `postgresql://${encodeURIComponent(db.username)}:${encodeURIComponent(db.password)}` +
  `@${db.host}:${db.port}/${db.dbname}` +
  '?sslmode=require&connection_limit=1&pool_timeout=10&connect_timeout=10';

process.env.JWT_SECRET = app.JWT_SECRET;
process.env.MAIL_API_KEY = app.MAIL_API_KEY;

const { handler: inner } = await import('./lambda-app.js');

export const handler = inner;
