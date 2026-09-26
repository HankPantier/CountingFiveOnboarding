import { describe, it, expect, vi, beforeEach } from 'vitest'

const state: { result: { data: unknown; error: { message: string } | null } } = {
  result: { data: null, error: null },
}
const readSiteConfigSiteUrl = vi.fn(async () => 'https://old-live.example.com')

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => state.result }) }) }),
  }),
}))
vi.mock('@/lib/github/repo-files', () => ({
  MAIN_BRANCH: 'main',
  readSiteConfigSiteUrl: () => readSiteConfigSiteUrl(),
}))

import { getPreviewSiteUrl } from './site-url'

describe('getPreviewSiteUrl', () => {
  beforeEach(() => readSiteConfigSiteUrl.mockClear())

  it('prefers the operator preview_url', async () => {
    state.result = { data: { preview_url: 'https://preview.example.com' }, error: null }
    await expect(getPreviewSiteUrl({ jobId: 'j', githubRepo: 'o/r' })).resolves.toBe('https://preview.example.com')
  })

  it('falls back to MAIN siteUrl when no preview_url is set', async () => {
    state.result = { data: { preview_url: null }, error: null }
    await expect(getPreviewSiteUrl({ jobId: 'j', githubRepo: 'o/r' })).resolves.toBe('https://old-live.example.com')
  })

  it('throws on a DB error instead of silently rendering the old live site', async () => {
    state.result = { data: null, error: { message: 'timeout' } }
    await expect(getPreviewSiteUrl({ jobId: 'j', githubRepo: 'o/r' })).rejects.toThrow(/preview_url read failed/)
    expect(readSiteConfigSiteUrl).not.toHaveBeenCalled()
  })
})
