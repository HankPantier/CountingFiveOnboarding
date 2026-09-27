import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findGeneratorNotes,
  parseGeneratorNotes,
  repairPageTrailer,
  stripGeneratorNotesFromBody,
  stripGeneratorNotesFromFile,
} from './strip-generator-notes'

// Trimmed real files from the client repos (Accord Advisors, 2026-09-27).
const FIX = path.join(__dirname, '__fixtures__', 'leaked-generator-notes')
const POST = readFileSync(path.join(FIX, 'accord-year-end-cheer.post.md'), 'utf8')
const ORPHAN_PAGE = readFileSync(path.join(FIX, 'accord-services.orphan-structured.page.md'), 'utf8')

function frontmatterOf(s: string): string {
  return s.slice(0, s.indexOf('\n---\n', 4) + 5)
}

describe('stripGeneratorNotesFromFile — real leaked post (page moved into content/posts)', () => {
  const res = stripGeneratorNotesFromFile(POST)

  it('cuts both trailers and every label', () => {
    expect(res.changed).toBe(true)
    for (const s of ['SEO & AIO Metadata', '**Internal Links:**', '**FAQ Block:**', '**Answer Block:**', '**E-E-A-T Signals:**', '**LLM Citation Note:**', 'Structured Data', 'application/ld+json']) {
      expect(res.content).not.toContain(s)
    }
    expect(res.removed).toEqual([
      'SEO & AIO Metadata',
      'Answer Block',
      'E-E-A-T Signals',
      'Internal Links',
      'FAQ Block',
      'LLM Citation Note',
      'Structured Data',
    ])
  })

  it('keeps the reader-facing body, incl. the on-page FAQ and the final CTA section', () => {
    expect(res.content).toContain('<!-- block: faq-accordion -->')
    expect(res.content).toContain('**Q: What does year end accounting cleanup include?**')
    expect(res.content.trimEnd().endsWith('head into the new year with a plan instead of a pile of receipts.')).toBe(true)
    expect(res.content.endsWith('\n')).toBe(true)
  })

  it('leaves frontmatter byte-identical when every field is already populated', () => {
    expect(res.backfilled).toEqual([])
    expect(frontmatterOf(res.content)).toBe(frontmatterOf(POST))
  })

  it('is idempotent', () => {
    const again = stripGeneratorNotesFromFile(res.content)
    expect(again.changed).toBe(false)
    expect(again.content).toBe(res.content)
  })

  it('backfills an EMPTY structured field from the trailer, never overwriting a set one', () => {
    const emptied = POST.replace(/^internal_links: .*$/m, 'internal_links: []').replace(/^eeat_signals: .*\n/m, '')
    const r = stripGeneratorNotesFromFile(emptied)
    expect(r.backfilled.sort()).toEqual(['eeat_signals', 'internal_links'])
    const fm = frontmatterOf(r.content)
    expect(fm).toContain(
      'internal_links: [{"url":"/services/outsourced-accounting","anchor_text":"outsourced accounting service","reason":"Directly supports the cleanup and reconciliation work described"},'
    )
    expect(fm).toContain('eeat_signals: ["Jared Hammack, CPA, leads year-end tax planning conversations with clients","Nearly 40 years serving healthcare and optometry providers"]')
    // Untouched keys keep their exact bytes.
    expect(fm).toContain(POST.match(/^answer_block: .*$/m)![0])
    expect(r.content.endsWith('---\n')).toBe(false)
  })
})

describe('parseGeneratorNotes', () => {
  it('recovers the structured data from a real trailer', () => {
    const { removedText } = stripGeneratorNotesFromBody(POST)
    const n = parseGeneratorNotes(removedText)
    expect(n.answerBlock).toMatch(/^Year end accounting in Bloomington, IN means/)
    expect(n.eeatSignals).toHaveLength(2)
    expect(n.internalLinks[1]).toEqual({
      url: '/services/business-foundation-services',
      anchor_text: 'Business Foundation Services',
      reason: 'Ties year-end tax planning to the named service line',
    })
    expect(n.faqBlock).toEqual([
      {
        question: 'What does year end accounting cleanup include?',
        answer: expect.stringMatching(/^It includes reconciling bank/) as unknown as string,
      },
    ])
    expect(n.llmCitationNote).toMatch(/^Accord Advisors offers fixed monthly fee/)
  })

  it('treats the generator "None" placeholders as empty', () => {
    const n = parseGeneratorNotes('**E-E-A-T Signals:**\n- None specified\n\n**Internal Links:**\n- None\n\n**FAQ Block:**\n\nNone\n')
    expect(n.eeatSignals).toEqual([])
    expect(n.internalLinks).toEqual([])
    expect(n.faqBlock).toEqual([])
  })
})

