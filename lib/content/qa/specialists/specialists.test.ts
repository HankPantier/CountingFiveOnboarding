import { describe, it, expect, vi } from 'vitest'
import { parseSpecialistFindings, type SpecialistInput } from './types'
import { runSpecialist, runAllSpecialists } from './run'
import { ACCURACY } from './accuracy'
import { COPY_EDITOR } from './copy-editor'
import type { SessionSchema } from '@/types/session-schema'

const input: SpecialistInput = {
  pageUrl: '/services/tax', pageTitle: 'Tax', body: 'We have served Austin since 2003. Call 555-0100 today.',
  metaTitle: 't', metaDescription: 'd', targetKeyword: 'tax', outlineSections: [], sitemapUrls: ['/services/tax'],
  verbatim: false, ruleHits: [], schema: {} as SessionSchema, sessionId: 's', contentJobId: 'j',
}

describe('parseSpecialistFindings', () => {
  it('downgrades auto outside allowedAuto and caps at 15', () => {
    const raw = { findings: Array.from({ length: 20 }, () => ({ severity: 'high', kind: 'unsupported_claim', quote: 'since 2003', message: 'm', patch: { target: 'body', find: 'since 2003', replace: '' }, safety: 'auto' })) }
    const out = parseSpecialistFindings(raw, ACCURACY)
    expect(out).toHaveLength(15)
    expect(out.every(f => f.safety === 'flag' && f.agent === 'accuracy' && f.status === 'open')).toBe(true)
  })
  it('keeps auto for an allowed kind with a patch, drops junk', () => {
    const out = parseSpecialistFindings({ findings: [
      { severity: 'low', kind: 'typo', quote: 'teh', message: 'typo', patch: { target: 'body', find: 'teh firm', replace: 'the firm' }, safety: 'auto' },
      { nonsense: true },
    ] }, COPY_EDITOR)
    expect(out).toHaveLength(1)
    expect(out[0].safety).toBe('auto')
  })
  it('returns [] for unparseable input', () => {
    expect(parseSpecialistFindings('nope', COPY_EDITOR)).toEqual([])
  })
})

describe('runSpecialist', () => {
  it('drops body patches whose find is not in the page', async () => {
    const generate = vi.fn().mockResolvedValue([
      { id: '1', agent: 'copy', severity: 'low', kind: 'typo', quote: 'x', message: 'm', patch: { target: 'body', find: 'not on the page at all', replace: 'y' }, safety: 'auto', status: 'open' },
      { id: '2', agent: 'copy', severity: 'low', kind: 'typo', quote: 'x', message: 'm', patch: { target: 'body', find: 'Call 555-0100 today', replace: 'Call 555-0100 now' }, safety: 'auto', status: 'open' },
    ])
    const out = await runSpecialist(COPY_EDITOR, input, { generate })
    expect(out.map(f => f.id)).toEqual(['2'])
  })
  it('puts job-constant text in cachePrefix and the page in the prompt', async () => {
    const generate = vi.fn().mockResolvedValue([])
    await runSpecialist(ACCURACY, input, { generate })
    const [prompt, , , ctx, opts] = generate.mock.calls[0]
    expect(prompt).toContain('since 2003')
    expect(opts.cachePrefix).not.toContain('since 2003')
    expect(ctx).toMatchObject({ task: 'content', stage: 'qa_accuracy', pageUrl: '/services/tax' })
  })
  it('drops body patches whose find occurs more than once', async () => {
    const dupeInput: SpecialistInput = { ...input, body: 'Call 555-0100 today. For questions, Call 555-0100 today.' }
    const generate = vi.fn().mockResolvedValue([
      { id: '1', agent: 'copy', severity: 'low', kind: 'typo', quote: 'x', message: 'm', patch: { target: 'body', find: 'Call 555-0100 today', replace: 'Call 555-0100 now' }, safety: 'auto', status: 'open' },
    ])
    const out = await runSpecialist(COPY_EDITOR, dupeInput, { generate })
    expect(out).toEqual([])
  })
  it('reports a page-level specialist_unavailable finding when generation returns null', async () => {
    const out = await runSpecialist(ACCURACY, input, { generate: vi.fn().mockResolvedValue(null) })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ agent: 'accuracy', kind: 'specialist_unavailable', safety: 'flag', status: 'open', severity: 'low', quote: '' })
    expect(out[0].message).toContain('fact-check')
  })
  it('reports a page-level specialist_unavailable finding when generation throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await runSpecialist(COPY_EDITOR, input, { generate: vi.fn().mockRejectedValue(new Error('boom')) })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ agent: 'copy', kind: 'specialist_unavailable', safety: 'flag', status: 'open' })
    expect(out[0].message).toContain('copy editor')
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('runAllSpecialists', () => {
  it('runs only seo for verbatim pages', async () => {
    const generate = vi.fn().mockResolvedValue([])
    await runAllSpecialists({ ...input, verbatim: true }, { generate })
    expect(generate.mock.calls.map(c => c[3].stage)).toEqual(['qa_seo'])
  })
  it('runs all four otherwise, in parallel', async () => {
    const generate = vi.fn().mockResolvedValue([])
    await runAllSpecialists(input, { generate })
    expect(generate.mock.calls.map(c => c[3].stage).sort()).toEqual(['qa_accuracy', 'qa_copy', 'qa_seo', 'qa_structure'])
  })
})
