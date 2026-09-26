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
const PAGE = 'content/pages/about.md'
const post = () =>
  POST(
    new Request('http://x', { method: 'POST', body: JSON.stringify({ messages: [], path: PAGE }) }),
    { params: Promise.resolve({ id: SID }) }
  )

beforeEach(() => {
  m.file = '---\ntitle: "About"\n---\n\nWe partner with Root Advisors on payroll.\n'
  m.tools = null
  m.system = null
  m.streamCalls = 0
  m.spend = null
  m.insertFiled = true
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
})
