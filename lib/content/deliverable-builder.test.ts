import { describe, expect, it } from 'vitest'
import { buildPageMarkdown } from './deliverable-builder'
import type { Database } from '@/types/database'

type GeneratedPage = Database['public']['Tables']['generated_pages']['Row']

function makePage(overrides: Partial<GeneratedPage>): GeneratedPage {
  return {
    admin_approved_content: true,
    answer_block: null,
    canonical_url: null,
    client_approved_content: false,
    content_job_id: 'job-1',
    content_markdown: '<!-- block: intro-text -->\n## Overview\n\nBody.',
    created_at: '2026-01-01T00:00:00Z',
    eeat_signals: null,
    faq_block: null,
    generation_status: 'complete',
    hero_block: 'page-header',
    hero_image: null,
    hero_image_alt: null,
    hero_image_query: null,
    hero_subhead: null,
    hero_variant: null,
    id: 'page-1',
    internal_links: null,
    llm_citation_note: null,
    meta_description: null,
    meta_title: null,
    needs_client_review: false,
    page_title: 'Test Page',
    page_url: '/test',
    schema_markup_type: null,
    secondary_keywords: null,
    target_keyword: null,
    url_slug: null,
    word_count_actual: null,
    word_count_target: null,
    ...overrides,
  }
}

// Grab the value after `key: ` on its frontmatter line (JSON.stringify emits
// no newlines, so each structured field is a single line).
function frontmatterField(md: string, key: string): string {
  const m = md.match(new RegExp(`^${key}: (.*)$`, 'm'))
  if (!m) throw new Error(`frontmatter field "${key}" not found`)
  return m[1]
}

describe('buildPageMarkdown — structured SEO frontmatter', () => {
  // A colon in the answer is the YAML-hostile char JSON.stringify protects.
  const faq = [{ question: 'Do you offer payroll: weekly?', answer: 'Yes. Weekly, biweekly, or monthly.' }]
  const links = [{ url: '/services/tax', anchor_text: 'tax services', reason: 'related service' }]
  const eeat = ['Ron Lague, CPA, PFS', '200+ returns filed']

  const md = buildPageMarkdown(
    makePage({
      answer_block: 'We file year-round: not just in April.',
      eeat_signals: eeat,
      internal_links: links,
      faq_block: faq,
      llm_citation_note: 'Year-round advisory model.',
    }),
    'Korbey Lague PLLP',
    { websiteUrl: 'https://www.korbeylague.com' }
  )

  it('emits faq_block as JSON that round-trips (fires FAQPage schema downstream)', () => {
    expect(JSON.parse(frontmatterField(md, 'faq_block'))).toEqual(faq)
  })

  it('emits internal_links as JSON that round-trips', () => {
    expect(JSON.parse(frontmatterField(md, 'internal_links'))).toEqual(links)
  })

  it('emits eeat_signals as JSON that round-trips', () => {
    expect(JSON.parse(frontmatterField(md, 'eeat_signals'))).toEqual(eeat)
  })

  it('emits answer_block as a JSON string (colon-safe)', () => {
    expect(JSON.parse(frontmatterField(md, 'answer_block'))).toBe('We file year-round: not just in April.')
  })

  it('defaults missing structured fields to empty JSON (no undefined in YAML)', () => {
    const bare = buildPageMarkdown(makePage({}), 'Firm', { websiteUrl: 'https://x.com' })
    expect(JSON.parse(frontmatterField(bare, 'faq_block'))).toEqual([])
    expect(JSON.parse(frontmatterField(bare, 'internal_links'))).toEqual([])
    expect(JSON.parse(frontmatterField(bare, 'answer_block'))).toBe('')
  })

  it('still includes the human-readable review trailer', () => {
    expect(md).toContain('## SEO & AIO Metadata')
  })
})

describe('buildPageMarkdown — hero headline', () => {
  it('promotes the first content heading into hero_headline for image heroes', () => {
    const out = buildPageMarkdown(
      makePage({
        hero_block: 'hero',
        hero_variant: 'image',
        content_markdown: '<!-- block: intro-text | variant: centered -->\n## Year-Round Advisory, Not Just April Deadlines\n\nBody.',
      }),
      'Firm',
      { websiteUrl: 'https://x.com' }
    )
    expect(JSON.parse(frontmatterField(out, 'hero_headline'))).toBe(
      'Year-Round Advisory, Not Just April Deadlines'
    )
  })

  it('does not emit hero_headline for page-header heroes (page title is correct there)', () => {
    const out = buildPageMarkdown(makePage({ hero_block: 'page-header' }), 'Firm', {
      websiteUrl: 'https://x.com',
    })
    expect(out).not.toMatch(/^hero_headline:/m)
  })
})
