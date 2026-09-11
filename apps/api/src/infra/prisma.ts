import { PrismaClient } from '@prisma/client';

// Single PrismaClient, created here and shared with every persistence adapter
// via the composition root. The domain/application layers never import this.
//
// `timeout` is the ceiling on a `$transaction(async (tx) => …)` callback itself,
// not a single query - Prisma's 5s default was tripping on the multi-step writes
// in this codebase (e.g. bulk imports, cascading deletes) well before anything
// was actually wrong, aborting a transaction that was still making progress.
export const prisma = new PrismaClient({
  transactionOptions: { timeout: 60_000, maxWait: 60_000 },
});

export type Prisma = typeof prisma;

// What a function needs to read and write: the models, but none of the connection
// controls. A `prisma.$transaction(async (tx) => …)` callback receives a client that
// has the models and NOT `$transaction`/`$connect`/`$on`, so anything that must be
// able to run inside a transaction takes `Db` rather than `Prisma`.
//
// This matters more than it looks: a helper typed as `Prisma` cannot accept a tx
// client, so the tempting fix is to pass the global client instead - which compiles,
// runs, and quietly performs its writes OUTSIDE the transaction. That produces code
// that looks atomic and isn't, which is the worst kind of bug because it passes review.
export type Db = Omit<Prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
