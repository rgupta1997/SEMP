/* Playwright page + click audit.
   Pass 1: load every route, scroll it so lazy images decode, record console /
           page errors, headings, text volume, broken images, duplicate ids.
   Pass 2: click EVERY link on every route and assert where it actually lands —
           in-page anchors must move the scroll, route links must render a real
           page, external links must carry target=_blank. */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const BASE = (process.env.URL || 'http://localhost:5174').replace(/\/$/, '')
const ROUTES = [
  '/', '/features', '/live-scoring', '/reports', '/solutions',
  '/schools', '/colleges', '/corporate', '/tournament-organizers',
  '/players', '/pricing', '/demo', '/contact',
]

const settle = async (page) => {
  await page.evaluate(async () => {
    const step = window.innerHeight
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80))
    }
    window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 200))
  })
  await page.waitForTimeout(400)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const report = []
const issues = []

/* ---- pass 1: does each page render something meaningful? --------------- */
for (const route of ROUTES) {
  const page = await ctx.newPage()
  const errs = []
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 240)))
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message.slice(0, 240)))
  await page.goto(BASE + route, { waitUntil: 'networkidle' })
  await settle(page)

  const info = await page.evaluate(() => {
    const main = document.querySelector('#main')
    const txt = (main?.innerText || '').trim()
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
    return {
      h1: [...main.querySelectorAll('h1')].map((h) => h.innerText.trim()),
      h2: [...main.querySelectorAll('h2')].map((h) => h.innerText.trim()),
      chars: txt.length,
      sections: main.querySelectorAll('section').length,
      srcs: [...new Set([...document.images].map((i) => i.getAttribute('src')))],
      dupIds: ids.filter((x, i) => ids.indexOf(x) !== i),
      links: [...main.querySelectorAll('a[href]')].map((a) => ({
        text: (a.innerText || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 48),
        href: a.getAttribute('href'),
        blank: a.getAttribute('target') === '_blank',
      })),
      ids,
    }
  })
  const formControls = await page.locator('#main input, #main select, #main textarea').count()
  if (info.chars < 700 && formControls < 4) issues.push(`${route}: THIN — only ${info.chars} chars of copy`)
  if (!info.h1.length) issues.push(`${route}: no <h1>`)
  /* ASK THE SERVER, don't read naturalWidth. Every shot here is loading="lazy"
     inside a FormatDeck panel or a ProductJourney stage, so whether it has
     decoded yet depends on scroll timing and tells you nothing about whether
     the file exists — the first version of this check reported seventeen
     "broken" images that all serve 200. A request per unique src does not. */
  info.broken = []
  for (const src of info.srcs) {
    if (!src || /^(data|https?):/.test(src)) continue
    const res = await page.request.get(BASE + src).catch(() => null)
    if (!res || !res.ok()) info.broken.push(`${src} (${res ? res.status() : 'no response'})`)
  }
  if (info.broken.length) issues.push(`${route}: broken images ${info.broken.join(', ')}`)
  if (info.dupIds.length) issues.push(`${route}: duplicate ids ${[...new Set(info.dupIds)].join(', ')}`)
  if (errs.length) issues.push(`${route}: console — ${[...new Set(errs)].join(' // ')}`)
  report.push({ route, ...info, errs })
  await page.close()
}

