import { describe, it, expect, vi, afterEach } from 'vitest'
import { triggerQa } from './trigger'

afterEach(() => { vi.unstubAllEnvs() })

describe('triggerQa', () => {
  it('POSTs the page id with the cron bearer', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test')
    vi.stubEnv('CRON_SECRET', 'sek')
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }))
    expect(await triggerQa('j1', 'p1', fetchImpl)).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://app.test/api/content-jobs/j1/qa/run')
    expect(init.headers.Authorization).toBe('Bearer sek')
    expect(JSON.parse(init.body)).toEqual({ pageId: 'p1' })
  })
  it('returns false without a secret (fail closed, no throw)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test')
    vi.stubEnv('CRON_SECRET', '')
    const fetchImpl = vi.fn()
    expect(await triggerQa('j1', 'p1', fetchImpl)).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
