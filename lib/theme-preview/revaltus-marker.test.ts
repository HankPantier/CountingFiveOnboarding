import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/audit/crawl', () => ({ safeGet: (u: string) => m.get(u) }))

import { findShellMarker, notRevaltusSiteMessage } from './revaltus-marker'
import { buildPreviewShell } from './build-preview-shell'

const MARKER = '<meta name="c5-capabilities" content="fonts,style-axes,specimen"/>'
const html = (head: string) => `<!doctype html><html><head>${head}</head><body><h1>Hi</h1></body></html>`
const res = (body: string) => ({ status: 200, contentType: 'text/html; charset=utf-8', finalUrl: 'https://acme.com/', body })

describe('findShellMarker', () => {
  it('reads the marker as the template emits it (Next metadata `other`, self-closing)', () => {
    expect(findShellMarker(html(MARKER))).toEqual(['fonts', 'style-axes', 'specimen'])
  })
  it('an empty marker is [] (a Revaltus site with no capabilities), not null', () => {
    expect(findShellMarker(html('<meta name="c5-capabilities" content="">'))).toEqual([])
  })
  it('no marker is null (a WordPress / non-Revaltus page)', () => {
    expect(findShellMarker(html('<meta name="generator" content="WordPress 6.6"><meta name="description" content="fonts">'))).toBeNull()
  })
})

describe('notRevaltusSiteMessage', () => {
  it('names the origin and tells the operator to use the Vercel address', () => {
    expect(notRevaltusSiteMessage('https://www.acmecpa.com/services/tax?x=1')).toBe(
      "https://www.acmecpa.com isn't the Revaltus-built site (it may be the client's old site before DNS cutover). Set the preview URL to the site's Vercel address, e.g. https://<project>.vercel.app."
    )
  })
})

describe('buildPreviewShell — Revaltus marker guard', () => {
  beforeEach(() => m.get.mockReset())

  it('refuses a reachable HTML page without the marker (code not_revaltus + the message)', async () => {
    m.get.mockResolvedValue(res(html('<meta name="generator" content="WordPress 6.6">')))
    expect(await buildPreviewShell('https://acme.com/')).toEqual({
      ok: false,
      code: 'not_revaltus',
      reason: notRevaltusSiteMessage('https://acme.com/'),
    })
  })

  it('builds the shell for a page with the marker', async () => {
    m.get.mockResolvedValue({ ...res(html(MARKER)), finalUrl: 'https://acme.vercel.app/' })
    const shell = await buildPreviewShell('https://acme.vercel.app/')
    expect(shell.ok).toBe(true)
    expect(shell.ok && shell.origin).toBe('https://acme.vercel.app/')
  })

  it('keeps the existing unreachable / HTTP-error reasons (no marker code)', async () => {
    m.get.mockResolvedValue(null)
    expect(await buildPreviewShell('https://acme.com/')).toEqual({ ok: false, reason: 'Could not reach the live site (blocked or unreachable).' })
    m.get.mockResolvedValue({ ...res(''), status: 503 })
    expect(await buildPreviewShell('https://acme.com/')).toEqual({ ok: false, reason: 'The live site returned HTTP 503.', status: 503 })
  })
})