describe('stripGeneratorNotesFromBody — shapes', () => {
  it('removes a dash-scrubbed Structured Data trailer on its own', () => {
    const body = 'Intro.\n\n---\n## Structured Data, paste into `<head>`\n\n```html\n<script type="application/ld+json">{}</script>\n```\n'
    expect(stripGeneratorNotesFromBody(body)).toMatchObject({ body: 'Intro.\n', removed: ['Structured Data'] })
  })

  it('removes a heading-less run of generator labels echoed at the end', () => {
    const body = '## Plan ahead\n\nReal prose.\n\n---\n\n**Answer Block:**\nShort answer.\n\n**Internal Links:**\n- tax planning → /services/tax — relevant\n'
    const r = stripGeneratorNotesFromBody(body)
    expect(r.body).toBe('## Plan ahead\n\nReal prose.\n')
    expect(r.removed).toEqual(['Answer Block', 'Internal Links'])
  })

  it('removes the Call to Action line that rides inside the SEO trailer', () => {
    const body = 'Body.\n\n---\n## SEO & AIO Metadata\n\n**Answer Block:**\nx\n\n**Call to Action:** [Book a call](/contact)\n'
    const r = stripGeneratorNotesFromBody(body)
    expect(r.body).toBe('Body.\n')
    expect(r.removed).toContain('Call to Action')
  })
})

describe('negatives — reader-facing prose is never stripped', () => {
  const cases: Array<[string, string]> = [
    [
      'a bold "FAQ" and a reader-facing Related links section',
      '## Year-end checklist\n\nStart early.\n\n**FAQ**\n\n**Q: When should I start?**\nA: October.\n\n## Related links\n\n- [Tax planning](/services/tax-planning)\n- [Payroll](/services/payroll)\n',
    ],
    [
      'a single bold "Internal Links:" label in prose',
      '## Site hygiene\n\nWe audit your site.\n\n**Internal Links:**\nThese help readers find related pages.\n',
    ],
    [
      'labels followed by a real heading (not an end-of-body echo)',
      '**Answer Block:**\nx\n\n**FAQ Block:**\ny\n\n## Our approach\n\nProse.\n',
    ],
    [
      'an ordinary SEO heading after a rule',
      '## Intro\n\nText.\n\n---\n## SEO tips for accounting firms\n\n**Answer Block:** is a term we use.\n',
    ],
    ['a Structured Data heading without the paste-into shape', 'Text.\n\n---\n## Structured data for small firms\n\nProse.\n'],
    [
      'a differently-cased SEO heading (not the generator shape)',
      'Text.\n\n---\n## SEO & AIO metadata for reviewers\n\n**Answer Block:**\nx\n\n## Next\n\nMore.\n',
    ],
    ['a lower-case "seo & aio metadata" heading', 'Text.\n\n---\n## seo & aio metadata\n\nProse.\n'],
  ]
  for (const [name, body] of cases) {
    it(name, () => {
      expect(stripGeneratorNotesFromBody(body).body).toBe(body)
      expect(stripGeneratorNotesFromFile(`---\ntitle: "x"\n---\n${body}`).changed).toBe(false)
    })
  }

  it('findGeneratorNotes ignores one stray label but flags a trailer', () => {
    expect(findGeneratorNotes(cases[1][1])).toEqual([])
    expect(findGeneratorNotes(cases[0][1])).toEqual([])
    expect(findGeneratorNotes(POST)).toEqual(
      expect.arrayContaining(['SEO & AIO Metadata', 'Structured Data', 'Internal Links', 'FAQ Block'])
    )
  })
})

