import { describe, it, expect } from 'vitest'
import { extractBlockSamples } from './samples'

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
