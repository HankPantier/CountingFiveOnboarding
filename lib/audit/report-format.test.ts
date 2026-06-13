import { describe, expect, it } from 'vitest'
import { safeHref } from './report-format'

describe('safeHref', () => {
  it('passes through http/https URLs', () => {
    expect(safeHref('https://example.com/path')).toBe('https://example.com/path')
    expect(safeHref('http://example.com')).toBe('http://example.com')
  })

  it('neutralizes javascript: and other dangerous schemes', () => {
    expect(safeHref('javascript:alert(document.cookie)')).toBe('#')
    expect(safeHref('JavaScript:alert(1)')).toBe('#')
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBe('#')
    expect(safeHref('vbscript:msgbox(1)')).toBe('#')
    expect(safeHref('not a url')).toBe('#')
  })
})