describe('repairPageTrailer — real page whose SEO marker was edited away', () => {
  it('restores the marker in front of the surviving Structured Data block (JSON-LD kept)', () => {
    const r = repairPageTrailer(ORPHAN_PAGE)
    expect(r.changed).toBe(true)
    expect(r.content).toMatch(/\n---\n## SEO & AIO Metadata\n\n---\n## Structured Data, paste into `<head>`/)
    expect(r.content).toContain('application/ld+json')
    expect(frontmatterOf(r.content)).toBe(frontmatterOf(ORPHAN_PAGE))
    expect(repairPageTrailer(r.content)).toEqual({ content: r.content, changed: false })
  })

  it('leaves a canonical page trailer alone', () => {
    // A normal page file: SEO marker first, then Structured Data.
    const page = POST
    expect(repairPageTrailer(page).changed).toBe(false)
  })
})

describe('CRLF files', () => {
  const crlf = (s: string) => s.replace(/\n/g, '\r\n')

  it('strips a CRLF post exactly like its LF twin, frontmatter byte-identical', () => {
    const lf = stripGeneratorNotesFromFile(POST)
    const r = stripGeneratorNotesFromFile(crlf(POST))
    expect(r.changed).toBe(true)
    expect(r.content).toBe(crlf(lf.content))
    expect(r.removed).toEqual(lf.removed)
    expect(stripGeneratorNotesFromFile(r.content).changed).toBe(false)
  })

  it('backfills into CRLF frontmatter with CRLF line endings', () => {
    const r = stripGeneratorNotesFromFile(crlf(POST.replace(/^internal_links: .*$/m, 'internal_links: []')))
    expect(r.backfilled).toEqual(['internal_links'])
    expect(r.content).toMatch(/\r\ninternal_links: \[\{"url":"\/services\/outsourced-accounting"/)
    expect(r.content.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('parses CRLF trailer sections', () => {
    const n = parseGeneratorNotes(crlf(stripGeneratorNotesFromBody(POST).removedText))
    expect(n.internalLinks).toHaveLength(2)
    expect(n.faqBlock).toHaveLength(1)
    expect(n.answerBlock).not.toContain('\r')
  })

  it('repairs a CRLF orphan page with CRLF line endings', () => {
    const r = repairPageTrailer(crlf(ORPHAN_PAGE))
    expect(r.content).toBe(crlf(repairPageTrailer(ORPHAN_PAGE).content))
  })
})

describe('trailer whose "## SEO & AIO Metadata" line alone was deleted', () => {
  // Same real trailer, heading line removed: a bare label run followed only by
  // the Structured Data block.
  const HEADLESS = POST.replace('## SEO & AIO Metadata\n', '')

  it('post strip cuts the label run AND the Structured Data block, and reports both', () => {
    const r = stripGeneratorNotesFromFile(HEADLESS)
    expect(r.changed).toBe(true)
    expect(r.content).toBe(stripGeneratorNotesFromFile(POST).content)
    expect(r.removed).toEqual([
      'Answer Block',
      'E-E-A-T Signals',
      'Internal Links',
      'FAQ Block',
      'LLM Citation Note',
      'Structured Data',
    ])
  })

  it('findGeneratorNotes sees it', () => {
    expect(findGeneratorNotes(HEADLESS)).toEqual(
      expect.arrayContaining(['Structured Data', 'Answer Block', 'Internal Links'])
    )
  })

  it('page repair puts the marker back BEFORE the label run, not before Structured Data', () => {
    const r = repairPageTrailer(HEADLESS)
    expect(r.changed).toBe(true)
    expect(r.content).toBe(POST)
    expect(repairPageTrailer(r.content).changed).toBe(false)
  })

  it('page repair also covers a bare label run with no Structured Data block', () => {
    const page =
      '---\ntitle: "x"\n---\n\n## Body\n\nProse.\n\n**Answer Block:**\nA.\n\n**Internal Links:**\n- a → /b — c\n'
    expect(repairPageTrailer(page).content).toBe(
      '---\ntitle: "x"\n---\n\n## Body\n\nProse.\n\n---\n## SEO & AIO Metadata\n\n**Answer Block:**\nA.\n\n**Internal Links:**\n- a → /b — c\n'
    )
  })
})

describe('refuses to cut when real content follows the trailer', () => {
  it('returns a warning and leaves the file untouched', () => {
    const appended = `${POST}\n## A section someone added after the trailer\n\nReal copy.\n`
    const r = stripGeneratorNotesFromFile(appended)
    expect(r.changed).toBe(false)
    expect(r.content).toBe(appended)
    expect(r.warning).toMatch(/not removed.*## A section someone added after the trailer/)
    expect(stripGeneratorNotesFromBody(appended).body).toBe(appended)
  })

  it('ignores "#" lines inside fenced code (the JSON-LD block) and the two trailer headings', () => {
    const withFence = POST.replace('```html\n', '```html\n# not a heading\n')
    const r = stripGeneratorNotesFromFile(withFence)
    expect(r.changed).toBe(true)
    expect(r.warning).toBeUndefined()
  })
})
