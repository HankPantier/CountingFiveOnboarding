import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

// Drives the AI page editor's tools directly: streamText is mocked to capture
// the tool map, then each tool's execute() runs against an in-memory draft file.
type Tool = { execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>> }

const m = vi.hoisted(() => ({
  file: '',
  tools: null as null | Record<string, Tool>,
  system: null as null | Array<{ content: string }>,
  streamCalls: 0,
  spend: null as null | Response,
  insertFiled: true,
  ctx: null as null | Record<string, unknown>,
  marker: null as null | string,
  path: 'content/pages/about.md',
}))

vi.mock('ai', async (orig) => ({
  ...((await orig()) as object),
  streamText: (args: { tools: Record<string, Tool>; system: Array<{ content: string }> }) => {
    m.streamCalls += 1
    m.tools = args.tools
    m.system = args.system
    return { toUIMessageStreamResponse: () => new Response('stream') }
  },
}))
// The catalog gains a future `service-cards | list` layout (since 2026.09.9) so
// the version tests can prove the draft marker reaches the hint and the tools.
// Every other block/variant is the real contract.
vi.mock('@/lib/content/block-catalog', async (importOriginal) => {
  const { catalogWithListLayout } = await import('@/lib/content/__fixtures__/catalog-with-list')
  return catalogWithListLayout(importOriginal as never)
})
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: () => ({}) }))
vi.mock('../_helpers', () => ({ resolveEditContext: async () => m.ctx }))
vi.mock('@/lib/auth/access', () => ({
  isSiteOwner: (u: { isAdmin: boolean; capabilities: string[] }) => !u.isAdmin && u.capabilities.includes('owner'),
}))
vi.mock('@/lib/ai/chat-spend-limit', () => ({ checkChatSpendLimit: async () => m.spend }))
vi.mock('@/lib/content/no-go-phrases', () => ({
  loadNoGoPhrases: async () => [],
  buildNoGoPromptBlock: () => '',
  findNoGoHits: () => [],
}))
vi.mock('@/lib/content/token-usage', () => ({ recordTokenUsage: vi.fn() }))
vi.mock('@/lib/mbp/create-suggestion', () => ({ insertMbpSuggestion: async () => ({ filed: m.insertFiled }) }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => {
    const b: Record<string, unknown> = {
      select: () => b,
      update: () => b,
      eq: () => b,
      single: async () => ({ data: { schema_data: { business: { name: 'Acme CPA' } } } }),
    }
    return { from: () => b }
  },
}))
vi.mock('@/lib/github/repo-files', () => {
  class FileNotFoundError extends Error {}
  return {
    DRAFT_BRANCH: 'draft',
    FileNotFoundError,
    ensureDraftBranch: async () => undefined,
    readFileConditional: async (_repo: string, path: string) => {
      if (path !== 'c5-template.json' || m.marker === null) throw new FileNotFoundError('nope')
      return { content: m.marker, sha: 'sha-m' }
    },
    readFile: async (_repo: string, path: string) => {
      if (path === 'content/brand.json') throw new FileNotFoundError('nope')
      return { content: m.file, sha: 'sha-0' }
    },
    writeFile: async (_r: string, _p: string, content: string) => {
      m.file = content
      return { blobSha: `sha-${Math.random()}` }
    },
    patchBrandJsonContact: async () => ({ patched: true }),
  }
})

import { POST } from './route'

const SID = '11111111-1111-1111-1111-111111111111'
const post = () =>
  POST(
    new Request('http://x', { method: 'POST', body: JSON.stringify({ messages: [], path: m.path }) }),
    { params: Promise.resolve({ id: SID }) }
  )

beforeEach(() => {
  m.file = '---\ntitle: "About"\n---\n\nWe partner with Root Advisors on payroll.\n'
  m.tools = null
  m.system = null
  m.streamCalls = 0
  m.spend = null
  m.insertFiled = true
  m.marker = null
  m.path = 'content/pages/about.md'
  m.ctx = { githubRepo: 'o/r', sessionId: SID, jobId: 'j', adminEmail: 'a@x.com', adminName: 'A', user: { id: 'u1', isAdmin: true, capabilities: [] } }
})

