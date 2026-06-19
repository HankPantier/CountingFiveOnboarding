import { describe, expect, it } from 'vitest'
import { splitTrailers, parseFaqFromBody, setFaqAccordionBody } from './page-body'

const CONTENT = `<!-- block: intro-text -->
## Welcome

Prose here.

<!-- block: faq-accordion -->
## Frequently Asked Questions

**Q: First question?**
A: First answer.

**Q: Second question?**
A: Second answer.`

const TRAILER = `\n---\n## SEO & AIO Metadata\n\n**FAQ Block:**\nstuff\n\n---\n## Structured Data — paste into \`<head>\`\n\n\`\`\`html\n<script type="application/ld+json">{}</script>\n\`\`\`\n`

describe('splitTrailers', () => {
  it('splits content from the SEO/Structured-Data trailer and round-trips', () => {
    const body = CONTENT + TRAILER
    const { content, trailer } = splitTrailers(body)
    expect(content).toBe(CONTENT)
    expect(trailer).toBe(TRAILER)
    expect(content + trailer).toBe(body)
  })

  it('returns empty trailer when there is none', () => {
    const { content, trailer } = splitTrailers(CONTENT)
    expect(content).toBe(CONTENT)
    expect(trailer).toBe('')
  })

  it('splits on a lone Structured Data marker too', () => {
    const body = `${CONTENT}\n---\n## Structured Data\n\n\`\`\`html\n<script></script>\n\`\`\`\n`
    const { content } = splitTrailers(body)
    expect(content).toBe(CONTENT)
  })
})

describe('parseFaqFromBody', () => {
  it('extracts Q&A pairs from the faq-accordion prose', () => {
    expect(parseFaqFromBody(CONTENT)).toEqual([
      { question: 'First question?', answer: 'First answer.' },
      { question: 'Second question?', answer: 'Second answer.' },
    ])
  })
})

describe('setFaqAccordionBody', () => {
  it('rewrites the existing faq-accordion prose, preserving heading + marker', () => {
    const next = setFaqAccordionBody(CONTENT, [{ question: 'New Q?', answer: 'New A.' }], 'FAQ')
    expect(next).toContain('<!-- block: faq-accordion -->')
    expect(next).toContain('## Frequently Asked Questions')
    expect(next).toContain('**Q: New Q?**\nA: New A.')
    expect(next).not.toContain('First question?')
    expect(parseFaqFromBody(next)).toEqual([{ question: 'New Q?', answer: 'New A.' }])
  })

  it('removes the faq-accordion block when items are emptied', () => {
    const next = setFaqAccordionBody(CONTENT, [], 'FAQ')
    expect(next).not.toContain('faq-accordion')
    expect(next).toContain('## Welcome')
  })

  it('appends a faq-accordion block when none exists', () => {
    const plain = '<!-- block: intro-text -->\n## Welcome\n\nProse.'
    const next = setFaqAccordionBody(plain, [{ question: 'Q?', answer: 'A.' }], 'FAQ')
    expect(next).toContain('<!-- block: faq-accordion -->')
    expect(next).toContain('## FAQ')
    expect(next).toContain('**Q: Q?**\nA: A.')
  })
})
