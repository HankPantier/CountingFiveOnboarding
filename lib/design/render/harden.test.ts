import { describe, it, expect } from 'vitest'
import { hardenForRender, isAllowedRenderRequest, buildRenderCsp, VIEWPORTS, CROP_SELECTORS } from './harden'

const ORIGIN = 'https://bblcpa.vercel.app/'
const CSP = buildRenderCsp(ORIGIN)

describe('hardenForRender', () => {
  const html = `<!doctype html><html><head><title>x</title><script>alert(1)</script></head><body><img loading="lazy" src="/a.jpg"><iframe loading='lazy'></iframe><script src="/b.js"></script></body></html>`
  const out = hardenForRender(html, ORIGIN)

  it('injects the CSP meta as the first thing in <head>', () => {
    expect(out).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${CSP}">`)
  })
  it('strips scripts', () => {
    expect(out).not.toMatch(/<script/i)
  })
  it('makes lazy media eager so screenshots are complete', () => {
    expect(out).not.toMatch(/loading=["']?lazy/i)
    expect(out).toContain('loading="eager"')
  })
  it('CSP blocks scripts, connections, frames and objects', () => {
    for (const d of ["script-src 'none'", "connect-src 'none'", "frame-src 'none'", "object-src 'none'"]) expect(CSP).toContain(d)
  })
})

describe('buildRenderCsp', () => {
  const csp = buildRenderCsp(ORIGIN)

  it('sets default-src to none', () => {
    expect(csp).toContain("default-src 'none'")
  })
  it('scopes img-src/style-src/font-src to the shell origin plus the font hosts', () => {
    expect(csp).toContain('img-src https://bblcpa.vercel.app data:')
    expect(csp).toContain("style-src https://bblcpa.vercel.app https://fonts.googleapis.com 'unsafe-inline'")
    expect(csp).toContain('font-src https://bblcpa.vercel.app https://fonts.gstatic.com data:')
  })
  it('does not allow a different origin', () => {
    expect(csp).not.toContain('evil.test')
    expect(csp).not.toContain('example.invalid')
  })
  it('normalizes to the origin, dropping path/query/hash', () => {
    expect(buildRenderCsp('https://bblcpa.vercel.app/some/path?x=1')).toBe(csp)
  })
  it('throws on an invalid shell origin', () => {
    expect(() => buildRenderCsp('not a url')).toThrow()
  })
})

describe('hardenForRender structural hardening', () => {
  it('does not let an HTML comment divert the CSP away from the real <head>', () => {
    const html = `<html><!-- remember to update <head> block --><head><title>x</title></head><body>hi</body></html>`
    const out = hardenForRender(html, ORIGIN)
    expect(out).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${CSP}">`)
    expect(out).not.toContain('<!--')
  })

  it('does not inject the CSP into a <header> element', () => {
    const html = `<html><header>nav</header><head><title>x</title></head><body>hi</body></html>`
    const out = hardenForRender(html, ORIGIN)
    expect(out).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${CSP}">`)
    expect(out).not.toContain(`<header><meta http-equiv="Content-Security-Policy"`)
  })

  it('injects the CSP into an uppercase <HEAD>', () => {
    const html = `<HTML><HEAD><TITLE>x</TITLE></HEAD><BODY>hi</BODY></HTML>`
    const out = hardenForRender(html, ORIGIN)
    expect(out).toContain(`<HEAD><meta http-equiv="Content-Security-Policy" content="${CSP}">`)
  })

  it('strips inline event-handler attributes', () => {
    const html = `<html><head></head><body onload="alert(1)"><img src="x" onerror="fetch('//evil')"></body></html>`
    const out = hardenForRender(html, ORIGIN)
    expect(out).not.toMatch(/onerror/i)
    expect(out).not.toMatch(/onload/i)
  })

  it('strips the literal unquoted handler from <body onload=alert(1)>', () => {
    const out = hardenForRender(`<html><head></head><body onload=alert(1)>hi</body></html>`, ORIGIN)
    expect(out).toContain('<body>hi</body>')
    expect(out).not.toMatch(/onload/i)
  })

  it('strips slash-separated event handlers', () => {
    for (const html of [
      `<html><head></head><body><img src=x /onerror=alert(1)></body></html>`,
      `<html><head></head><body><img src=x/onerror=alert(1)></body></html>`,
      `<html><head></head><body><svg/onload=alert(1)></body></html>`,
    ]) {
      const out = hardenForRender(html, ORIGIN)
      expect(out).not.toMatch(/onerror/i)
      expect(out).not.toMatch(/onload/i)
    }
  })

  it('does not strip data-onload or other non-handler attributes', () => {
    const out = hardenForRender(`<html><head></head><body><div data-onload="keep" aria-onload="keep">x</div></body></html>`, ORIGIN)
    expect(out).toContain('data-onload="keep"')
    expect(out).toContain('aria-onload="keep"')
  })

  it('drops an unterminated HTML comment (no closing "-->") to end of string', () => {
    const html = `<html><!-- oops <head><title>x</title></head><body>hi</body></html>`
    const out = hardenForRender(html, ORIGIN)
    expect(out).not.toContain('<!--')
    const matches = out.match(/Content-Security-Policy/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('strips meta-refresh redirects in any quoting/case', () => {
    const variants = [
      `<meta http-equiv="refresh" content="0;url=https://evil.test">`,
      `<meta http-equiv='refresh' content='0;url=https://evil.test'>`,
      `<META HTTP-EQUIV="REFRESH" CONTENT="0;url=https://evil.test">`,
    ]
    for (const tag of variants) {
      const out = hardenForRender(`<html><head>${tag}</head><body>x</body></html>`, ORIGIN)
      expect(out.toLowerCase()).not.toContain('refresh')
    }
  })

  it('guarantees exactly one CSP meta when there is no <head> element', () => {
    for (const html of [`<html><body>x</body></html>`, `<p>x</p>`]) {
      const out = hardenForRender(html, ORIGIN)
      const matches = out.match(/Content-Security-Policy/g) ?? []
      expect(matches.length).toBe(1)
    }
  })

  it('injects the CSP exactly once for normal input', () => {
    const html = `<!doctype html><html><head><title>x</title></head><body>hi</body></html>`
    const out = hardenForRender(html, ORIGIN)
    const matches = out.match(/Content-Security-Policy/g) ?? []
    expect(matches.length).toBe(1)
  })
})

describe('isAllowedRenderRequest', () => {
  it.each([
    ['same origin asset', 'https://bblcpa.vercel.app/_next/static/css/app.css', true],
    ['google fonts css', 'https://fonts.googleapis.com/css2?family=Inter', true],
    ['google fonts file', 'https://fonts.gstatic.com/s/inter/v1/x.woff2', true],
    ['data uri', 'data:image/svg+xml,%3Csvg/%3E', true],
    ['other origin', 'https://evil.test/x.png', false],
    ['http downgrade of same host', 'http://bblcpa.vercel.app/x.css', false],
    ['lookalike host', 'https://bblcpa.vercel.app.evil.test/x', false],
    ['fonts over http', 'http://fonts.gstatic.com/x.woff2', false],
    ['blob', 'blob:https://bblcpa.vercel.app/123', false],
    ['garbage', 'not a url', false],
  ])('%s', (_l, url, expected) => {
    expect(isAllowedRenderRequest(url, ORIGIN)).toBe(expected)
  })
})

describe('hardenForRender resource-hint links', () => {
  const run = (head: string) => hardenForRender(`<html><head>${head}</head><body></body></html>`, ORIGIN)

  it.each([
    ['preconnect', '<link rel="preconnect" href="https://cdn.evil.test">'],
    ['dns-prefetch', '<link rel="dns-prefetch" href="//tracker.evil.test">'],
    ['prefetch', "<link rel='prefetch' href='https://evil.test/next.html'>"],
    ['prerender', '<link rel=prerender href=https://evil.test/>'],
    ['preload', '<link href="https://cdn.evil.test/a.woff2" rel="preload" as="font" crossorigin>'],
    ['same-origin preload', '<link rel="preload" href="/_next/static/a.css" as="style">'],
    ['multi-token rel', '<link rel="dns-prefetch preconnect" href="https://evil.test">'],
    ['uppercase', '<LINK REL="PRECONNECT" HREF="https://evil.test">'],
    ['no href', '<link rel="preconnect">'],
    ['google host lookalike', '<link rel="preconnect" href="https://fonts.googleapis.com.evil.test">'],
  ])('strips a foreign %s hint', (_l, tag) => {
    const out = run(tag)
    expect(out).not.toMatch(/<link/i)
  })

  it('keeps Google Fonts preconnect / preload hints', () => {
    const tags =
      '<link rel="preconnect" href="https://fonts.googleapis.com">' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      '<link rel="preload" href="https://fonts.gstatic.com/s/inter.woff2" as="font">'
    const out = run(tags)
    expect(out).toContain('<link rel="preconnect" href="https://fonts.googleapis.com">')
    expect(out).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>')
    expect(out).toContain('<link rel="preload" href="https://fonts.gstatic.com/s/inter.woff2" as="font">')
  })

  it('leaves stylesheet and other non-hint links untouched', () => {
    const tags =
      '<link rel="stylesheet" href="/_next/static/css/app.css">' +
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">' +
      '<link rel="icon" href="/favicon.ico">' +
      '<link rel="canonical" href="https://bblcpa.vercel.app/">'
    const out = run(tags)
    for (const t of tags.split(/(?=<link)/)) expect(out).toContain(t)
  })
})

describe('render constants', () => {
  it('uses the spec viewports', () => {
    expect(VIEWPORTS.desktop).toEqual({ width: 1440, height: 900, deviceScaleFactor: 1 })
    expect(VIEWPORTS.mobile).toEqual({ width: 390, height: 844, deviceScaleFactor: 2 })
  })
  it('crops blocks in priority order and never the hero (it is in the fold shot)', () => {
    expect(CROP_SELECTORS[0]).toContain('feature-grid')
    expect(CROP_SELECTORS.join(' ')).not.toContain('"hero"')
  })
})
