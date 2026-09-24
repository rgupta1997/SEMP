import { PrismaClient } from '@prisma/client';

// Single PrismaClient, created here and shared with every persistence adapter
// via the composition root. The domain/application layers never import this.
//
// `transactionOptions.timeout` raised from Prisma's 5000ms default - a full
// standings recompute (every draw, every fixture, every ranking event in a
// championship) is several sequential round trips wrapped in one interactive
// transaction, and a championship with enough data in it will legitimately run
// past 5s. Hitting the old limit didn't fail loudly: it killed the transaction
// mid-read and every query after it failed with "transaction already closed",
// silently, since the caller only logs the error rather than surfacing it.
export const prisma = new PrismaClient({
  transactionOptions: { timeout: 120000 },
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
