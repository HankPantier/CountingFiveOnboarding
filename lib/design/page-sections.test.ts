import { describe, it, expect } from 'vitest'
import { pageContentPath, parsePageSections } from './page-sections'

describe('page sections', () => {
  it('maps the page path to its draft markdown', () => {
    expect(pageContentPath('/')).toBe('content/pages/home.md')
    expect(pageContentPath('/services/tax')).toBe('content/pages/services--tax.md')
  })

  it('reads heading → block id from the template section annotations (unknown blocks skipped)', () => {
    const md = [
      '---',
      'title: Home',
      '---',
      '<!-- block: service-cards | variant: grid -->',
      '## What we do',
      'Cards…',
      '',
      '<!-- block: not-a-block -->',
      '## Ignored',
      'x',
      '',
      '<!-- block: cta-banner -->',
      '## **Ready** to talk?',
      'Call us.',
      '',
    ].join('\n')
    expect(parsePageSections(md)).toEqual([
      { heading: 'What we do', block: 'service-cards' },
      { heading: 'Ready to talk?', block: 'cta-banner' },
    ])
  })
})
