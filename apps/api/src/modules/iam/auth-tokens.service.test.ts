import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { consumeById, issueToken, normalizeEmail, normalizePhone, recentTokenCount, verifyToken } from './auth-tokens.service.js';

// ---- test double --------------------------------------------------------
// An in-memory stand-in for prisma.auth_tokens covering exactly the four calls
// the service makes. Rows are plain objects so assertions can read token_hash and
// prove the plaintext code never lands in storage.

interface Row {
  id: string; email: string | null; phone: string | null; user_id: string | null; kind: string;
  token_hash: string; expires_at: Date; consumed_at: Date | null;
  attempts: number; created_at: Date;
}

function fakePrisma(seed: Partial<Row>[] = []) {
  const rows: Row[] = seed.map((r, i) => ({
    id: `t${i}`, email: 'x@y.z', phone: null, user_id: null, kind: 'otp', token_hash: '',
    expires_at: new Date(Date.now() + 600_000), consumed_at: null, attempts: 0,
    created_at: new Date(), ...r,
  }));
  let seq = seed.length;

  const match = (where: any, r: Row) =>
    (where.id === undefined || r.id === where.id)
    && (where.email === undefined || r.email === where.email)
    && (where.phone === undefined || r.phone === where.phone)
    && (where.kind === undefined || r.kind === where.kind)
    && (where.consumed_at === undefined || (where.consumed_at === null ? r.consumed_at === null : true))
    && (where.expires_at?.gt === undefined || r.expires_at > where.expires_at.gt)
    && (where.created_at?.gte === undefined || r.created_at >= where.created_at.gte);

  return {
    rows,
    auth_tokens: {
      create: async ({ data }: any) => {
        const row: Row = {
          id: `t${seq++}`, consumed_at: null, attempts: 0, created_at: new Date(),
          user_id: null, email: null, phone: null, ...data,
        };
        rows.push(row);
        return row;
      },
      findFirst: async ({ where }: any) => {
        const found = rows.filter((r) => match(where, r));
        found.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
        return found[0] ?? null;
      },
      update: async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id)!;
        if (data.consumed_at !== undefined) row.consumed_at = data.consumed_at;
        if (data.attempts?.increment) row.attempts += data.attempts.increment;
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of rows) if (match(where, r)) { r.consumed_at = data.consumed_at; count += 1; }
        return { count };
      },
      count: async ({ where }: any) => rows.filter((r) => match(where, r)).length,
    },
  } as any;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// ---- tests --------------------------------------------------------------

describe('normalizeEmail', () => {
  it('lower-cases and trims, so one address is one key', () => {
    expect(normalizeEmail('  Akash.Menon@IIMB.ac.in ')).toBe('akash.menon@iimb.ac.in');
  });
});

describe('issueToken', () => {
  it('stores the hash of the code, never the code itself', async () => {
    const prisma = fakePrisma();
    const { code } = await issueToken(prisma, { email: 'a@iimb.ac.in', kind: 'otp' });

    expect(code).toMatch(/^\d{6}$/);
    const stored = prisma.rows[0];
    expect(stored.token_hash).toBe(sha(code));
    expect(JSON.stringify(stored)).not.toContain(code);
  });

  it('kills any live code for the same address, so a resend leaves one valid code', async () => {
    const prisma = fakePrisma();
    const first = await issueToken(prisma, { email: 'a@iimb.ac.in', kind: 'otp' });
    await issueToken(prisma, { email: 'a@iimb.ac.in', kind: 'otp' });

    expect(prisma.rows[0].consumed_at).not.toBeNull();
    const stale = await verifyToken(prisma, { email: 'a@iimb.ac.in', kind: 'otp', code: first.code });
    expect(stale.ok).toBe(false);
  });
});

