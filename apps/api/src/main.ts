import './http/middleware/types.js'; // load Request augmentation
import { env } from './config/env.js';
import { prisma } from './infra/prisma.js';
import { buildApp } from './http/server.js';

const app = buildApp(prisma);

const server = app.listen(env.PORT, () => {
  console.log(`SEMP API listening on http://localhost:${env.PORT}`);
});

// Release DB connections on shutdown. Render sends SIGTERM on every redeploy;
// without an explicit $disconnect the previous instance's connections linger in
// the Supabase pooler until it times them out, stacking on top of the new
// instance's pool and exhausting the (small) session/transaction budget.
async function shutdown(signal: string) {
  console.log(`${signal} received — shutting down`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
