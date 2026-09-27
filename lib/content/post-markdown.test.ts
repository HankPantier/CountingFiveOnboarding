import { describe, expect, it } from 'vitest'
import { buildPostMarkdown } from './post-markdown'

const fm = {
  title: 'T',
  excerpt: 'E',
  meta_title: 'M',
  meta_description: 'D',
  target_keyword: 'k',
  secondary_keywords: [],
  answer_block: 'A',
  schema_markup: 'BlogPosting',
  tags: [],
  image_alt: null,
}

describe('buildPostMarkdown', () => {
  const base = {
    fm,
    slug: 's',
    date: '2026-09-27',
    contentType: 'blog' as const,
    author: null,
    canonicalUrl: '/resources/s',
    heroImage: null,
  }

  it('never writes generator notes into a post body', () => {
    const body =
      '## Plan early\n\nProse.\n\n---\n## SEO & AIO Metadata\n\n**Answer Block:**\nA\n\n**Internal Links:**\n- x → /y — z\n'
    const md = buildPostMarkdown({ ...base, body })
    expect(md).not.toContain('SEO & AIO Metadata')
    expect(md).not.toContain('**Internal Links:**')
    expect(md.endsWith('## Plan early\n\nProse.\n')).toBe(true)
  })

  it('leaves a clean body untouched', () => {
    const body = '## Plan early\n\nProse.\n\n## Related links\n\n- [Tax](/services/tax)\n'
    expect(buildPostMarkdown({ ...base, body }).endsWith(body)).toBe(true)
  })
})
