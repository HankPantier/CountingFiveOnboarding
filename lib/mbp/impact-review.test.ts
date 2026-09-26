import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mbp/generate-json', () => ({ generateMbpJson: vi.fn() }))

const session = { schema_data: { business: { name: 'Acme Accounting' } } }

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: session }),
        }),
      }),
    }),
  }),
}))

import { generateMbpJson } from '@/lib/mbp/generate-json'
import { OUTLINE_PROVIDER_OPTIONS } from '@/lib/content/generation-tuning'
import { reviewContentForMbpImpact } from './impact-review'

const mockGen = vi.mocked(generateMbpJson)

describe('reviewContentForMbpImpact', () => {
  it('passes low-effort generation provider options (this is a background review, not the writer)', async () => {
    mockGen.mockResolvedValue(null)

    await reviewContentForMbpImpact({
      sessionId: 'session-1',
      origin: 'content_edit',
      sourceRef: 'services/tax-planning.md',
      changedText: 'Acme now also offers advisory retainers for growing firms.',
    })

    expect(mockGen).toHaveBeenCalledTimes(1)
    const opts = mockGen.mock.calls[0][4]
    expect(opts?.providerOptions).toBe(OUTLINE_PROVIDER_OPTIONS)
  })
})
