import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/mbp/generate-json', () => ({ generateMbpJson: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))

import { generateMbpJson } from '@/lib/mbp/generate-json'
import { scoreDraft } from './draft-critic'

const input = {
  pageId: 'p1', pageUrl: '/a', pageTitle: 'A', contentMarkdown: 'Body text.', outlineSections: [],
  targetKeyword: 'tax', competitorRefs: [], schema: {}, sessionId: 's1', contentJobId: 'j1',
}

describe('scoreDraft token stage', () => {
  beforeEach(() => { vi.mocked(generateMbpJson).mockClear() })

  it("records spend as 'critic' by default", async () => {
    await scoreDraft(input)
    expect(vi.mocked(generateMbpJson).mock.calls[0][3]).toMatchObject({ stage: 'critic' })
  })

  it('records spend under the stage the caller passes (QA judge)', async () => {
    await scoreDraft(input, undefined, { stage: 'qa_judge' })
    expect(vi.mocked(generateMbpJson).mock.calls[0][3]).toMatchObject({ stage: 'qa_judge', pageUrl: '/a' })
  })
})
