import { describe, expect, it } from 'vitest'
import { validateContent, humanizeDashes, cleanHeading, sanitizeGeneratedText } from './anti-slop-validator'
import { stripGeneratorNotesFromBody } from './strip-generator-notes'

const CLEAN = `## Tax planning for medical practices

We help dental and medical practices in Tyngsborough cut their effective rate. Ron Lague holds the PFS designation and has filed 200 returns this season.

## How a CPA saves you money

A good CPA finds the deductions you miss. We show you the number before you sign.`

describe('validateContent — existing rules still pass clean copy', () => {
  it('passes on-brand, specific copy', () => {
    const { passed, flagged } = validateContent(CLEAN)
    expect(flagged).toEqual([])
    expect(passed).toBe(true)
  })
})

describe('validateContent — global no-go phrases', () => {
  it('flags a no-go phrase (case-insensitive) when supplied', () => {
    const { passed, flagged } = validateContent(
      `${CLEAN}\n\nStop bringing us Receipts In A Shoebox.`,
      ['receipts in a shoebox']
    )
    expect(passed).toBe(false)
    expect(flagged.join(' ')).toMatch(/no-go phrase/i)
    expect(flagged.join(' ')).toMatch(/receipts in a shoebox/i)
  })

  it('does not flag clean copy when no-go phrases are supplied', () => {
    const { passed, flagged } = validateContent(CLEAN, ['receipts in a shoebox'])
    expect(flagged).toEqual([])
    expect(passed).toBe(true)
  })

  it('defaults to no extra phrases (back-compatible signature)', () => {
    const { passed } = validateContent('Bring us receipts in a shoebox anytime, we sort it.')
    // The no-go phrase is only enforced when the list is passed in.
    expect(passed).toBe(true)
  })
})

describe('validateContent — heading tells', () => {
  it('flags the regression heading', () => {
    const { passed, flagged } = validateContent(
      '## What the Structures Actually Mean (Beyond the Buzzwords)\n\nProse.'
    )
    expect(passed).toBe(false)
    expect(flagged.join(' ')).toMatch(/parenthetical subtitle/i)
  })

  it('flags a colon-cliché subtitle', () => {
    const { flagged } = validateContent('## Entity selection: a complete guide\n\nProse.')
    expect(flagged.join(' ')).toMatch(/cliché subtitle/i)
  })

  it('flags a formulaic "the importance of" heading', () => {
    const { flagged } = validateContent('## The importance of bookkeeping\n\nProse.')
    expect(flagged.join(' ')).toMatch(/formulaic heading/i)
  })

  it('flags a listicle heading', () => {
    const { flagged } = validateContent('## 5 reasons to hire a CPA\n\nProse.')
    expect(flagged.join(' ')).toMatch(/listicle heading/i)
  })

  it('flags a bare "actually" filler heading', () => {
    const { flagged } = validateContent('## Built for the way you actually run a business\n\nProse.')
    expect(flagged.join(' ')).toMatch(/filler word in heading/i)
  })

  it('does not treat a ## inside a code fence as a heading', () => {
    const md = '```\n## 5 reasons this is code\n```\n\nReal prose with a number: 5 offices.'
    expect(validateContent(md).passed).toBe(true)
  })
})

describe('validateContent — prose tells', () => {
  it('flags negative parallelism', () => {
    const { flagged } = validateContent("Bookkeeping is not just data entry, it's the backbone of decisions.")
    expect(flagged.join(' ')).toMatch(/negative parallelism/i)
  })

  it('flags copula avoidance', () => {
    const { flagged } = validateContent('Our CFO service serves as a growth lever for clients.')
    expect(flagged.join(' ')).toMatch(/copula avoidance/i)
  })

  it('flags signposting tropes', () => {
    const { flagged } = validateContent("When it comes to tax season, preparation matters.")
    expect(flagged.join(' ')).toMatch(/signposting/i)
  })
})

describe('humanizeDashes', () => {
  it('converts spaced em-dashes to commas', () => {
    expect(humanizeDashes('We file fast — and accurately — every quarter.')).toBe(
      'We file fast, and accurately, every quarter.'
    )
  })

  it('converts bare em-dashes between words', () => {
    expect(humanizeDashes('proactive—not reactive')).toBe('proactive, not reactive')
  })

  it('converts word en-dashes but preserves numeric ranges', () => {
    expect(humanizeDashes('open Monday–Friday')).toBe('open Monday, Friday')
    expect(humanizeDashes('600–1200 words, 9–5 hours')).toBe('600–1200 words, 9–5 hours')
  })

  it('leaves fenced code untouched', () => {
    const md = 'Prose — here.\n```\nconst a = b — c\n```'
    expect(humanizeDashes(md)).toBe('Prose, here.\n```\nconst a = b — c\n```')
  })

  it('does not corrupt standalone numbers surrounded by spaces', () => {
    expect(humanizeDashes('We have 5 offices and 12 staff.')).toBe('We have 5 offices and 12 staff.')
  })
})

describe('sanitizeGeneratedText — shared output choke point', () => {
  it('strips em-dashes like humanizeDashes', () => {
    expect(sanitizeGeneratedText('We file fast — and accurately.')).toBe('We file fast, and accurately.')
  })

  it('preserves numeric ranges and fenced code', () => {
    const md = 'Hours 9–5 today — call us.\n```\na — b\n```'
    expect(sanitizeGeneratedText(md)).toBe('Hours 9–5 today, call us.\n```\na — b\n```')
  })
})

describe('cleanHeading', () => {
  it('strips a trailing parenthetical subtitle and normalizes dashes', () => {
    expect(cleanHeading('What the Structures Actually Mean (Beyond the Buzzwords)')).toBe(
      'What the Structures Actually Mean'
    )
    expect(cleanHeading('Tax planning — for practices')).toBe('Tax planning, for practices')
  })
})

describe('validateContent — generator notes in the body', () => {
  it('flags an SEO & AIO trailer echoed into the body', () => {
    const body = `${CLEAN}\n\n---\n## SEO & AIO Metadata\n\n**Answer Block:**\nx\n\n**Internal Links:**\n- a → /b — c\n`
    const r = validateContent(body)
    expect(r.passed).toBe(false)
    expect(r.flagged.some((f) => f.startsWith('Generator notes in the body (SEO & AIO Metadata'))).toBe(true)
  })

  it('generators strip first: a stripped body is not flagged; only a refused strip still is', () => {
    const trailer = `\n\n---\n## SEO & AIO Metadata\n\n**Answer Block:**\nx\n\n**Internal Links:**\n- a → /b — c\n`
    const cleaned = stripGeneratorNotesFromBody(`${CLEAN}${trailer}`).body
    expect(validateContent(cleaned).flagged.some((f) => f.startsWith('Generator notes'))).toBe(false)
    const refused = `${CLEAN}${trailer}\n## Added after the notes\n\nCopy.\n`
    expect(stripGeneratorNotesFromBody(refused).warning).toBeDefined()
    expect(validateContent(stripGeneratorNotesFromBody(refused).body).flagged.some((f) => f.startsWith('Generator notes'))).toBe(true)
  })

  it('does not flag a reader-facing FAQ or Related links section', () => {
    const body = `${CLEAN}\n\n## Common questions\n\n**Q: When should I file?**\nA: By April 15.\n\n## Related links\n\n- [Payroll](/services/payroll)\n`
    expect(validateContent(body).flagged.some((f) => f.startsWith('Generator notes'))).toBe(false)
  })
})
