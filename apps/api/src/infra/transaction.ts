/**
 * Interactive transaction budget, in ms. Prisma's 5s default cut off legitimate writes
 * (a scorecard lock, a big import) on slow connections. Kept apart from prisma.ts so
 * importing it never creates a database client.
 */
export const TRANSACTION_TIMEOUT_MS = 120_000;
