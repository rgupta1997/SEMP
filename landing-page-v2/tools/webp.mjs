/**
 * PNG -> WebP, using the Chromium that Playwright already ships.
 *
 *   node tools/webp.mjs <src-dir-or-file>... --out public/shots [--quality 0.82] [--width 1440]
 *
 * WHY A BROWSER AND NOT SHARP. The journey section carries a dozen product
 * screenshots; as PNG that is ~2.4MB before anything else on the page loads.
 * WebP at 0.82 takes the same set under 500KB with no visible difference on
 * flat UI. `sharp` would be the obvious tool, but it is a native dependency
 * this standalone site does not otherwise need — and the repo already installs
 * a Chromium for the two screenshot harnesses, which encodes WebP itself.
 *
 * Screenshots are captured at 1440x900 DPR1 and rendered at most ~1140px wide,
 * so they are downscaled here rather than shipping pixels nobody sees.
 */
import { chromium } from 'playwright'
import { readdirSync, statSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const OUT = flag('out', 'public/shots')
const QUALITY = Number(flag('quality', 0.82))
const WIDTH = Number(flag('width', 1440))
const inputs = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))

const pngs = inputs.flatMap((p) => (statSync(p).isDirectory()
  ? readdirSync(p).filter((f) => f.endsWith('.png')).map((f) => path.join(p, f))
  : [p]))
if (!pngs.length) { console.error('nothing to convert'); process.exit(1) }

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('about:blank')

for (const src of pngs) {
  const b64 = readFileSync(src).toString('base64')
  const out = path.join(OUT, path.basename(src).replace(/\.png$/, '.webp'))
  // Encoded in the page: canvas.toDataURL is the only WebP encoder here.
  const data = await page.evaluate(async ([dataUrl, width, quality]) => {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const scale = Math.min(1, width / img.naturalWidth)
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * scale)
    c.height = Math.round(img.naturalHeight * scale)
    const ctx = c.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, c.width, c.height)
    return { url: c.toDataURL('image/webp', quality), w: c.width, h: c.height }
  }, [`data:image/png;base64,${b64}`, WIDTH, QUALITY])
  const bytes = Buffer.from(data.url.split(',')[1], 'base64')
  writeFileSync(out, bytes)
  const was = statSync(src).size
  console.log(`${path.basename(out)}  ${data.w}x${data.h}  ${(was / 1024).toFixed(0)}KB -> ${(bytes.length / 1024).toFixed(0)}KB`)
}

await browser.close()
