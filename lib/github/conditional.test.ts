import { describe, expect, it, vi } from 'vitest'
import { CONDITIONAL_CACHE_MAX, conditionalCacheSize, conditionalGet } from './conditional'

describe('conditionalGet', () => {
  it('serves an immutable (sha-keyed) hit without any request', async () => {
    const fn = vi.fn(async () => ({ status: 200, headers: { etag: 'e1' }, data: { v: 1 } }))
    await conditionalGet('tree:o/r:abc', fn, { immutable: true })
    const second = await conditionalGet('tree:o/r:abc', fn, { immutable: true })
    expect(second).toEqual({ v: 1 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('revalidates a mutable key with if-none-match and serves the cached body on 304', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, headers: { etag: 'e1' }, data: 'body' })
      .mockResolvedValueOnce({ status: 304, headers: {}, data: undefined })
    await conditionalGet('ref:o/r:draft', fn)
    expect(await conditionalGet('ref:o/r:draft', fn)).toBe('body')
    expect(fn.mock.calls[1][0]).toEqual({ 'if-none-match': 'e1' })
  })

  it('is bounded (LRU eviction)', async () => {
    for (let i = 0; i < CONDITIONAL_CACHE_MAX + 50; i++) {
      await conditionalGet(`k${i}`, async () => ({ status: 200, headers: { etag: `e${i}` }, data: i }))
    }
    expect(conditionalCacheSize()).toBe(CONDITIONAL_CACHE_MAX)
  })
})