describe('POST /api/edit/[id]/chat', () => {
  it('returns the spend-limit 429 before any model call', async () => {
    m.spend = NextResponse.json({ error: 'limit' }, { status: 429 })
    const res = await post()
    expect(res.status).toBe(429)
    expect(m.streamCalls).toBe(0)
  })

  it('flags a set_faq that re-adds a phrase remove_text cleared earlier in the run', async () => {
    await post()
    const tools = m.tools!
    const removed = await tools.remove_text.execute({ removals: [{ find: 'Root Advisors' }] })
    expect(removed.success).toBe(true)
    expect(m.file).not.toContain('Root Advisors')

    const faq = await tools.set_faq.execute({ items: [{ question: 'Who handles payroll?', answer: 'Root Advisors does.' }] })
    expect(faq.success).toBe(true)
    expect(faq.residual).toEqual([expect.objectContaining({ find: 'Root Advisors' })])
  })

  it('reports mbpFlagged honestly when the suggestion could not be filed', async () => {
    await post()
    m.insertFiled = false
    const res = await m.tools!.update_firm_contact.execute({ field: 'phone', value: '555-0100' })
    expect(res.mbpFlagged).toBe(false)
    expect(String(res.note)).toMatch(/Could NOT flag/)

    m.insertFiled = true
    const ok = await m.tools!.update_firm_contact.execute({ field: 'phone', value: '555-0101' })
    expect(ok.mbpFlagged).toBe(true)
  })

  it('does not register update_firm_contact for a Site Owner, and the system prompt refuses instead of advertising it', async () => {
    m.ctx = { ...m.ctx, user: { id: 'u2', isAdmin: false, capabilities: ['owner'] } }
    await post()
    expect(m.tools!.update_firm_contact).toBeUndefined()
    // The other tools (which don't touch firm-wide brand.json) stay available.
    expect(m.tools!.apply_edit).toBeDefined()
    expect(m.tools!.set_faq).toBeDefined()

    const systemText = m.system!.map(s => s.content).join('\n')
    expect(systemText).toContain('Firm contact details are managed by your agency — ask them to update it.')
    expect(systemText).not.toContain('update_firm_contact({ ... })')
    expect(systemText).not.toContain('call update_firm_contact')

    // No write path exists at all: the file (and brand.json, which the mocked
    // patchBrandJsonContact would otherwise touch) is untouched.
    expect(m.file).toBe('---\ntitle: "About"\n---\n\nWe partner with Root Advisors on payroll.\n')
  })

  it('leaves update_firm_contact registered and working for an admin', async () => {
    m.ctx = { ...m.ctx, user: { id: 'u1', isAdmin: true, capabilities: [] } }
    await post()
    expect(m.tools!.update_firm_contact).toBeDefined()
    const res = await m.tools!.update_firm_contact.execute({ field: 'phone', value: '555-0100' })
    expect(res.success).toBe(true)
    expect(res.brandJsonUpdated).toBe(true)

    const systemText = m.system!.map(s => s.content).join('\n')
    expect(systemText).toContain('call update_firm_contact')
  })

  describe('set_section_layout', () => {
    const LAYOUT_FILE = [
      '---',
      'title: "About"',
      '---',
      '',
      '<!-- block: content-split | variant: image-right | image: a.jpg | alt: "A desk" | query: "desk" -->',
      '## How we work',
      '',
      'We plan ahead — every quarter.',
      '',
      '<!-- block: service-cards | variant: 3-col -->',
      '## Our services',
      '',
      '### Tax',
      '',
      '## SEO & AIO Metadata',
      '',
      '**Meta:** keep — me',
      '',
    ].join('\n')

    it('changes exactly the one annotation line (no dash scrub, trailer kept)', async () => {
      m.file = LAYOUT_FILE
      await post()
      const res = await m.tools!.set_section_layout.execute({ heading: 'How we work', variant: 'image-left' })
      expect(res).toMatchObject({ success: true, block: 'content-split' })
      const before = LAYOUT_FILE.split('\n')
      const after = m.file.split('\n')
      expect(after).toHaveLength(before.length)
      const diff = before.flatMap((l, i) => (l === after[i] ? [] : [after[i]]))
      expect(diff).toEqual(['<!-- block: content-split | variant: image-left | image: a.jpg | alt: "A desk" | query: "desk" -->'])

      const ink = await m.tools!.set_section_layout.execute({ heading: 'Our services', theme: 'ink' })
      expect(ink.success).toBe(true)
      expect(m.file).toContain('<!-- block: service-cards | variant: 3-col | theme: ink -->')
      expect(m.file).toContain('We plan ahead — every quarter.')
    })

    it('refuses bad requests without writing', async () => {
      m.file = LAYOUT_FILE
      await post()
      expect((await m.tools!.set_section_layout.execute({ heading: 'How we work', variant: '4-col' })).error).toBeTruthy()
      expect((await m.tools!.set_section_layout.execute({ heading: 'Nope', variant: 'image-left' })).error).toMatch(/No section/)
      expect((await m.tools!.set_section_layout.execute({ heading: 'How we work', theme: 'ink' })).error).toBeTruthy()
      expect(m.file).toBe(LAYOUT_FILE)
    })

    it('reads the draft template version for the prompt hint and survives a missing marker', async () => {
      m.marker = JSON.stringify({ templateVersion: '2026.09.8', capabilities: [] })
      await post()
      const systemText = m.system!.map((s) => s.content).join('\n')
      expect(systemText).toContain('content-split (image-right|image-left)')
      expect(systemText).toContain('set_section_layout')
      m.marker = null
      await post()
      expect(m.tools!.set_section_layout).toBeDefined()
    })

    it('rejects an empty variant in the schema and removes one with explicit null', async () => {
      m.file = LAYOUT_FILE
      await post()
      const schema = (m.tools!.set_section_layout as unknown as { inputSchema: { safeParse: (v: unknown) => { success: boolean } } }).inputSchema
      expect(schema.safeParse({ heading: 'How we work', variant: '' }).success).toBe(false)
      expect(schema.safeParse({ heading: 'How we work', variant: null }).success).toBe(true)
      const res = await m.tools!.set_section_layout.execute({ heading: 'Our services', variant: null })
      expect(res).toMatchObject({ success: true, variant: null })
      expect(m.file).toContain('<!-- block: service-cards -->\n## Our services')
    })

    it('is pages-only', async () => {
      m.path = 'content/posts/hello.md'
      m.file = LAYOUT_FILE
      await post()
      expect((await m.tools!.set_section_layout.execute({ heading: 'How we work', variant: 'image-left' })).error).toMatch(/pages only/)
      expect(m.file).toBe(LAYOUT_FILE)
    })
  })

  describe('draft template version', () => {
    const FILE = [
      '---',
      'title: "About"',
      '---',
      '',
      '<!-- block: service-cards | variant: 3-col -->',
      '## Our services',
      '',
      '### Tax',
      '',
    ].join('\n')
    const hint = () => m.system!.map((s) => s.content).join('\n')

    it('an older template: the hint omits the newer layout and both tools refuse it', async () => {
      m.marker = JSON.stringify({ templateVersion: '2026.09.8', capabilities: [] })
      m.file = FILE
      await post()
      expect(hint()).toContain('service-cards (2-col|3-col)')
      expect(hint()).not.toContain('service-cards (2-col|3-col|list)')

      const viaTool = await m.tools!.set_section_layout.execute({ heading: 'Our services', variant: 'list' })
      expect(String(viaTool.error)).toMatch(/not a layout for service-cards/)

      const viaEdit = await m.tools!.apply_edit.execute({
        find: '<!-- block: service-cards | variant: 3-col -->',
        replace: '<!-- block: service-cards | variant: list -->',
      })
      expect(String(viaEdit.error)).toMatch(/needs template 2026\.09\.9/)
      expect(m.file).toBe(FILE)
    })

    it('no marker: baseline vocabulary, newer layout refused', async () => {
      m.marker = null
      m.file = FILE
      await post()
      expect(hint()).toContain('service-cards (2-col|3-col)')
      expect((await m.tools!.set_section_layout.execute({ heading: 'Our services', variant: 'list' })).error).toBeTruthy()
      expect(m.file).toBe(FILE)
    })

    it('a template that has it: the hint offers it and the tool applies it', async () => {
      m.marker = JSON.stringify({ templateVersion: '2026.09.9', capabilities: [] })
      m.file = FILE
      await post()
      expect(hint()).toContain('service-cards (2-col|3-col|list)')
      const res = await m.tools!.set_section_layout.execute({ heading: 'Our services', variant: 'list' })
      expect(res.success).toBe(true)
      expect(m.file).toContain('<!-- block: service-cards | variant: list -->')
    })
  })
})
