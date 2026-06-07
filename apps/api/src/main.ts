import './http/middleware/types.js'; // load Request augmentation
import { env } from './config/env.js';
import { prisma } from './infra/prisma.js';
import { buildApp } from './http/server.js';

const app = buildApp(prisma);

app.listen(env.PORT, () => {
  console.log(`SEMP API listening on http://localhost:${env.PORT}`);
});
