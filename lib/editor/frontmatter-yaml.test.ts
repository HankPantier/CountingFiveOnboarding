import { describe, expect, it } from 'vitest'
import { validateFrontmatterYaml } from './frontmatter-yaml'

describe('validateFrontmatterYaml — commit-time YAML safety net', () => {
  it('rejects an unquoted title containing a colon-and-space (the deploy-breaker)', () => {
    // Exactly the shape that broke the Slachta build: js-yaml reads the second
    // colon as a nested mapping. Our lenient custom parser would accept it, so
    // this guard is what actually catches it before commit.
    const file = `---\ntitle: Auto Leasing vs. Buying: Which Makes More Sense?\nslug: x\n---\nBody`
    const err = validateFrontmatterYaml(file)
    expect(err).not.toBeNull()
    expect(err).toMatch(/invalid YAML frontmatter/i)
  })

  it('accepts the same title once it is double-quoted', () => {
    const file = `---\ntitle: "Auto Leasing vs. Buying: Which Makes More Sense?"\nslug: x\n---\nBody`
    expect(validateFrontmatterYaml(file)).toBeNull()
  })

  it('accepts a title with a colon-space that lives inside quotes only', () => {
    const file = `---\nmeta_title: "Lease vs Buy a Car: A CPA's Framework | Slachta CPA"\n---\nBody`
    expect(validateFrontmatterYaml(file)).toBeNull()
  })

  it('accepts a bare scalar inline array (secondary_keywords)', () => {
    const file = `---\nsecondary_keywords: [cpa firm, tax planning, bookkeeping]\n---\nBody`
    expect(validateFrontmatterYaml(file)).toBeNull()
  })

  it('accepts a JSON array-of-objects field (faq_block)', () => {
    const faq = '[{"question":"Q1, with comma","answer":"A1"}]'
    const file = `---\ntitle: Services\nfaq_block: ${faq}\n---\nBody`
    expect(validateFrontmatterYaml(file)).toBeNull()
  })

  it('is a no-op for a file with no frontmatter', () => {
    expect(validateFrontmatterYaml('Just a body, no fence.')).toBeNull()
  })
})
