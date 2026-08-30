import { setDefaultResultOrder } from 'node:dns';
// The Supabase pooler host resolves to real IPv4 addresses plus NAT64-synthesized
// IPv6 ones; Node's default DNS ordering races IPv6 first, which on networks with
// flaky NAT64 causes intermittent P1001s and connection-pool-fill timeouts (P2024).
setDefaultResultOrder('ipv4first');

import './http/middleware/types.js'; // load Request augmentation
import { env } from './config/env.js';
import { prisma } from './infra/prisma.js';
import { buildApp } from './http/server.js';

const app = buildApp(prisma);

// A brand-new PrismaClient's first-ever query pays the full connection cost
// (TCP + TLS to a remote Supabase host, plus the query engine's own startup) -
// measured at ~5s against this project's Sydney-region database. Every
// request-time query is capped well under that (interactive transactions at
// 5s by default), so if the first real request happens to be the one to touch
// the database, it can lose to its own timeout before the connection is even
// ready - not a flaky connection, a cold one. tsx watch makes this common in
// dev: it restarts the whole process on every save, so "the first thing I did
// after saving" is exactly the request most likely to race a cold connection.
// Paying that cost once, here, before the server accepts any traffic, means
// no request ever has to.
//
// This must never be able to crash the process, though: this connection is
// known to be intermittently unreachable for a moment (the same P1001 seen
// live in requests), and startup failing hard on that would make a transient
// blip take the whole server down instead of just the one thing that touched
// it. A couple of quick retries give a genuine blip a chance to clear; if it
// still hasn't after that, the server starts anyway and pays the connection
// cost on the first real request instead - worse for that one request, but
// never worse than refusing to start at all.
async function warmDbConnection(attempts = 3): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await prisma.$connect();
      return;
    } catch (err) {
      console.error(`[startup] database warm-up attempt ${i}/${attempts} failed:`, err instanceof Error ? err.message : err);
      if (i < attempts) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  console.error('[startup] proceeding without a warm database connection - the first real request will pay this cost instead.');
}

await warmDbConnection();

const server = app.listen(env.PORT, () => {
  console.log(`SEMP API listening on http://localhost:${env.PORT}`);
});

// Release DB connections on shutdown. Render sends SIGTERM on every redeploy;
// without an explicit $disconnect the previous instance's connections linger in
// the Supabase pooler until it times them out, stacking on top of the new
// instance's pool and exhausting the (small) session/transaction budget.
async function shutdown(signal: string) {
  console.log(`${signal} received - shutting down`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
