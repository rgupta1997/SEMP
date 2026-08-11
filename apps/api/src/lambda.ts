// AWS Lambda entry point — additive only, does not change local/Render behaviour.
// `main.ts` (tsx, `app.listen`) is still what `npm run dev` / `npm start` / Render use.
// This file wraps the exact same Express app (`buildApp`) for API Gateway instead.
import './http/middleware/types.js'; // load Request augmentation
import serverlessHttp from 'serverless-http';
import { prisma } from './infra/prisma.js';
import { buildApp } from './http/server.js';

// Built once per warm Lambda container (module scope), then reused across
// invocations — same singleton PrismaClient as the Render deployment, just
// without the `.listen()` call, since API Gateway owns the socket instead.
const app = buildApp(prisma);

export const handler = serverlessHttp(app);
