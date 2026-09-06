import { PrismaClient } from '@prisma/client';

// Single PrismaClient, created here and shared with every persistence adapter
// via the composition root. The domain/application layers never import this.
//
// Prisma's interactive-transaction defaults (2s to acquire a slot, 5s to run) are
// tuned for simple CRUD; a few of ours (standings recompute, multi-stage fixture
// generation) legitimately do more work than that inside one atomic transaction.
// Raised to 60s so those fail on an actual problem, not on the clock.
export const prisma = new PrismaClient({
  transactionOptions: { maxWait: 60_000, timeout: 60_000 },
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
