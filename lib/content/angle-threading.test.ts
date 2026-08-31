import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the messages handed to the model so we can assert what the per-page
// dynamic suffix contained. The mock returns a minimal valid JSON page so
// generatePageContent parses cleanly on the first attempt.
const captured: Array<{ messages?: unknown }> = []

vi.mock('ai', () => ({
  generateText: vi.fn(async (opts: { messages?: unknown }) => {
    captured.push(opts)
    return {
      text: JSON.stringify({ content: '## Overview\nBody copy.', metadata: { meta_title: 'T' } }),
      usage: { inputTokens: 10, outputTokens: 10 },
      finishReason: 'stop',
    }
  }),
}))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: () => 'mock-model' }))

import { generatePageContent } from './content-generator'
import type { SessionSchema } from '@/types/session-schema'

const schema = { business: { name: 'Acme CPA' } } as SessionSchema
const cta = { text: 'Schedule', url: '/contact' }

function lastMessages(): string {
  return JSON.stringify(captured[captured.length - 1]?.messages ?? '')
}

async function generate(angle: string | null) {
  return generatePageContent(
    'Tax Services', '/services/tax', [], 'tax planning', [], null, [],
    schema, null, 'https://acme.com', cta, 'job1', 'sess1', ['/services/tax'], angle,
  )
}

describe('angle threading into page generation', () => {
  beforeEach(() => { captured.length = 0 })

  it('injects the angle directive into the prompt when set', async () => {
    await generate('Emphasize proactive quarterly planning for contractors')
    const msg = lastMessages()
    expect(msg).toContain('PAGE ANGLE / POINT OF VIEW')
    expect(msg).toContain('Emphasize proactive quarterly planning for contractors')
  })

  it('omits the angle block entirely when angle is null', async () => {
    await generate(null)
    expect(lastMessages()).not.toContain('PAGE ANGLE / POINT OF VIEW')
  })

  it('omits the angle block for a blank/whitespace angle', async () => {
    await generate('   ')
    expect(lastMessages()).not.toContain('PAGE ANGLE / POINT OF VIEW')
  })
})
