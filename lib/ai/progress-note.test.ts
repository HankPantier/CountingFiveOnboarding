import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { latestProgressNote } from './progress-note'

const assistant = (parts: UIMessage['parts']): UIMessage => ({ id: 'a', role: 'assistant', parts })
const user: UIMessage = { id: 'u', role: 'user', parts: [{ type: 'text', text: 'hi' }] }

describe('latestProgressNote', () => {
  it('returns the last paragraph of the newest reasoning part', () => {
    const m = assistant([
      { type: 'reasoning', text: 'Old note.' },
      { type: 'text', text: 'Reading the page.' },
      { type: 'reasoning', text: 'I reviewed the profile.\n\nNow tightening the   first two\nparagraphs.' },
    ])
    expect(latestProgressNote([user, m])).toBe('Now tightening the first two paragraphs.')
  })

  it('returns null when the newest message is the user turn', () => {
    expect(latestProgressNote([assistant([{ type: 'reasoning', text: 'x' }]), user])).toBeNull()
  })

  it('returns null when the reply has no reasoning, or only empty reasoning', () => {
    expect(latestProgressNote([user, assistant([{ type: 'text', text: 'Done.' }])])).toBeNull()
    expect(latestProgressNote([user, assistant([{ type: 'reasoning', text: '  \n ' }])])).toBeNull()
  })

  it('truncates long notes at a word boundary', () => {
    const note = latestProgressNote([user, assistant([{ type: 'reasoning', text: 'word '.repeat(80) }])])!
    expect(note.length).toBeLessThanOrEqual(201)
    expect(note.endsWith('word…')).toBe(true)
  })
})
