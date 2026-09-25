import { describe, it, expect } from 'vitest'
import { asJson } from '@/lib/supabase/json-typed'
import { SID, makeInputRow, makeVersionListRow } from './__fixtures__/rows'
import { buildInputSuggestions, toInputDto, toVersionDto, versionScreenshotPaths } from './studio-dto'

describe('toInputDto', () => {
  it('maps fields and signs the thumbnail', () => {
    const path = `design/${SID}/inputs/a.webp`
    const dto = toInputDto(makeInputRow({ storage_path: path, capture_status: 'ok' }), { [path]: 'https://signed/a' })
    expect(dto).toMatchObject({ kind: 'competitor_url', captureStatus: 'ok', thumbnailUrl: 'https://signed/a', label: 'Acme CPA', archived: false })
  })
  it('has a null thumbnail without a stored or signed path', () => {
    expect(toInputDto(makeInputRow(), {}).thumbnailUrl).toBeNull()
    expect(toInputDto(makeInputRow({ storage_path: `design/${SID}/x.webp` }), {}).thumbnailUrl).toBeNull()
  })
})

describe('versions', () => {
  it('takes the name from bundle_name and signs screenshots', () => {
    const p = `design/${SID}/versions/v1.webp`
    const row = makeVersionListRow({ version_no: 1, source: 'concept', screenshots: asJson([{ path: p }, { path: 'sessions/x.png' }, 'junk']) })
    expect(versionScreenshotPaths(row)).toEqual([p])
    expect(toVersionDto(row, { [p]: 'https://signed/v1' })).toMatchObject({
      versionNo: 1,
      source: 'concept',
      name: 'Baseline',
      screenshotUrls: ['https://signed/v1'],
    })
  })
  it('falls back for a null/blank bundle_name and an unknown source', () => {
    const dto = toVersionDto(makeVersionListRow({ bundle_name: null, source: 'weird' }), {})
    expect(dto.name).toBe('Untitled design')
    expect(dto.source).toBe('import')
  })
})

describe('buildInputSuggestions', () => {
  it('normalizes the site URL and dedupes competitor names', () => {
    const s = buildInputSuggestions({
      websiteUrl: 'bblcpa.com',
      business: { competitors: [{ name: ' Acme CPA ' }, { name: 'acme cpa' }, { name: '' }, 'Beta LLP', null, { name: 5 }] },
    })
    expect(s).toEqual({ currentSite: 'https://bblcpa.com/', competitors: [{ name: 'Acme CPA' }, { name: 'Beta LLP' }] })
  })
  it('is empty for missing or malformed data', () => {
    expect(buildInputSuggestions(null)).toEqual({ currentSite: null, competitors: [] })
    expect(buildInputSuggestions({ websiteUrl: 'not a url', business: { competitors: 'Acme' } })).toEqual({ currentSite: null, competitors: [] })
  })
  it('caps the competitor list at 12', () => {
    const competitors = Array.from({ length: 20 }, (_, i) => ({ name: `Firm ${i}` }))
    expect(buildInputSuggestions({ business: { competitors } }).competitors).toHaveLength(12)
  })
})
