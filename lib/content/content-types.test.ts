import { describe, expect, it } from 'vitest'
import {
  CONTENT_TYPES,
  CONTENT_TYPE_OPTIONS,
  DEFAULT_CONTENT_TYPE,
  asContentType,
  buildFormatRules,
  hasCaseStudyData,
  isContentType,
  type ContentType,
} from './content-types'
import type { SessionSchema } from '@/types/session-schema'

const ALL_TYPES: ContentType[] = ['blog', 'article', 'thought-leadership', 'case-study']

describe('content type specs', () => {
  it('defines a spec for every type with a sane word range', () => {
    for (const type of ALL_TYPES) {
      const spec = CONTENT_TYPES[type]
      expect(spec).toBeDefined()
      expect(spec.uiLabel.length).toBeGreaterThan(0)
      expect(spec.articleNoun.length).toBeGreaterThan(0)
      const [min, max] = spec.wordRange
      expect(min).toBeGreaterThan(0)
      expect(max).toBeGreaterThan(min)
    }
  })

  it('only case studies require client data', () => {
    expect(CONTENT_TYPES['case-study'].requiresCaseData).toBe(true)
    expect(CONTENT_TYPES.blog.requiresCaseData).toBe(false)
    expect(CONTENT_TYPES.article.requiresCaseData).toBe(false)
    expect(CONTENT_TYPES['thought-leadership'].requiresCaseData).toBe(false)
  })

  it('blog defaults to BlogPosting markup; the rest use Article', () => {
    expect(CONTENT_TYPES.blog.defaultSchemaMarkup).toBe('BlogPosting')
    expect(CONTENT_TYPES.article.defaultSchemaMarkup).toBe('Article')
    expect(CONTENT_TYPES['thought-leadership'].defaultSchemaMarkup).toBe('Article')
    expect(CONTENT_TYPES['case-study'].defaultSchemaMarkup).toBe('Article')
  })

  it('exposes one selector option per type', () => {
    expect(CONTENT_TYPE_OPTIONS.map((o) => o.value).sort()).toEqual([...ALL_TYPES].sort())
  })
})

describe('isContentType / asContentType', () => {
  it('accepts the four known types', () => {
    for (const type of ALL_TYPES) expect(isContentType(type)).toBe(true)
  })

  it('rejects unknown values', () => {
    expect(isContentType('newsletter')).toBe(false)
    expect(isContentType(null)).toBe(false)
    expect(isContentType(undefined)).toBe(false)
    expect(isContentType(3)).toBe(false)
  })

  it('coerces unknown values to the default (blog)', () => {
    expect(asContentType('case-study')).toBe('case-study')
    expect(asContentType('nonsense')).toBe(DEFAULT_CONTENT_TYPE)
    expect(asContentType(undefined)).toBe('blog')
    expect(DEFAULT_CONTENT_TYPE).toBe('blog')
  })
})

describe('buildFormatRules', () => {
  it('embeds the per-type word range', () => {
    expect(buildFormatRules('blog', 'Austin, TX')).toContain('1,200–1,800 words')
    expect(buildFormatRules('article', 'Austin, TX')).toContain('1,800–2,500 words')
    expect(buildFormatRules('thought-leadership', 'Austin, TX')).toContain('1,000–1,500 words')
    expect(buildFormatRules('case-study', 'Austin, TX')).toContain('800–1,200 words')
  })

  it('gives case studies a no-fabrication guard and a narrative arc', () => {
    const rules = buildFormatRules('case-study', 'Austin, TX')
    expect(rules).toContain('Never invent')
    expect(rules).toMatch(/Client & Context/)
    expect(rules).toMatch(/Results/)
  })

  it('gives thought leadership a first-person point of view', () => {
    const rules = buildFormatRules('thought-leadership', 'Austin, TX')
    expect(rules.toLowerCase()).toContain('stance')
    expect(rules).toContain('first-person-plural')
  })

  it('falls back to a market phrase when no location is given', () => {
    expect(buildFormatRules('blog', '')).toContain("the firm's market")
  })
})

describe('hasCaseStudyData', () => {
  const withStory = { business: { clientSuccessStories: ['Helped a SaaS firm cut its close by 40%'] } } as SessionSchema
  const noStory = { business: { clientSuccessStories: [] as string[] } } as SessionSchema

  it('is true when the MBP has a client success story', () => {
    expect(hasCaseStudyData(withStory, null)).toBe(true)
  })

  it('is true when the operator supplied notes', () => {
    expect(hasCaseStudyData(noStory, 'Client: Acme. Cut month-end close from 10 to 4 days.')).toBe(true)
  })

  it('is false when neither a story nor notes exist', () => {
    expect(hasCaseStudyData(noStory, null)).toBe(false)
    expect(hasCaseStudyData(noStory, '   ')).toBe(false)
    expect(hasCaseStudyData({} as SessionSchema, null)).toBe(false)
  })

  it('ignores blank-only stories', () => {
    const blankStories = { business: { clientSuccessStories: ['', '   '] } } as SessionSchema
    expect(hasCaseStudyData(blankStories, null)).toBe(false)
  })
})
