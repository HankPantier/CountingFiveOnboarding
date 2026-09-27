import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const SID = '7ce3c00a-f6ad-41f3-86cc-6bdfc3af7184'
const m = vi.hoisted(() => ({ ctx: vi.fn(), siteUrl: vi.fn(), get: vi.fn() }))

vi.mock('../../_helpers', () => ({ resolveEditContext: (id: string) => m.ctx(id) }))
vi.mock('@/lib/theme-preview/site-url', () => ({ getPreviewSiteUrl: (a: unknown) => m.siteUrl(a) }))
// The real buildPreviewShell (with its marker guard) runs; only the network is mocked.
vi.mock('@/lib/audit/crawl', () => ({ safeGet: (u: string) => m.get(u) }))

import { GET } from './route'

const params = { params: Promise.resolve({ id: SID }) }
const req = () => new Request(`http://x/api/edit/${SID}/theme/shell`)
const page = (head: string) => ({
  status: 200,
  contentType: 'text/html',
  finalUrl: 'https://www.acmecpa.com/',
  body: `<!doctype html><html><head>${head}</head><body></body></html>`,
})

beforeEach(() => {
  m.ctx.mockReset().mockResolvedValue({ jobId: 'j', githubRepo: 'o/r', user: { isAdmin: true } })
  m.siteUrl.mockReset().mockResolvedValue('https://www.acmecpa.com/')
  m.get.mockReset()
})

describe('GET /theme/shell', () => {
  it('returns 422 with the not-Revaltus message for a marker-less page (the old site)', async () => {
    m.get.mockResolvedValue(page('<meta name="generator" content="WordPress 6.6">'))
    const res = await GET(req(), params)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error:
        "https://www.acmecpa.com isn't the Revaltus-built site (it may be the client's old site before DNS cutover). Set the preview URL to the site's Vercel address, e.g. https://<project>.vercel.app.",
      code: 'not_revaltus',
    })
  })

  it('returns the shell for a Revaltus page', async () => {
    m.siteUrl.mockResolvedValue('https://acme.vercel.app/')
    m.get.mockResolvedValue({ ...page('<meta name="c5-capabilities" content="fonts"/>'), finalUrl: 'https://acme.vercel.app/' })
    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { origin: string; shellHtml: string }
    expect(body.origin).toBe('https://acme.vercel.app/')
    expect(body.shellHtml).toContain('c5-capabilities')
  })

  it('keeps an unreachable site a 502', async () => {
    m.get.mockResolvedValue(null)
    expect((await GET(req(), params)).status).toBe(502)
  })

  it('403s a non-admin before any fetch', async () => {
    m.ctx.mockResolvedValue({ jobId: 'j', githubRepo: 'o/r', user: { isAdmin: false } })
    expect((await GET(req(), params)).status).toBe(403)
    expect(m.get).not.toHaveBeenCalled()
  })

  it('passes the gate response through', async () => {
    m.ctx.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await GET(req(), params)).status).toBe(401)
  })
})
