import { describe, it, expect, beforeAll } from 'vitest';

// Exercises the REAL signer, not a fake.
//
// publish.test.ts injects a stub signer, which is right for testing retry and
// concurrency but means nothing there would notice if the signing itself were
// broken. And a signing bug has the worst possible failure shape: AWS answers 403
// with no indication of which of several things is wrong, it cannot happen until
// real credentials and a real endpoint exist, and by then it looks like an IAM
// problem rather than a code one.
//
// These assertions are about STRUCTURE, since a signature can only be verified by
// AWS. Structure is still worth pinning: the `host` header being present and equal
// to the hostname is the single most common cause of an otherwise inexplicable 403,
// because the signature is then computed over a different canonical request than the
// one AWS reconstructs.

const FAKE = {
  AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
  AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  AWS_SESSION_TOKEN: 'FAKE-SESSION-TOKEN',
};

const HOST = 'abc123.appsync-api.ap-south-1.amazonaws.com';
const BODY = JSON.stringify({ channel: '/notifications/user/u1', events: ['{}'] });

let headers: Record<string, string>;

beforeAll(async () => {
  // Assigned before importing, because createSigner reads credentials from the
  // environment at construction - the same reason it must be called lazily on
  // Lambda rather than at module scope. See signer.ts.
  Object.assign(process.env, FAKE);

  const { createSigner } = await import('./signer.js');
  headers = await createSigner('appsync', 'ap-south-1').sign({
    method: 'POST',
    hostname: HOST,
    path: '/event',
    headers: { 'content-type': 'application/json' },
    body: BODY,
  });
});

describe('SigV4 signing for AppSync EventPublish', () => {
  it('produces an AWS4-HMAC-SHA256 Authorization header', () => {
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it('scopes the credential to the right service and region', () => {
    expect(headers.authorization).toContain(
      `Credential=${FAKE.AWS_ACCESS_KEY_ID}/`,
    );
    expect(headers.authorization).toMatch(/\/ap-south-1\/appsync\/aws4_request/);
  });

  // The classic opaque-403 cause.
  it('signs the host header, matching the hostname exactly', () => {
    expect(headers.host).toBe(HOST);
    expect(headers.authorization).toMatch(/SignedHeaders=[^,]*host/);
  });

  it('includes a signature and a timestamp', () => {
    expect(headers.authorization).toMatch(/Signature=[0-9a-f]{64}/);
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it('forwards the session token, which Lambda credentials always carry', () => {
    expect(headers['x-amz-security-token']).toBe(FAKE.AWS_SESSION_TOKEN);
  });

  it('keeps the caller\'s own headers', () => {
    expect(headers['content-type']).toBe('application/json');
  });

  it('signs the body, so two bodies do not share a signature', async () => {
    const { createSigner } = await import('./signer.js');
    const other = await createSigner('appsync', 'ap-south-1').sign({
      method: 'POST',
      hostname: HOST,
      path: '/event',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: '/notifications/user/SOMEONE-ELSE', events: ['{}'] }),
    });

    const sig = (h: Record<string, string>) => h.authorization.match(/Signature=([0-9a-f]+)/)?.[1];
    expect(sig(other)).not.toBe(sig(headers));
  });
});
