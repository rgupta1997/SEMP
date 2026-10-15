import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/env.js', () => ({ env: { MAX_ACCOUNTS_PER_PHONE: 3 } }));

const { accountsForSubject } = await import('./accounts.service.js');

// A placeholder phone (5000000000..5000099999) is what a login is provisioned with
// when the sheet had no number. The sequence is guessable, so it must never resolve
// to an account - not even reach the database.
describe('accountsForSubject and placeholder phones', () => {
  const untouchable = new Proxy({}, {
    get: () => { throw new Error('the database must not be queried for a placeholder phone'); },
  });

  it('opens no account for a placeholder number, however it is written', async () => {
    expect(await accountsForSubject(untouchable as never, { phone: '5000000017' })).toEqual([]);
    expect(await accountsForSubject(untouchable as never, { phone: '+91 50000 00017' })).toEqual([]);
  });

  it('still looks a real number up - so a replaced phone signs in', async () => {
    const queried: unknown[] = [];
    const prisma = {
      $queryRawUnsafe: async (_sql: string, last10: string) => { queried.push(last10); return []; },
    };

    await accountsForSubject(prisma as never, { phone: '+91 98765 43210' });

    expect(queried).toEqual(['9876543210']);
  });
});
