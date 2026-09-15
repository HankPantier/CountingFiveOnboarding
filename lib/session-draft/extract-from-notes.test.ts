import { describe, expect, it } from 'vitest'
import { mergeNotesExtraction, validateNotesModel } from './extract-from-notes'
import type { SessionSchema } from '@/types/session-schema'
import type { GapItem } from '@/types/gap-item'

describe('validateNotesModel', () => {
  it('coerces a loose payload and drops non-strings', () => {
    const model = validateNotesModel({
      contact: { firstName: '  Ada ', email: 42 },
      business: { name: 'Acme CPA', idealClients: ['contractors', 7, 'nonprofits'] },
      services: [{ name: 'Tax', description: 'x', offerings: ['1040'] }, { name: 42 }],
      brand: { toneAdjectives: ['warm', ''] },
    })
    expect(model).not.toBeNull()
    expect(model!.contact!.firstName).toBe('Ada')
    expect(model!.contact!.email).toBe('') // number dropped
    expect(model!.business!.idealClients).toEqual(['contractors', 'nonprofits'])
    expect(model!.brand!.toneAdjectives).toEqual(['warm']) // blank dropped
  })

  it('returns null for a non-object', () => {
    expect(validateNotesModel('nope')).toBeNull()
  })
})

describe('mergeNotesExtraction — non-destructive fill', () => {
  it('fills blank scalar fields but never overwrites existing values', () => {
    const schema: SessionSchema = {
      business: { name: 'Existing Firm', tagline: '', differentiators: 'Set by audit' },
      contact: { firstName: '', lastName: '', email: '', phone: '' },
    } as SessionSchema
    const { schema: merged, applied } = mergeNotesExtraction(schema, [], {
      business: { name: 'Notes Name', tagline: 'From notes', differentiators: 'From notes' },
      contact: { firstName: 'Ada', email: 'ada@x.com' },
    })
    const b = (merged.business as Record<string, unknown>)
    expect(b.name).toBe('Existing Firm') // NOT overwritten
    expect(b.differentiators).toBe('Set by audit') // NOT overwritten
    expect(b.tagline).toBe('From notes') // blank → filled
    expect((merged.contact as Record<string, unknown>).firstName).toBe('Ada')
    const paths = applied.map((a) => a.path)
    expect(paths).toContain('business.tagline')
    expect(paths).toContain('contact.firstName')
    expect(paths).not.toContain('business.name')
    expect(paths).not.toContain('business.differentiators')
  })

  it('only adds object arrays when the current array is empty', () => {
    const withServices: SessionSchema = {
      services: [{ name: 'Existing', description: '', offerings: [] }],
    } as SessionSchema
    const r1 = mergeNotesExtraction(withServices, [], { services: [{ name: 'New', description: 'd' }] })
    expect((r1.schema.services as unknown[]).length).toBe(1)
    expect((r1.schema.services as Array<{ name: string }>)[0].name).toBe('Existing')
    expect(r1.applied.map((a) => a.path)).not.toContain('services')

    const empty: SessionSchema = { services: [] } as SessionSchema
    const r2 = mergeNotesExtraction(empty, [], { services: [{ name: 'New', description: 'd' }] })
    expect((r2.schema.services as Array<{ name: string }>)[0].name).toBe('New')
    expect(r2.applied.map((a) => a.path)).toContain('services')
  })

  it('fills structured service areas and target keywords when blank', () => {
    const schema: SessionSchema = { business: { name: 'Firm' } } as SessionSchema
    const { schema: merged, applied } = mergeNotesExtraction(schema, [], {
      business: {
        serviceAreas: [{ city: 'Bel Air', county: 'Harford County', state: 'MD' }, { county: 'Baltimore County' }],
        targetKeywords: ['bel air cpa', 'harford county tax'],
      },
    })
    const b = merged.business as Record<string, unknown>
    expect(b.serviceAreas).toEqual([
      { city: 'Bel Air', county: 'Harford County', state: 'MD' },
      { city: '', county: 'Baltimore County' },
    ])
    expect(b.targetKeywords).toEqual(['bel air cpa', 'harford county tax'])
    expect(applied.map((a) => a.path)).toEqual(
      expect.arrayContaining(['business.serviceAreas', 'business.targetKeywords'])
    )
  })

  it('carries niche persona fields when niches come from the notes', () => {
    const empty: SessionSchema = { niches: [] } as SessionSchema
    const { schema: merged } = mergeNotesExtraction(empty, [], {
      niches: [{ name: 'Dentists', description: 'Dental practices', revenueBand: '$1–5M', decisionMaker: 'owner' }],
    })
    const n = (merged.niches as Array<Record<string, unknown>>)[0]
    expect(n).toMatchObject({ name: 'Dentists', revenueBand: '$1–5M', decisionMaker: 'owner' })
  })

  it('blank-fills per-niche audience depth on EXISTING niches, matched by name', () => {
    // Audit-seeded niches (name + description only). A re-mine must reach their
    // depth fields even though the all-or-nothing niches candidate is skipped.
    const schema: SessionSchema = {
      niches: [
        { name: 'Dental practices', description: 'DDS-owned', icp: '', painPoints: '', valueProp: 'existing value' },
        { name: 'Nonprofits', description: '', icp: '', painPoints: '', valueProp: '' },
      ],
    } as SessionSchema
    const gaps: GapItem[] = [
      { field: 'niches[0].customerTrigger', label: 'Dental — buying trigger', phase: 4, tier: 1, resolved: false },
      { field: 'niches[0].valueProp', label: 'Dental — value prop', phase: 4, tier: 1, resolved: false },
      { field: 'niches[1].keywords', label: 'Nonprofits — keywords', phase: 4, tier: 2, resolved: false },
    ]
    const { schema: merged, gaps: mergedGaps, applied } = mergeNotesExtraction(schema, gaps, {
      niches: [
        { name: 'dental practices', valueProp: 'should NOT overwrite', customerTrigger: 'opening a 2nd office', decisionMaker: 'owner (DDS)' },
        { name: 'Nonprofits', keywords: ['nonprofit cpa', 'form 990'] },
        { name: 'Unmatched niche', customerTrigger: 'ignored' },
      ],
    })
    const niches = merged.niches as Array<Record<string, unknown>>
    // Existing niche depth blank-filled, but a set value is never clobbered.
    expect(niches[0].customerTrigger).toBe('opening a 2nd office')
    expect(niches[0].decisionMaker).toBe('owner (DDS)')
    expect(niches[0].valueProp).toBe('existing value') // NOT overwritten
    expect(niches[1].keywords).toEqual(['nonprofit cpa', 'form 990'])
    // A notes niche that matches no existing niche adds nothing (no new niche).
    expect(niches).toHaveLength(2)
    // Gaps resolve via the bracketed niches[i] path (a newly-filled field, and
    // a field that was already filled, both resolve).
    expect(mergedGaps.find((g) => g.field === 'niches[0].customerTrigger')!.resolved).toBe(true)
    expect(mergedGaps.find((g) => g.field === 'niches[1].keywords')!.resolved).toBe(true)
    expect(mergedGaps.find((g) => g.field === 'niches[0].valueProp')!.resolved).toBe(true)
    expect(applied.map((a) => a.path)).toEqual(
      expect.arrayContaining(['niches[0].customerTrigger', 'niches[0].decisionMaker', 'niches[1].keywords']),
    )
  })

  it('captures content emphasis and exclusion directives from the notes', () => {
    const model = validateNotesModel({
      business: {
        name: 'Firm',
        contentEmphasis: ['nonprofits', 7, 'dental'],
        contentExclusions: ['real estate', '', 'crypto'],
      },
    })
    expect(model!.business!.contentEmphasis).toEqual(['nonprofits', 'dental'])
    expect(model!.business!.contentExclusions).toEqual(['real estate', 'crypto'])

    const empty: SessionSchema = { business: { name: 'Firm' } } as SessionSchema
    const { schema: merged, applied } = mergeNotesExtraction(empty, [], model!)
    const b = merged.business as Record<string, unknown>
    expect(b.contentExclusions).toEqual(['real estate', 'crypto'])
    expect(b.contentEmphasis).toEqual(['nonprofits', 'dental'])
    expect(applied.map((a) => a.path)).toEqual(
      expect.arrayContaining(['business.contentEmphasis', 'business.contentExclusions'])
    )
  })

  it('appends freeform additionalNotes to additional.otherDetails without duplicating', () => {
    const empty: SessionSchema = { business: { name: 'Firm' } } as SessionSchema
    const first = mergeNotesExtraction(empty, [], { additionalNotes: 'Founder races vintage cars; sponsors a local little league.' })
    expect((first.schema.additional as Record<string, unknown>).otherDetails)
      .toBe('Founder races vintage cars; sponsors a local little league.')
    expect(first.applied.map((a) => a.path)).toContain('additional.otherDetails')

    // A second, different note appends (does not overwrite).
    const second = mergeNotesExtraction(first.schema, [], { additionalNotes: 'Office moving to a new building in 2027.' })
    const details = (second.schema.additional as Record<string, unknown>).otherDetails as string
    expect(details).toContain('vintage cars')
    expect(details).toContain('new building in 2027')

    // Re-running the same note is a no-op (dedup guard) and not re-flagged.
    const third = mergeNotesExtraction(second.schema, [], { additionalNotes: 'Office moving to a new building in 2027.' })
    expect((third.schema.additional as Record<string, unknown>).otherDetails).toBe(details)
    expect(third.applied.map((a) => a.path)).not.toContain('additional.otherDetails')
  })

  it('validateNotesModel coerces additionalNotes and drops a non-string', () => {
    expect(validateNotesModel({ additionalNotes: '  keep this  ' })!.additionalNotes).toBe('keep this')
    expect(validateNotesModel({ additionalNotes: 42 })!.additionalNotes).toBe('')
  })

  it('resolves a gap once its field is filled from the notes', () => {
    const schema: SessionSchema = { business: { foundingYear: '' } } as SessionSchema
    const gaps: GapItem[] = [
      { field: 'business.foundingYear', label: 'Founding year', phase: 4, tier: 1, resolved: false },
      { field: 'business.growthGoals', label: 'Growth goals', phase: 4, tier: 2, resolved: false },
    ]
    const { gaps: merged } = mergeNotesExtraction(schema, gaps, { business: { foundingYear: '1998' } })
    expect(merged.find((g) => g.field === 'business.foundingYear')!.resolved).toBe(true)
    expect(merged.find((g) => g.field === 'business.growthGoals')!.resolved).toBe(false)
  })
})
