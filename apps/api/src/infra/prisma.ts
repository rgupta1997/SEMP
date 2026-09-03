import { PrismaClient } from '@prisma/client';

// Single PrismaClient, created here and shared with every persistence adapter
// via the composition root. The domain/application layers never import this.
//
// `transactionOptions` raises the default interactive-transaction budget from
// Prisma's 5s (`timeout`) / 2s (`maxWait`) to 60s each. A handler whose
// `prisma.$transaction(async (tx) => …)` body genuinely takes longer than 5s
// (a heavier bulk import, several dependent writes) was hitting Prisma's own
// "Transaction already closed" error and surfacing as a raw 500, not a
// business-rule rejection - this is a client-wide default, not a per-call fix,
// so every transaction gets the same headroom. An individual call can still
// pass its own `{ timeout, maxWait }` to `$transaction` to override it.
export const prisma = new PrismaClient({
  transactionOptions: { maxWait: 60000, timeout: 60000 },
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