/* ---- pass 2: click everything ----------------------------------------- */
const clicks = []
for (const r of report) {
  const seen = new Set()
  for (const l of r.links) {
    if (seen.has(l.href + l.text)) continue
    seen.add(l.href + l.text)
    const external = /^(https?:|mailto:|tel:)/.test(l.href)
    if (external && !l.href.startsWith('http://localhost')) {
      clicks.push({ from: r.route, ...l, verdict: l.blank || /^(mailto|tel):/.test(l.href) ? 'ok (external)' : 'NO target=_blank' })
      if (!l.blank && !/^(mailto|tel):/.test(l.href)) issues.push(`${r.route}: "${l.text}" -> ${l.href} opens in the same tab`)
      continue
    }
    if (l.href.startsWith('http://localhost:5173')) {
      clicks.push({ from: r.route, ...l, verdict: 'ok (app link)' }); continue
    }

    const page = await ctx.newPage()
    await page.goto(BASE + r.route, { waitUntil: 'networkidle' })
    await settle(page)
    const before = await page.evaluate(() => ({ y: window.scrollY, url: location.pathname + location.hash }))
    const el = page.locator(`#main a[href="${l.href}"]`).filter({ hasText: l.text.split(' ')[0] }).first()
    let verdict = ''
    try {
      await el.scrollIntoViewIfNeeded({ timeout: 3000 })

      /* A LINK INSIDE A CAROUSEL CARD NEEDS THE CARD CENTRED FIRST.
         Only the centred card is hit-testable — the others are rotated in 3D
         and a pointer over them lands on .cf-track — and on a four-card ring
         one card is always painted at opacity 0 and parked outside the frame
         entirely. Clicking such a card's box tests nothing a user would do.
         The user's route is the pagination dot, so take it: centre the card,
         then click it. If this step is what makes the link work, the link is
         fine; if it still fails afterwards, the card is genuinely unreachable. */
      const centred = await page.evaluate((href) => {
        const a = document.querySelector(`#main a[href="${href}"]`)
        const card = a?.closest('.cf-card')
        if (!card) return false
        const cards = [...card.parentElement.children]
        const dots = card.closest('.cf')?.querySelectorAll('.cf-dots button')
          ?? card.closest('[aria-roledescription="carousel"]')?.querySelectorAll('.cf-dots button')
        const i = cards.indexOf(card)
        if (!dots || !dots[i]) return false
        dots[i].click()
        return true
      }, l.href)
      if (centred) await page.waitForTimeout(1200)

      await el.click({ timeout: 4000 })
      await page.waitForTimeout(1100)
      const after = await page.evaluate(() => {
        const main = document.querySelector('#main')
        return {
          y: window.scrollY,
          url: location.pathname + location.hash,
          h1: main.querySelector('h1')?.innerText.trim() || '(no h1)',
          chars: (main.innerText || '').trim().length,
        }
      })
      const hashOnly = l.href.startsWith('#') || l.href.startsWith(r.route + '#')
      if (after.url === before.url && after.y === before.y) {
        verdict = 'DEAD — nothing happened'
        issues.push(`${r.route}: click "${l.text}" -> ${l.href} did nothing`)
      } else if (hashOnly) {
        verdict = `scrolled ${before.y} -> ${after.y}`
      } else if (after.chars < 700 && !(await page.locator('#main input, #main select, #main textarea').count())) {
        verdict = `LANDED THIN (${after.chars} chars) "${after.h1}"`
        issues.push(`${r.route}: click "${l.text}" -> ${after.url} is thin (${after.chars} chars)`)
      } else {
        verdict = `-> ${after.url} "${after.h1}" (${after.chars} chars)`
      }
      if (l.href.includes('#') && !l.href.startsWith('#')) {
        const hash = '#' + l.href.split('#')[1]
        if (!after.url.endsWith(hash)) { verdict += ' | HASH LOST'; issues.push(`${r.route}: ${l.href} lost its hash`) }
        else if (after.y < 100) { verdict += ' | DID NOT SCROLL'; issues.push(`${r.route}: ${l.href} did not scroll to the anchor`) }
      }
    } catch (e) {
      verdict = 'CLICK FAILED: ' + e.message.split('\n')[0].slice(0, 100)
      issues.push(`${r.route}: could not click "${l.text}" (${l.href})`)
    }
    clicks.push({ from: r.route, ...l, verdict })
    await page.close()
  }
}

writeFileSync('.audit.json', JSON.stringify({ report, clicks, issues }, null, 2))

for (const r of report) {
  console.log(`\n=== ${r.route}  [${r.chars} chars · ${r.sections} sections · ${r.links.length} links]`)
  console.log(`    h1: ${r.h1.join(' / ')}`)
  console.log(`    h2: ${r.h2.join(' | ') || '(none)'}`)
}
console.log('\n\n########## CLICKS ##########')
let last = ''
for (const c of clicks) {
  if (c.from !== last) { console.log(`\n--- from ${c.from}`); last = c.from }
  console.log(`   "${c.text}" [${c.href}]\n      ${c.verdict}`)
}
console.log('\n\n########## ISSUES ##########')
console.log(issues.length ? issues.map((i) => ' ! ' + i).join('\n') : ' none')
await browser.close()
