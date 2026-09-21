// The Express app, wrapped for API Gateway. NOT the Lambda entry point - that is
// lambda.ts, which populates process.env from Secrets Manager and only then imports
// this module. Splitting the two is what makes that ordering possible: everything
// below reads configuration at MODULE LOAD (config/env.ts parses process.env,
// infra/prisma.ts constructs PrismaClient), so a static import from the bootstrap
// would run before any secret could be fetched.
//
// `main.ts` (tsx, `app.listen`) is still what `npm run dev` / `npm start` / Render use.
import './http/middleware/types.js'; // load Request augmentation
import serverlessHttp from 'serverless-http';
import { prisma } from './infra/prisma.js';
import { buildApp } from './http/server.js';

// Built once per warm Lambda container (module scope), then reused across
// invocations — same singleton PrismaClient as the Render deployment, just
// without the `.listen()` call, since API Gateway owns the socket instead.
const app = buildApp(prisma);

export const handler = serverlessHttp(app);
