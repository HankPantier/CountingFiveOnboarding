import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

// Source-level guards for the theme chat route (a full route test would need
// the auth, GitHub and model layers mocked end to end).
const src = readFileSync(path.join(__dirname, 'route.ts'), 'utf8')

describe('theme chat route — source guards', () => {
  it('never statically imports the lightningcss-backed sanitizer', () => {
    // A static import would make a missing native binary break the whole
    // chat, not just set_block_override.
    expect(src).not.toMatch(/^import[^\n]*['"]@\/lib\/design\/css-sanitizer['"]/m)
    expect(src).toMatch(/await import\(['"]@\/lib\/design\/css-sanitizer['"]\)/)
  })

  it('tells the model the sanitizer CSS limits in RULES', () => {
    const rules = src.slice(src.indexOf('RULES'))
    expect(rules).toMatch(/CSS limits:/)
    for (const needle of ['~ or +', 'display:none', 'opacity < 0.2', '12px', 'navbar', 'color-mix()', '@import', 'prefers-reduced-motion: no-preference', '2s', 'infinite']) {
      expect(rules).toContain(needle)
    }
  })
})
