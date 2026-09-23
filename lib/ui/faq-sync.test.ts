import { describe, it, expect } from 'vitest'
import { faqSignature, isExternalFaqChange } from './faq-sync'

const a = { question: 'Q1', answer: 'A1' }
const b = { question: 'Q2', answer: 'A2' }
const blank = { question: '', answer: '' }

describe('faq-sync', () => {
  it('ignores blank rows in the signature', () => {
    expect(faqSignature([a, blank])).toBe(faqSignature([a]))
  })

  it('treats our own echo (blank rows dropped) as not external', () => {
    const local = [a, blank]
    const seen = faqSignature([])
    expect(isExternalFaqChange([a], seen, local)).toBe(false)
  })

  it('detects an external change that differs from the buffer', () => {
    const local = [a]
    const seen = faqSignature([a])
    expect(isExternalFaqChange([a, b], seen, local)).toBe(true)
  })

  it('does nothing when the props did not change', () => {
    const local = [a, { question: 'typing…', answer: '' }]
    const seen = faqSignature([a])
    expect(isExternalFaqChange([a], seen, local)).toBe(false)
  })
})
