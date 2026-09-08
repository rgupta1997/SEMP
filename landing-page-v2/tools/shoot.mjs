import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = (process.env.URL || 'http://localhost:5174').replace(/\/$/, '')
const OUT = process.env.OUT || '.shots'

const ROUTES = process.env.ROUTES ? process.env.ROUTES.split(',') : [
  '/', '/features', '/live-scoring', '/reports', '/solutions',
  '/schools', '/colleges', '/corporate', '/tournament-organizers',
  '/players', '/pricing', '/demo', '/contact',
]
const VIEWPORTS = [
  ['desktop', { width: 1440, height: 1000 }, 'light'],
  ['dark', { width: 1440, height: 1000 }, 'dark'],
  ['phone', { width: 390, height: 844 }, 'light'],
]

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
let problems = 0

for (const [vp, viewport, colorScheme] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport, colorScheme, deviceScaleFactor: 1 })
  mkdirSync(`${OUT}/${vp}`, { recursive: true })
  for (const route of ROUTES) {
    const page = await ctx.newPage()
    const errs = []
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
    page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message))
    await page.goto(BASE + route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    // Walk the page so lazy images actually enter the viewport, let them settle,
    // then capture. Screenshotting first captured empty frames for every shot
    // below the fold and made the harness report a page that looked broken.
    await page.evaluate(async () => {
      const step = window.innerHeight
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 90))
      }
      window.scrollTo(0, 0)
    })
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    const is404 = await page.evaluate(() => document.body.innerText.includes('That page does not exist'))
    // Any image that failed to load - a broken product screenshot would gut the page.
    // Bounded: a lazy image that never enters the viewport fires neither load
    // nor error, so an unbounded wait here hangs the run forever.
    await page.evaluate(() => Promise.all(
      [...document.images].filter((i) => !i.complete).map((i) => Promise.race([
        new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }) }),
        new Promise((r) => setTimeout(r, 2500)),
      ]))))
    const name = route === '/' ? 'home' : route.slice(1).replace(/\//g, '-')
    // A position:sticky header re-paints into every band of a fullPage stitch,
    // so the nav appears half-way down the image on top of real content. Pin it
    // static for the capture so the screenshot shows the page, not the artifact.
    await page.addStyleTag({ content: '.nav{position:static !important}' })
    await page.screenshot({ path: `${OUT}/${vp}/${name}.png`, fullPage: true })
    // Only images the browser actually decided to fetch count as broken; a lazy
    // image still parked below the fold is doing its job, not failing.
    const badImgs = await page.evaluate(() =>
      [...document.images].filter((i) => i.currentSrc && (!i.complete || i.naturalWidth === 0)).map((i) => i.currentSrc))
    const bad = errs.length || overflow > 0 || is404 || badImgs.length
    if (bad) problems++
    if (bad || process.env.VERBOSE) {
      console.log(`${bad ? 'FAIL' : 'ok  '} ${vp}${route}`
        + (overflow > 0 ? ` overflowX=${overflow}px` : '')
        + (is404 ? ' RENDERED-404' : '')
        + (badImgs.length ? ` brokenImages=${badImgs.length} ${badImgs[0]}` : '')
        + (errs.length ? ` errors=${errs.length} ${errs.slice(0, 2).join(' | ')}` : ''))
    }
    await page.close()
  }
  await ctx.close()
}
await browser.close()
console.log(problems
  ? `\n${problems} problem(s) across ${ROUTES.length} routes x ${VIEWPORTS.length} viewports`
  : `\nall clean: ${ROUTES.length} routes x ${VIEWPORTS.length} viewports - no console errors, no overflow, no broken images, no stray 404s`)
