import { describe, expect, it } from 'vitest'
import { validateAnnotationDelta, annotationSyntaxIssues } from './block-annotation-validator'
import { checkEditAnnotations } from '@/lib/editor/apply-edit'

// The real block catalog: `service-cards | list` ships in template 2026.09.9.

const body = (variant: string, extra = '') =>
  [`<!-- block: service-cards | variant: ${variant} -->`, '## Services', '', '### Tax', '', extra].join('\n')

describe('version-aware annotation checks', () => {
  it('without a version, any contract variant is valid (generation path unchanged)', () => {
    expect(annotationSyntaxIssues(body('list'))).toEqual([])
    expect(validateAnnotationDelta(body('3-col'), body('list'))).toEqual([])
  })

  it('rejects an introduced variant newer than the site template', () => {
    for (const templateVersion of ['2026.09.8', null]) {
      const errs = validateAnnotationDelta(body('3-col'), body('list'), { templateVersion })
      expect(errs).toHaveLength(1)
      expect(errs[0]).toMatch(/needs template 2026\.09\.9/)
    }
    expect(validateAnnotationDelta(body('3-col'), body('list'), { templateVersion: '2026.09.9' })).toEqual([])
  })

  it('never blocks an unrelated edit on a page that already has the newer variant', () => {
    expect(
      validateAnnotationDelta(body('list'), body('list', 'New copy.'), { templateVersion: '2026.09.8' }),
    ).toEqual([])
  })

  it('checkEditAnnotations passes the version through', () => {
    const file = (v: string) => `---\ntitle: A\n---\n${body(v)}`
    expect(checkEditAnnotations(file('3-col'), file('list'), { templateVersion: '2026.09.8' }).errors).toHaveLength(1)
    expect(checkEditAnnotations(file('3-col'), file('list')).errors).toEqual([])
  })
})

describe('generation validation (validateBlockAnnotations) with a template version', () => {
  it('coerces a layout newer than the site template; accepts it when the template has it or no version is known', async () => {
    const { parseBlockAnnotations, validateBlockAnnotations } = await import('./block-annotation-validator')
    const anns = parseBlockAnnotations(body('list'))
    const coerced = (opts?: { templateVersion: string | null }) => validateBlockAnnotations(anns, '/services', [], opts).coercions
    expect(coerced({ templateVersion: '2026.09.8' })).toEqual([
      expect.objectContaining({ blockId: 'service-cards', originalVariant: 'list', coercedVariant: '2-col' }),
    ])
    expect(coerced({ templateVersion: null })).toHaveLength(1)
    expect(coerced({ templateVersion: '2026.09.9' })).toEqual([])
    expect(coerced()).toEqual([])
  })
})
