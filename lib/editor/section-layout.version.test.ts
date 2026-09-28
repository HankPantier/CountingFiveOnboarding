import { describe, expect, it } from 'vitest'
import { layoutOptionsFor, setSectionVariant } from './section-layout'

// Version filtering against the REAL catalog: template 2026.09.9 adds the
// `list` layout to service-cards, so the picker must hide it from sites whose
// draft template is older — and refuse it in setSectionVariant.

const BODY = ['<!-- block: service-cards | variant: 3-col -->', '## Services', '', '### Tax', ''].join('\n')

describe('template version filtering', () => {
  it('offers a newer layout only when the draft template has it', () => {
    const values = (v: string | null | undefined) =>
      layoutOptionsFor('service-cards', { variant: '', theme: '' }, { templateVersion: v }).options.map((o) => o.value)
    expect(values('2026.09.8')).toEqual(['2-col', '3-col'])
    expect(values(null)).toEqual(['2-col', '3-col'])
    expect(values(undefined)).toEqual(['2-col', '3-col'])
    expect(values('2026.09.9')).toEqual(['2-col', '3-col', 'list'])
    expect(values('2026.09.10')).toEqual(['2-col', '3-col', 'list'])
  })

  it('shows a too-new written value as not recognised on an older template', () => {
    const o = layoutOptionsFor('service-cards', { variant: 'list', theme: '' }, { templateVersion: '2026.09.8' })
    expect(o.currentRecognised).toBe(false)
    expect(o.options[0]).toMatchObject({ value: 'list', recognised: false })
  })

  it('refuses a too-new value on an older template and accepts it on a newer one', () => {
    expect(setSectionVariant(BODY, 0, 'list', { templateVersion: '2026.09.8' })).toMatchObject({ ok: false, body: BODY })
    expect(setSectionVariant(BODY, 0, 'list')).toMatchObject({ ok: false, body: BODY })
    const res = setSectionVariant(BODY, 0, 'list', { templateVersion: '2026.09.9' })
    expect(res.body.split('\n')[0]).toBe('<!-- block: service-cards | variant: list -->')
  })
})
