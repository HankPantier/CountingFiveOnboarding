import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ readFile: vi.fn() }))
vi.mock('@/lib/github/repo-files', () => {
  class FileNotFoundError extends Error {}
  return { DRAFT_BRANCH: 'draft', FileNotFoundError, readFile: (...a: unknown[]) => m.readFile(...a) }
})

import { FileNotFoundError } from '@/lib/github/repo-files'
import { readDesignCapabilities } from './capabilities-read'
import { DEFAULT_CAPABILITIES } from './run-types'

// beforeEach flushes a macrotask after mockReset(): on this Vitest 4.1.8 /
// Node runtime, resetting `readFile` synchronously right before the very next
// test does mockRejectedValue()+await-through-a-module-boundary races Node's
// unhandledRejection detector and false-flags a properly awaited/caught
// rejection as a test failure. The flush avoids the race without changing
// what's being asserted.
beforeEach(async () => {
  m.readFile.mockReset()
  await new Promise((resolve) => setImmediate(resolve))
})

describe('readDesignCapabilities', () => {
  it('reads c5-template.json from the draft branch', async () => {
    m.readFile.mockResolvedValue({ content: '{"templateVersion":"2.0.0","capabilities":["fonts"]}', sha: 'a'.repeat(40) })
    const c = await readDesignCapabilities('o/r')
    expect(m.readFile).toHaveBeenCalledWith('o/r', 'c5-template.json', 'draft')
    expect(c.level).toBe(2)
  })
  it('treats a missing marker as L1', async () => {
    m.readFile.mockRejectedValue(new FileNotFoundError('missing'))
    expect(await readDesignCapabilities('o/r')).toEqual(DEFAULT_CAPABILITIES)
  })
  it('rethrows other GitHub errors', async () => {
    m.readFile.mockRejectedValue(new Error('rate limited'))
    await expect(readDesignCapabilities('o/r')).rejects.toThrow('rate limited')
  })
})