describe('verifyToken / consumeById', () => {
  it('leaves the code live, so the step that redeems it is still guarded', async () => {
    const prisma = fakePrisma();
    const { code } = await issueToken(prisma, { email: 'a@iimb.ac.in', kind: 'otp' });

    const first = await verifyToken(prisma, { email: 'a@iimb.ac.in', kind: 'otp', code });
    expect(first.ok).toBe(true);
    // Verifying twice is fine - only redeeming burns it.
    expect((await verifyToken(prisma, { email: 'a@iimb.ac.in', kind: 'otp', code })).ok).toBe(true);
  });

  it('is redeemable exactly once, which is what makes a ticket single-use', async () => {
    const prisma = fakePrisma();
    const { code } = await issueToken(prisma, { email: 'a@iimb.ac.in', kind: 'otp' });
    const res = await verifyToken(prisma, { email: 'a@iimb.ac.in', kind: 'otp', code });
    if (!res.ok) throw new Error('expected the code to verify');

    expect(await consumeById(prisma, res.token.id)).toBe(true);
    expect(await consumeById(prisma, res.token.id)).toBe(false);

    // And the burned code is no longer verifiable at all.
    expect(await verifyToken(prisma, { email: 'a@iimb.ac.in', kind: 'otp', code }))
      .toEqual({ ok: false, reason: 'not_found' });
  });

  it('refuses to redeem a token that expired between verifying and redeeming', async () => {
    const prisma = fakePrisma([{
      email: 'a@iimb.ac.in', kind: 'otp', token_hash: sha('123456'),
      expires_at: new Date(Date.now() - 1000),
    }]);
    expect(await consumeById(prisma, prisma.rows[0].id)).toBe(false);
  });

  it('matches the address case-insensitively', async () => {
    const prisma = fakePrisma();
    const { code } = await issueToken(prisma, { email: 'a@iimb.ac.in', kind: 'otp' });
    const res = await verifyToken(prisma, { email: 'A@IIMB.ac.in', kind: 'otp', code });
    expect(res.ok).toBe(true);
  });

  it('reports an expired code as expired and burns it', async () => {
    const prisma = fakePrisma([{
      email: 'a@iimb.ac.in', kind: 'otp', token_hash: sha('123456'),
      expires_at: new Date(Date.now() - 1000),
    }]);
    const res = await verifyToken(prisma, { email: 'a@iimb.ac.in', kind: 'otp', code: '123456' });
    expect(res).toEqual({ ok: false, reason: 'expired' });
    expect(prisma.rows[0].consumed_at).not.toBeNull();
  });

  it('dies after the attempt budget, so a 6-digit code cannot be brute-forced', async () => {
    const prisma = fakePrisma();
    await issueToken(prisma, { email: 'a@iimb.ac.in', kind: 'otp' });

    // Default OTP_MAX_ATTEMPTS is 5: four misses stay recoverable, the fifth kills it.
    for (let i = 0; i < 4; i += 1) {
      const res = await verifyToken(prisma, { email: 'a@iimb.ac.in', kind: 'otp', code: '000000' });
      expect(res).toEqual({ ok: false, reason: 'mismatch' });
    }
    const fifth = await verifyToken(prisma, { email: 'a@iimb.ac.in', kind: 'otp', code: '000000' });
    expect(fifth).toEqual({ ok: false, reason: 'too_many_attempts' });
    expect(prisma.rows[0].consumed_at).not.toBeNull();
  });

  it('reports nothing to consume when no code was ever issued', async () => {
    const prisma = fakePrisma();
    const res = await verifyToken(prisma, { email: 'nobody@iimb.ac.in', kind: 'otp', code: '123456' });
    expect(res).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('recentTokenCount', () => {
  it('counts only codes issued inside the window - this is the real rate limit', async () => {
    const prisma = fakePrisma([
      { email: 'a@iimb.ac.in', kind: 'otp', created_at: new Date(Date.now() - 60 * 60_000) }, // an hour ago
      { email: 'a@iimb.ac.in', kind: 'otp', created_at: new Date() },
    ]);
    expect(await recentTokenCount(prisma, { email: 'a@iimb.ac.in', kind: 'otp', windowMin: 15 })).toBe(1);
  });
});


// ---- phone-keyed tokens (Option B) --------------------------------------
// A phone may belong to several accounts, so a phone OTP proves the NUMBER and
// carries no user_id. Which account it opens is chosen afterwards.

describe('phone-keyed tokens', () => {
  it('normalises a number to its last ten digits, however it is written', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizePhone('9876543210')).toBe('9876543210');
    expect(normalizePhone('091-98765-43210')).toBe('9876543210');
  });

  it('issues against a phone and stores no plaintext code', async () => {
    const p = fakePrisma();
    const { code } = await issueToken(p as any, { phone: '+91 98765 43210', kind: 'otp' });
    expect(code).toMatch(/^\d{6}$/);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].phone).toBe('9876543210');
    expect(p.rows[0].email).toBeNull();
    expect(p.rows[0].token_hash).not.toContain(code);
    expect(p.rows[0].token_hash).toBe(createHash('sha256').update(code).digest('hex'));
  });

  it('carries no user_id - the token belongs to the number, not an account', async () => {
    const p = fakePrisma();
    await issueToken(p as any, { phone: '9876543210', kind: 'otp' });
    expect(p.rows[0].user_id).toBeNull();
  });

  it('verifies a code issued to a differently-formatted spelling of the number', async () => {
    const p = fakePrisma();
    const { code } = await issueToken(p as any, { phone: '+91 98765 43210', kind: 'otp' });
    const res = await verifyToken(p as any, { phone: '9876543210', kind: 'otp', code });
    expect(res.ok).toBe(true);
  });

  it('does not let an email-keyed code verify a phone, or the reverse', async () => {
    const p = fakePrisma();
    const { code } = await issueToken(p as any, { email: 'a@b.c', kind: 'otp' });
    const res = await verifyToken(p as any, { phone: '9876543210', kind: 'otp', code });
    expect(res).toEqual({ ok: false, reason: 'not_found' });
  });

  it('rate-limits per number', async () => {
    const p = fakePrisma();
    await issueToken(p as any, { phone: '9876543210', kind: 'otp' });
    await issueToken(p as any, { phone: '9876543210', kind: 'otp' });
    expect(await recentTokenCount(p as any, { phone: '+91 98765 43210', kind: 'otp', windowMin: 60 })).toBe(2);
    expect(await recentTokenCount(p as any, { phone: '9999999999', kind: 'otp', windowMin: 60 })).toBe(0);
  });
});
