import { describe, it, expect } from 'vitest'
import { asJson } from '@/lib/supabase/json-typed'
import { CID, RID, SID, makeConceptRow, makeRunRow } from './__fixtures__/rows'
import { VALID } from './__fixtures__/valid-bundle'
import { runScreenshotPaths, toRunDto } from './run-dto'

const CUR = { viewport: 'desktop', path: `design/${SID}/runs/${RID}/current-desktop-aaaaaaaa.webp`, width: 1440, height: 900 }
const SHOT = { viewport: 'mobile', path: `design/${SID}/runs/${RID}/concept-0-mobile-bbbbbbbb.webp`, width: 780, height: 1568 }
const RUN = makeRunRow({
  status: 'refining',
  stage: 'render',
  cost_usd: 0.9,
  base_snapshot: asJson({ pagePath: '/services', themeShas: {}, screenshots: [CUR], notes: ['Input skipped — X: archived'] }),
})
const CONCEPTS = [
  makeConceptRow({ status: 'ready', screenshots: asJson([SHOT]) }),
  makeConceptRow({ id: 'c2', position: 1, status: 'rejected', bundle: null, error: 'palette.primary: bad' }),
]

describe('run DTO', () => {
  it('collects every screenshot path to sign', () => {
    expect(runScreenshotPaths(RUN, CONCEPTS)).toEqual([CUR.path, SHOT.path])
  })

  it('maps the run, its notes, current shots and concepts', () => {
    const dto = toRunDto(RUN, CONCEPTS, { [CUR.path]: 'https://signed/cur', [SHOT.path]: 'https://signed/shot' })
    expect(dto).toMatchObject({
      id: RID,
      status: 'refining',
      stage: 'render',
      paletteFreedom: 'evolve',
      pagePath: '/services',
      costUsd: 0.9,
      costCapUsd: 4,
      notes: ['Input skipped — X: archived'],
      currentScreenshots: [{ viewport: 'desktop', url: 'https://signed/cur', width: 1440, height: 900 }],
    })
    expect(dto.capabilities.level).toBe(1)
    expect(dto.concepts[0]).toMatchObject({
      id: CID,
      name: 'Harbor Ledger',
      tagline: VALID.tagline,
      palette: VALID.palette,
      tokens: { roundness: 'soft', density: 'balanced', visualFeel: 'editorial' },
      screenshots: [{ viewport: 'mobile', url: 'https://signed/shot', width: 780, height: 1568 }],
    })
    expect(dto.concepts[1]).toMatchObject({ name: 'Concept 2', status: 'rejected', palette: null, error: 'palette.primary: bad' })
  })

  it('drops screenshots whose signing failed', () => {
    expect(toRunDto(RUN, CONCEPTS, {}).currentScreenshots).toEqual([])
  })
})
