import { describe, expect, it } from 'vitest'
import { sanitizeSvg } from './sanitize-svg'

describe('sanitizeSvg', () => {
  it('strips <script> but keeps shapes', () => {
    const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect fill="#f00"/></svg>')
    expect(out).not.toBeNull()
    expect(out!.toLowerCase()).not.toContain('<script')
    expect(out!.toLowerCase()).toContain('<rect')
  })

  it('strips event-handler attributes', () => {
    const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)" fill="#f00"/></svg>')
    expect(out).not.toBeNull()
    expect(out!.toLowerCase()).not.toContain('onload')
  })

  it('returns null for non-SVG input', () => {
    expect(sanitizeSvg('<p>hello</p>')).toBeNull()
    expect(sanitizeSvg('just text')).toBeNull()
  })
})
