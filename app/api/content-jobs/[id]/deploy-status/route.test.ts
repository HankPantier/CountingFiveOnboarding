import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  job: { github_repo: 'o/r', preview_url: null as string | null },
  getStatus: vi.fn(),
  cache: vi.fn(async (_a: unknown) => null),
  afterCbs: [] as (() => Promise<void>)[],
}))

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (cb: () => Promise<void>) => m.afterCbs.push(cb),
}))
vi.mock('@/lib/auth/access', () => ({ requireContentJobAccess: async () => ({ user: { isAdmin: true } }) }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: m.job }) }) }) }) }),
}))
vi.mock('@/lib/github/repo-files', () => ({ DRAFT_BRANCH: 'draft', getStatus: () => m.getStatus() }))
vi.mock('@/lib/theme-preview/site-url', () => ({ cacheVercelPreviewUrl: (a: unknown) => m.cache(a) }))

import { GET } from './route'
import { DEPLOY_COMMIT_PREFIX } from '@/lib/github/deploy-commit'

const params = { params: Promise.resolve({ id: 'job-1' }) }
const status = (messages: string[]) => ({
  lastCommitSha: 'abc',
  lastCommitMessage: messages.at(-1) ?? null,
  lastCommitAt: null,
  aheadCommitMessages: messages,
  draftAhead: messages.length,
})

beforeEach(() => {
  m.job = { github_repo: 'o/r', preview_url: null }
  m.afterCbs = []
  m.cache.mockClear()
  m.getStatus.mockReset()
})

describe('GET deploy-status — preview URL hook', () => {
  it('once the deploy commit landed and no preview_url is set, caches the Vercel address in the background', async () => {
    m.getStatus.mockResolvedValue(status([`${DEPLOY_COMMIT_PREFIX} (12 files)`]))
    const res = await GET(new Request('http://x'), params)
    expect((await res.json()).isDeployCommit).toBe(true)
    expect(m.afterCbs).toHaveLength(1)
    await m.afterCbs[0]()
    expect(m.cache).toHaveBeenCalledWith({ jobId: 'job-1', githubRepo: 'o/r' })
  })

  it('does nothing when preview_url is already set', async () => {
    m.job = { github_repo: 'o/r', preview_url: 'https://acme.vercel.app/' }
    m.getStatus.mockResolvedValue(status([`${DEPLOY_COMMIT_PREFIX} (12 files)`]))
    await GET(new Request('http://x'), params)
    expect(m.afterCbs).toHaveLength(0)
  })

  it('does nothing before the deploy commit lands', async () => {
    m.getStatus.mockResolvedValue(status(['edit: tweak copy']))
    await GET(new Request('http://x'), params)
    expect(m.afterCbs).toHaveLength(0)
  })
})
