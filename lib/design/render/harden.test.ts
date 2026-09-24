import { describe, it, expect } from 'vitest'
import { hardenForRender, isAllowedRenderRequest, RENDER_CSP, VIEWPORTS, CROP_SELECTORS } from './harden'

const ORIGIN = 'https://bblcpa.vercel.app/'

describe('hardenForRender', () => {
  const html = `<!doctype html><html><head><title>x</title><script>alert(1)</script></head><body><img loading="lazy" src="/a.jpg"><iframe loading='lazy'></iframe><script src="/b.js"></script></body></html>`
  const out = hardenForRender(html)

  it('injects the CSP meta as the first thing in <head>', () => {
    expect(out).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}">`)
  })
  it('strips scripts', () => {
    expect(out).not.toMatch(/<script/i)
  })
  it('makes lazy media eager so screenshots are complete', () => {
    expect(out).not.toMatch(/loading=["']?lazy/i)
    expect(out).toContain('loading="eager"')
  })
  it('CSP blocks scripts, connections, frames and objects', () => {
    for (const d of ["script-src 'none'", "connect-src 'none'", "frame-src 'none'", "object-src 'none'"]) expect(RENDER_CSP).toContain(d)
  })
})

describe('hardenForRender structural hardening', () => {
  it('does not let an HTML comment divert the CSP away from the real <head>', () => {
    const html = `<html><!-- remember to update <head> block --><head><title>x</title></head><body>hi</body></html>`
    const out = hardenForRender(html)
    expect(out).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}">`)
    expect(out).not.toContain('<!--')
  })

  it('does not inject the CSP into a <header> element', () => {
    const html = `<html><header>nav</header><head><title>x</title></head><body>hi</body></html>`
    const out = hardenForRender(html)
    expect(out).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}">`)
    expect(out).not.toContain(`<header><meta http-equiv="Content-Security-Policy"`)
  })

  it('injects the CSP into an uppercase <HEAD>', () => {
    const html = `<HTML><HEAD><TITLE>x</TITLE></HEAD><BODY>hi</BODY></HTML>`
    const out = hardenForRender(html)
    expect(out).toContain(`<HEAD><meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}">`)
  })

  it('strips inline event-handler attributes', () => {
    const html = `<html><head></head><body onload="alert(1)"><img src="x" onerror="fetch('//evil')"></body></html>`
    const out = hardenForRender(html)
    expect(out).not.toMatch(/onerror/i)
    expect(out).not.toMatch(/onload/i)
  })

  it('strips meta-refresh redirects in any quoting/case', () => {
    const variants = [
      `<meta http-equiv="refresh" content="0;url=https://evil.test">`,
      `<meta http-equiv='refresh' content='0;url=https://evil.test'>`,
      `<META HTTP-EQUIV="REFRESH" CONTENT="0;url=https://evil.test">`,
    ]
    for (const tag of variants) {
      const out = hardenForRender(`<html><head>${tag}</head><body>x</body></html>`)
      expect(out.toLowerCase()).not.toContain('refresh')
    }
  })

  it('guarantees exactly one CSP meta when there is no <head> element', () => {
    for (const html of [`<html><body>x</body></html>`, `<p>x</p>`]) {
      const out = hardenForRender(html)
      const matches = out.match(/Content-Security-Policy/g) ?? []
      expect(matches.length).toBe(1)
    }
  })

  it('injects the CSP exactly once for normal input', () => {
    const html = `<!doctype html><html><head><title>x</title></head><body>hi</body></html>`
    const out = hardenForRender(html)
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
