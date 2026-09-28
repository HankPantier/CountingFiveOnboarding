// Style-coverage audit: every visible "box" (border, radius, shadow or own
// background) on a deployed client site must sit inside a [data-block] /
// [data-component] the Design Studio chat may target (OVERRIDE_BLOCKS /
// CHROME_COMPONENTS). Run after a template release that adds a surface:
//   node scripts/audit-style-coverage.mjs https://<site>.vercel.app / /contact /resources /nope-404
// Prints each unreachable element (grouped, with the pages it appears on) and
// TOTAL; TOTAL 0 = the chat can restyle everything on those pages. Uses the
// local Chrome (CHROME_PATH to override) via playwright-core.
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
const ids = (file, marker, end) => {
  const t = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const from = t.slice(t.indexOf(marker))
  return [...from.slice(0, from.indexOf(end)).matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
}
const blocks = ids('lib/editor/theme-edit.ts', 'export const OVERRIDE_BLOCKS', '] as const')
const chrome = ids('lib/design/css-targets.ts', 'export const CHROME_COMPONENTS', '] as const')
const [base, ...paths] = process.argv.slice(2)
if (!base || paths.length === 0) {
  console.error('usage: node scripts/audit-style-coverage.mjs <site-url> <path> [path…]')
  process.exit(1)
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const out = {}
for (const width of [1440, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  for (const p of paths) {
    try {
      await page.goto(base + p, { waitUntil: 'networkidle', timeout: 45000 })
    } catch (e) { console.error('load fail', p, e.message); continue }
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)) } })
    const found = await page.evaluate(({ blocks, chrome }) => {
      const res = []
      const transparent = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent'
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.width < 24 || r.height < 16) continue
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue
        const radius = parseFloat(cs.borderTopLeftRadius) > 0
        const border = ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none')
        const shadow = cs.boxShadow !== 'none'
        const bg = !transparent(cs.backgroundColor) && el.parentElement && getComputedStyle(el.parentElement).backgroundColor !== cs.backgroundColor
        if (!(radius || border || shadow || bg)) continue
        const blk = el.closest('[data-block]')
        const cmp = el.closest('[data-component]')
        let why = null
        if (!blk && !cmp) why = 'no-scope'
        else if (blk && !blocks.includes(blk.dataset.block) && !(cmp && chrome.includes(cmp.dataset.component))) {
          // nested data-block (client-center-tile) is fine when an ancestor is targetable
          let a = blk, ok = false
          while (a) { if (blocks.includes(a.dataset.block)) { ok = true; break } a = a.parentElement?.closest('[data-block]') }
          if (!ok) why = 'untargetable-block:' + blk.dataset.block
        } else if (!blk && cmp && !chrome.includes(cmp.dataset.component)) why = 'untargetable-component:' + cmp.dataset.component
        if (!why) continue
        const land = el.closest('main,header,footer,nav,aside,article,dialog')
        const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).slice(0, 8).join('.')
        const txt = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50)
        res.push({ why, tag: el.tagName.toLowerCase(), cls, attrs: [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `${a.name}=${a.value}`).join(' '), land: land ? land.tagName.toLowerCase() : 'body', props: [radius && 'radius', border && 'border', shadow && 'shadow', bg && 'bg'].filter(Boolean).join(','), txt })
      }
      return res
    }, { blocks, chrome })
    for (const f of found) {
      const key = `${f.why} | <${f.tag}> ${f.attrs} .${f.cls} [${f.props}] in ${f.land}`
      out[key] ??= { pages: new Set(), sample: f.txt }
      out[key].pages.add(`${p}@${width}`)
    }
  }
  await page.close()
}
await browser.close()
for (const [k, v] of Object.entries(out)) console.log(`${k}\n    pages(${v.pages.size}): ${[...v.pages].slice(0, 4).join(' ')}  text: "${v.sample}"`)
console.log('TOTAL', Object.keys(out).length)
