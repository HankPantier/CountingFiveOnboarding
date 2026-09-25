// PF4: exercises loadLatestRunDto() against the fake Supabase fixture rather
// than mocking run-store/run-view collaborators — a real db-shaped double.
import { describe, it, expect, vi } from 'vitest'
import { asJson } from '@/lib/supabase/json-typed'
import { fakeSupabase } from './__fixtures__/fake-supabase'
import { SID, RID, makeRunRow } from './__fixtures__/rows'
import { loadLatestRunDto } from './run-view'

const CUR = { viewport: 'desktop', path: `design/${SID}/runs/${RID}/current-desktop-aaaaaaaa.webp`, width: 1440, height: 900 }

describe('loadLatestRunDto', () => {
  it('returns null when the session has no run', async () => {
    const { client } = fakeSupabase({ design_runs: [{ data: null }] })
    expect(await loadLatestRunDto(client, SID)).toBeNull()
  })

  it('still returns a DTO, with the screenshots dropped, when signing fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const run = makeRunRow({ base_snapshot: asJson({ pagePath: '/', themeShas: {}, screenshots: [CUR], notes: [] }) })
    // The fake client's storage double only implements .remove() — calling
    // .createSignedUrls() throws, which loadLatestRunDto must swallow.
    const { client } = fakeSupabase({ design_runs: [{ data: run }], design_concepts: [{ data: [] }] })

    const dto = await loadLatestRunDto(client, SID)

    expect(dto).not.toBeNull()
    expect(dto?.id).toBe(RID)
    expect(dto?.currentScreenshots).toEqual([])
  })

  it('returns a DTO with signed screenshot URLs on success', async () => {
    const run = makeRunRow({ base_snapshot: asJson({ pagePath: '/', themeShas: {}, screenshots: [CUR], notes: [] }) })
    const { client } = fakeSupabase({ design_runs: [{ data: run }], design_concepts: [{ data: [] }] })
    client.storage.from = ((_bucket: string) => ({
      createSignedUrls: async (paths: string[]) => ({
        data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })),
        error: null,
      }),
    })) as unknown as typeof client.storage.from

    const dto = await loadLatestRunDto(client, SID)

    expect(dto?.currentScreenshots).toEqual([{ viewport: 'desktop', url: `https://signed/${CUR.path}`, width: 1440, height: 900 }])
  })
})
