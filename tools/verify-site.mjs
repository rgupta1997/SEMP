#!/usr/bin/env node
/**
 * Verify the assembled site, in a real browser, before it is deployed.
 *
 *   npm run build:site && node tools/verify-site.mjs
 *
 * Serves dist/ the way Netlify does - honouring dist/_redirects, including the
 * rule that an actual file on disk always beats a non-forced redirect - and then
 * loads the URLs that matter, checking WHICH BUNDLE BOOTED rather than trusting
 * the status code.
 *
 * This exists because moving the app off the domain root to /app is the kind of
 * change that looks fine and breaks a printed QR code. The /verify, /c and /p
 * cases below are the ones handed to people with no account and no way to guess
 * a replacement URL; /verify is printed on issued certificates and cannot be
 * reissued. They are checked on every run for that reason.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT || 8099);

if (!existsSync(join(DIST, '_redirects'))) {
  console.error([
    '',
    '  x no dist/_redirects - run `npm run build:site` first',
    '',
  ].join('\n'));
  process.exit(1);
}

const rules = readFileSync(join(DIST, '_redirects'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [from, to, status] = l.split(/\s+/);
    return { from, to, status: Number(status) };
  });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.svg': 'image/svg+xml' };

function fileFor(p) {
  const f = join(DIST, decodeURIComponent(p));
  if (existsSync(f) && statSync(f).isFile()) return f;
  return null;
}

function match(path) {
  for (const r of rules) {
    if (r.from.endsWith('/*')) {
      const base = r.from.slice(0, -2);
      if (path === base || path.startsWith(base + '/')) {
        const splat = path.slice(base.length + 1);
        return { ...r, target: r.to.replace(':splat', splat) };
      }
    } else if (r.from === path) {
      return { ...r, target: r.to };
    }
  }
  return null;
}

const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  // Netlify: a real file wins over any non-forced rule.
  const direct = fileFor(path);
  if (direct) {
    res.writeHead(200, { 'Content-Type': MIME[extname(direct)] || 'application/octet-stream' });
    return res.end(readFileSync(direct));
  }
  const m = match(path);
  if (!m) { res.writeHead(404); return res.end('no rule'); }
  if (m.status === 301) { res.writeHead(301, { Location: m.target }); return res.end(); }
  const f = fileFor(m.target);
  if (!f) { res.writeHead(500); return res.end(`rewrite target missing: ${m.target}`); }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'text/html' });
  res.end(readFileSync(f));
});

await new Promise((r) => server.listen(PORT, r));
const BASE = `http://localhost:${PORT}`;

const CHECKS = [
  // [ url, what must be true ]
  ['/',                       'landing'],
  ['/pricing',                'landing'],
  ['/demo',                   'landing'],
  ['/app/login',              'app'],
  ['/app/verify/ABC123',      'app'],
  ['/organizations/x/teams',  'app'],   // legacy -> 301 -> app
  ['/verify/ABC123',          'app'],   // PRINTED QR CODE
  ['/c/sometoken',            'app'],
  ['/p/somebody',             'app'],
  ['/login',                  'app'],
  ['/not-a-real-page',        'landing'], // marketing 404, client-side
];

const browser = await chromium.launch();
let bad = 0;
for (const [url, expect] of CHECKS) {
  const page = await browser.newPage();
  const errs = [];
  // Only errors that mean the PAGE is broken. A failed call to the API is not
  // one: /verify, /c and /p all fetch on mount, and this harness serves static
  // files with no API behind it, so a refused connection is the expected state
  // here and says nothing about whether the routing works. Filtering it is what
  // lets these four - the URLs that matter most - be checked at all.
  const isApiReachability = (t) =>
    /ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|Failed to fetch|NetworkError/i.test(t);
  page.on('console', (m) => { if (m.type() === 'error' && !isApiReachability(m.text())) errs.push(m.text()); });
  page.on('pageerror', (e) => { if (!isApiReachability(String(e))) errs.push(String(e)); });
  const resp = await page.goto(BASE + url, { waitUntil: 'networkidle' });
  const finalUrl = page.url().replace(BASE, '');
  // Which bundle actually booted? The app renders #root; the landing renders its
  // own nav. Ask the DOM rather than trusting the URL.
  const which = await page.evaluate(() => {
    const hasRoot = !!document.querySelector('#root');
    const t = document.title;
    return { hasRoot, title: t, bodyLen: document.body.innerText.trim().length };
  });
  const isApp = which.title.includes('SEMP');
  const got = isApp ? 'app' : 'landing';
  const ok = got === expect && resp.status() < 400 && which.bodyLen > 0 && errs.length === 0;
  if (!ok) bad++;
  console.log(
    `${ok ? ' ok ' : 'FAIL'}  ${url.padEnd(24)} -> ${finalUrl.padEnd(30)} ${got.padEnd(8)} ` +
    `[${resp.status()}] text=${which.bodyLen}${errs.length ? ' ERRORS: ' + errs.slice(0, 2).join(' | ') : ''}`
  );
  await page.close();
}
await browser.close();
server.close();
console.log(bad === 0 ? '\nall routes pass\n' : `\n${bad} FAILED\n`);
process.exit(bad === 0 ? 0 : 1);
