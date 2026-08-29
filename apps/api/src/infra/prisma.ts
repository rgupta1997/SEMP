import { PrismaClient } from '@prisma/client';

// Single PrismaClient, created here and shared with every persistence adapter
// via the composition root. The domain/application layers never import this.
// Interactive transactions default to a 5s ceiling - measured against this
// project's remote database, a plain warm query already takes up to ~1s, so a
// heavier one (the scorecard lock's transaction touches standings, brackets,
// lifetime entries and achievements in sequence) has little headroom left.
// main.ts now warms the connection at boot so a transaction is never the
// first thing to pay that cost, but this raises the ceiling too, as a second
// line of defence against a genuinely slow moment rather than a cold one.
// Measured directly against this project's database: recomputeStandings alone
// makes 14 round trips and takes ~14s on this connection's latency, for a
// championship of just 3 fixtures - the lock transaction has several more
// steps after it (participants, lifetime entries, achievements) paying the
// same per-round-trip cost. 15s wasn't enough headroom; this is a stopgap so
// locking is usable today. The real fix is fewer round trips per step (or a
// lower-latency connection to the database), not a bigger number here -
// tracked as follow-up work, not solved by raising this further indefinitely.
export const prisma = new PrismaClient({
  transactionOptions: { timeout: 60000 },
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
