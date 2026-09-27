import { describe, it, expect } from 'vitest'
import { CHROME_COMPONENTS, CSS_TARGETS } from '../css-targets'
import { SAMPLE_PER_BLOCK_MIN, SAMPLE_TOTAL_CHARS, extractBlockSamples } from './samples'

const LONG = 'x'.repeat(300)
const HTML = `<!doctype html><html><head><script>alert(1)</script></head><body>
<header data-component="navbar" class="sticky top-0"><nav><a href="/" onclick="steal()">Home</a></nav></header>
<section data-block="hero" data-variant="statement" style="color:red"><script>bad()</script>
  <h1 class="t-display">We keep <em class="font-accent">books</em> honest</h1><p>${LONG}</p>
  <svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg></section>
<section data-block="hero"><h1>Second hero</h1></section>
<section data-block="cta-banner"><a class="btn" href="/contact">Talk to us</a></section>
</body></html>`

describe('extractBlockSamples', () => {
  const out = extractBlockSamples(HTML)

  it('keeps the first instance of each block / component, labelled', () => {
    expect(out).toContain('[data-block="hero"]')
    expect(out).toContain('[data-block="cta-banner"]')
    expect(out).toContain('[data-component="navbar"]')
    expect(out).not.toContain('Second hero')
  })
  it('strips scripts, event handlers, inline styles and svg internals', () => {
    expect(out).not.toMatch(/<script|alert|bad\(\)|onclick|steal|style=|<path/)
    expect(out).toContain('font-accent')
  })
  it('shortens long text runs', () => {
    expect(out).not.toContain('x'.repeat(100))
  })
  it('respects the per-block and total caps', () => {
    const capped = extractBlockSamples(HTML, { perBlockChars: 60, totalChars: 150 })
    for (const chunk of capped.split('\n\n')) expect(chunk.length).toBeLessThanOrEqual(60 + 40)
    expect(capped.length).toBeLessThanOrEqual(150 + 120)
  })
  it('returns an empty string for a page without blocks', () => {
    expect(extractBlockSamples('<html><body><p>hi</p></body></html>')).toBe('')
  })
})

// WS-B (R2 F2/I1b): the old 1200-per-block / 9000-total page-order cap covered
// 9 of the live bblcpa /design-specimen's 27 targets (measured: 8,606 chars);
// the rebalanced sampler covers all 27 in ~15k chars on that page.
describe('extractBlockSamples — budget across every target', () => {
  const card = (i: number) => `<article class="u-card rounded-lg p-6"><h3 class="t-h4">Card ${i}</h3><p class="text-sm">${'Body copy '.repeat(8)}</p><a class="link" href="/x">More</a></article>`
  const page = `<html><body>${CSS_TARGETS.map((t) => {
    const attr = (CHROME_COMPONENTS as readonly string[]).includes(t) ? `data-component="${t}"` : `data-block="${t}"`
    return `<section ${attr} class="py-16"><div class="container mx-auto grid gap-6 md:grid-cols-3">${[1, 2, 3, 4, 5, 6].map(card).join('')}</div></section>`
  }).join('')}<section data-block="specimen-only"><p>not a target</p></section></body></html>`
  const out = extractBlockSamples(page)

  it('keeps one sample per CSS target, within the total', () => {
    for (const t of CSS_TARGETS) expect(out).toMatch(new RegExp(`^\\[data-(?:block|component)="${t}"\\]$`, 'm'))
    expect(out.length).toBeLessThanOrEqual(SAMPLE_TOTAL_CHARS)
  })
  it('collapses repeated cards to the first + a marker', () => {
    const hero = out.split('\n\n').find((c) => c.startsWith('[data-block="hero"]')) ?? ''
    expect(hero).toContain('Card 1')
    expect(hero).not.toContain('Card 2')
    expect(hero).toContain('…+5 more like this')
  })
  it('drops non-targets before targets when over budget', () => {
    const tight = extractBlockSamples(page, { totalChars: 3000, perBlockChars: 200, minBlockChars: 100 })
    expect(tight).not.toContain('specimen-only')
    expect(tight).toContain('[data-block="hero"]') // the earliest targets stay
  })
  it('gives a short page more detail per block', () => {
    const two = extractBlockSamples(`<html><body><section data-block="hero">${Array.from({ length: 40 }, (_, i) => `<p class="c${i}">word ${i}</p>`).join('')}</section><footer data-component="footer"><p>f</p></footer></body></html>`)
    expect(two.split('\n\n')[0].length).toBeGreaterThan(SAMPLE_PER_BLOCK_MIN)
  })
})
