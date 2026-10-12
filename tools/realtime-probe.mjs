/**
 * End-to-end probe for the AppSync Events notification transport.
 *
 * Signs in against the API, mints a realtime token through the real endpoint, and
 * subscribes over a real WebSocket - so it exercises the same hops a browser does
 * (mint -> authorizer -> subscribe -> publish -> ping) with no browser to babysit.
 *
 * Modes:
 *   --negative   run the hostile-channel table (L4). Every row must be REFUSED.
 *   --wait <ms>  stay subscribed this long before reporting (L6 long-tab).
 *
 * Appends one JSONL row per case to evidence/results.jsonl so the test report is
 * generated rather than transcribed.
 */
import { Amplify } from 'aws-amplify';
import { events } from 'aws-amplify/data';
import { appendFileSync, mkdirSync } from 'node:fs';

const API = process.env.API ?? 'https://o30gqya1sg.execute-api.ap-south-1.amazonaws.com';
const EMAIL = process.env.PROBE_EMAIL;
const PASSWORD = process.env.PROBE_PASSWORD;
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };

function record(caseId, status, detail) {
  mkdirSync(OUT, { recursive: true });
  appendFileSync(`${OUT}/results.jsonl`,
    JSON.stringify({ caseId, status, at: new Date().toISOString(), detail }) + '\n');
  const mark = status === 'PASS' ? 'PASS' : status === 'FAIL' ? 'FAIL' : status;
  console.log(`  [${mark}] ${caseId}  ${detail ?? ''}`);
}

async function login() {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
  const d = await r.json();
  return { jwt: d.token, userId: d.user.id };
}

async function mint(jwt) {
  const r = await fetch(`${API}/api/notifications/realtime-token`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) throw new Error(`mint ${r.status}`);
  return r.json();
}

/** Resolves true if AppSync ACKed the subscribe, false if it refused. */
async function trySubscribe(grant, channel, token, onMessage) {
  Amplify.configure({
    API: { Events: { endpoint: grant.endpoint, region: grant.region, defaultAuthMode: 'lambda' } },
  });
  let ch;
  try {
    ch = await events.connect(channel, { authMode: 'lambda', authToken: token });
    const sub = ch.subscribe({ next: () => onMessage?.(), error: () => {} });
    await Promise.race([
      sub.ready,
      new Promise((_r, rej) => setTimeout(() => rej(new Error('ACK timeout')), 10_000)),
    ]);
    return { ok: true, channel: ch };
  } catch (err) {
    try { ch?.close(); } catch {}
    return { ok: false, err: String(err?.message ?? err) };
  }
}

const { jwt, userId } = await login();
const grant = await mint(jwt);
console.log(`signed in as ${EMAIL} (${userId})`);
console.log(`endpoint ${grant.endpoint}`);
console.log(`channel  ${grant.channel}\n`);

if (has('--negative')) {
  const OTHER = '00000000-0000-4000-8000-000000000001';
  const table = [
    ['L4.self',      grant.channel,                              true ],
    ['L4.other',     `/notifications/user/${OTHER}`,             false],
    ['L4.wildcard',  '/notifications/*',                         false],
    ['L4.wildcard2', '/notifications/user/*',                    false],
    ['L4.traversal', `/notifications/user/${userId}/../${OTHER}`, false],
    ['L4.nsroot',    '/notifications',                           false],
    // AppSync NORMALISES a trailing slash before the authorizer is invoked, so this
    // arrives as the canonical path and is correctly allowed for one's OWN channel.
    // Verified 2026-09-26: the same trick on another user's channel is refused, and
    // the authorizer log shows the slash already stripped. Expect ALLOWED.
    ['L4.trailing',  `${grant.channel}/`,                        true ],
    ['L4.otherTrail', `/notifications/user/${OTHER}/`,           false],
    ['L4.case',      grant.channel.toUpperCase(),                false],
  ];
  console.log('L4 hostile-channel table (every non-self row must be REFUSED):');
  let failures = 0;
  for (const [id, channel, shouldAllow] of table) {
    const r = await trySubscribe(grant, channel, grant.token);
    const allowed = r.ok;
    try { r.channel?.close(); } catch {}
    const pass = allowed === shouldAllow;
    if (!pass) failures++;
    record(id, pass ? 'PASS' : 'FAIL',
      `${channel} -> ${allowed ? 'ALLOWED' : 'refused'} (expected ${shouldAllow ? 'ALLOWED' : 'refused'})`);
  }

  // Wrong-credential rows, all against the user's OWN channel so only the token varies.
  const creds = [
    ['L4.session', jwt,                                  'API session token'],
    ['L4.garbage', 'not.a.token',                        'malformed token'],
    ['L4.none',    '',                                   'empty token'],
  ];
  for (const [id, token, what] of creds) {
    const r = await trySubscribe(grant, grant.channel, token);
    const allowed = r.ok;
    try { r.channel?.close(); } catch {}
    if (allowed) failures++;
    record(id, allowed ? 'FAIL' : 'PASS', `${what} -> ${allowed ? 'ALLOWED' : 'refused'}`);
  }

  console.log(`\n${failures === 0 ? 'L4 PASS - every hostile case refused' : `L4 FAIL - ${failures} case(s) wrong`}`);
  process.exit(failures === 0 ? 0 : 1);
}

// Happy path, optionally held open to prove the token-refresh cycle (L6.1).
let pings = 0;
const r = await trySubscribe(grant, grant.channel, grant.token, () => {
  pings++;
  console.log(`  ping #${pings} at ${new Date().toISOString()}`);
});
if (!r.ok) { record('probe.subscribe', 'FAIL', r.err); process.exit(1); }
record('probe.subscribe', 'PASS', `subscribed to ${grant.channel}`);

const waitMs = Number(val('--wait', '0'));
if (waitMs > 0) {
  console.log(`holding subscription open for ${Math.round(waitMs / 1000)}s...`);
  await new Promise((res) => setTimeout(res, waitMs));
  record('probe.held', pings > 0 ? 'PASS' : 'INFO', `${pings} ping(s) received over ${Math.round(waitMs / 1000)}s`);
}
try { r.channel.close(); } catch {}
process.exit(0);
