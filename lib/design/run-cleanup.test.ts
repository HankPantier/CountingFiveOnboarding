import { describe, it, expect, vi, beforeEach } from 'vitest'
import { asJson } from '@/lib/supabase/json-typed'
import { RID, SID, makeConceptRow } from './__fixtures__/rows'
import { newReview } from './review'

const m = vi.hoisted(() => ({ versionPaths: vi.fn(), remove: vi.fn() }))
vi.mock('./chat-store', () => ({ versionScreenshotPathSet: (...a: unknown[]) => m.versionPaths(...a) }))
vi.mock('./storage', () => ({ removeDesignPaths: (...a: unknown[]) => m.remove(...a) }))

import { conceptRenderPaths, removeRetiredConceptRenders } from './run-cleanup'

const DB = {} as never
const shot = (name: string, run = RID) => ({ viewport: 'desktop', path: `design/${SID}/runs/${run}/${name}`, width: 1440, height: 900 })

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  m.versionPaths.mockResolvedValue(new Set())
  m.remove.mockResolvedValue(undefined)
})

describe('conceptRenderPaths', () => {
  it('collects the row, first-render and best sets, de-duplicated', () => {
    const row = makeConceptRow({
      screenshots: asJson([shot('concept-1-r2-desktop.webp')]),
      critique: asJson({
        ...newReview(),
        initialScreenshots: [shot('concept-1-r0-desktop.webp')],
        best: { iteration: 1, bundle: {}, screenshots: [shot('concept-1-r1-desktop.webp'), shot('concept-1-r0-desktop.webp')], metrics: null, critique: null, gateFailures: 0 },
      }),
    })
    expect(conceptRenderPaths([row]).sort()).toEqual(
      [shot('concept-1-r0-desktop.webp').path, shot('concept-1-r1-desktop.webp').path, shot('concept-1-r2-desktop.webp').path].sort()
    )
  })
})

describe('removeRetiredConceptRenders', () => {
  it('removes only this run’s renders, keeping version thumbnails', async () => {
    const keep = shot('concept-1-r1-desktop.webp').path
    m.versionPaths.mockResolvedValue(new Set([keep]))
    const row = makeConceptRow({
      screenshots: asJson([shot('concept-1-r0-desktop.webp'), shot('concept-1-r1-desktop.webp'), shot('x.webp', 'other-run')]),
    })
    expect(await removeRetiredConceptRenders(DB, SID, RID, [row])).toBe(1)
    expect(m.versionPaths).toHaveBeenCalledWith(DB, SID)
    expect(m.remove).toHaveBeenCalledWith(DB, [shot('concept-1-r0-desktop.webp').path])
  })
  it('nothing to remove → no storage call', async () => {
    expect(await removeRetiredConceptRenders(DB, SID, RID, [makeConceptRow({ screenshots: asJson([]) })])).toBe(0)
    expect(m.remove).not.toHaveBeenCalled()
  })
  it('never throws on a storage failure', async () => {
    m.remove.mockRejectedValue(new Error('down'))
    const row = makeConceptRow({ screenshots: asJson([shot('concept-0-r0-desktop.webp')]) })
    expect(await removeRetiredConceptRenders(DB, SID, RID, [row])).toBe(0)
  })
})
