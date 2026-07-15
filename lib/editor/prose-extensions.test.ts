// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildProseExtensions } from './prose-extensions'

// Instantiate a real TipTap editor with the shipped config and confirm the
// toolbar-supported markdown constructs survive a parse → serialize round-trip.
// This is the riskiest part of the WYSIWYG (structural markdown is protected by
// the segment scanner; prose is only safe if it round-trips faithfully).
function roundTrip(markdown: string): string {
  const editor = new Editor({ extensions: buildProseExtensions(), content: markdown })
  const storage = editor.storage as unknown as { markdown: { getMarkdown(): string } }
  const out = storage.markdown.getMarkdown()
  editor.destroy()
  return out
}

describe('prose markdown round-trip (shipped editor config)', () => {
  it('preserves bold and italic', () => {
    expect(roundTrip('Text with **bold** and *italic* words.')).toBe(
      'Text with **bold** and *italic* words.'
    )
  })

  it('preserves links', () => {
    expect(roundTrip('See [our services](/services) today.')).toBe(
      'See [our services](/services) today.'
    )
  })

  it('preserves H2 and H3 headings', () => {
    expect(roundTrip('## About Us\n\n### Our Story')).toBe('## About Us\n\n### Our Story')
  })

  it('preserves bullet and ordered lists', () => {
    expect(roundTrip('- one\n- two')).toBe('- one\n- two')
    expect(roundTrip('1. first\n2. second')).toBe('1. first\n2. second')
  })

  it('preserves a mixed heading + paragraph + list body', () => {
    const md = '## Services\n\nWe help with **taxes**.\n\n- Planning\n- Filing'
    expect(roundTrip(md)).toBe(md)
  })
})
