import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ readFile: vi.fn() }))
vi.mock('@/lib/github/repo-files', () => {
  class FileNotFoundError extends Error {}
  return { DRAFT_BRANCH: 'draft', FileNotFoundError, readFile: (...a: unknown[]) => m.readFile(...a) }
})

const shell = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('./shell-capabilities', () => ({ readShellCapabilities: (a: unknown) => shell.read(a) }))

import { FileNotFoundError } from '@/lib/github/repo-files'
import { readDesignCapabilities, readEffectiveCapabilities } from './capabilities-read'
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

describe('readEffectiveCapabilities', () => {
  it('returns the draft marker and its intersection with the shell', async () => {
    m.readFile.mockResolvedValue({ content: '{"templateVersion":"2026.09.2","capabilities":["fonts","style-axes","specimen"]}', sha: 'a'.repeat(40) })
    shell.read.mockResolvedValue({ status: 'verified', capabilities: ['fonts'] })
    const r = await readEffectiveCapabilities({ githubRepo: 'o/r', jobId: 'j' })
    expect(r.draft.level).toBe(4)
    expect(r.effective).toMatchObject({ level: 2, capabilities: ['fonts'], shell: 'verified' })
    expect(shell.read).toHaveBeenCalledWith({ githubRepo: 'o/r', jobId: 'j' })
  })
})
