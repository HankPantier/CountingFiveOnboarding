import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripBrokenJsonLdLogo } from './strip-jsonld-logo'

const block = (json: string) => `<script type="application/ld+json">\n${json}\n</script>`

describe('stripBrokenJsonLdLogo', () => {
  it('drops the logo line from an Organization node and keeps the rest byte-identical', () => {
    const json = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'A', url: 'https://a.com', logo: 'https://a.com/logo.png', sameAs: ['https://x'] }, null, 2)
    const text = `# Page\n\n\`\`\`html\n${block(json)}\n${block('{\n  "@type": "WebPage"\n}')}\n\`\`\`\n`
    const r = stripBrokenJsonLdLogo(text)
    expect(r).toMatchObject({ removed: 1, skipped: 0 })
    expect(r.content).not.toContain('logo.png')
    expect(r.content).toBe(text.replace('  "logo": "https://a.com/logo.png",\n', ''))
  })

  it('removes the previous comma when logo was the last member', () => {
    const json = JSON.stringify({ '@type': 'Organization', name: 'A', url: 'https://a.com', logo: 'https://a.com/logo.png' }, null, 2)
    const r = stripBrokenJsonLdLogo(block(json))
    expect(r.removed).toBe(1)
    const body = r.content.replace(/^<script[^>]*>\n|\n<\/script>$/g, '')
    expect(JSON.parse(body)).toEqual({ '@type': 'Organization', name: 'A', url: 'https://a.com' })
  })

  it('leaves real logos, other node types and unparsable blocks alone', () => {
    const real = block(JSON.stringify({ '@type': 'Organization', logo: 'https://a.com/content-assets/logo-1.png' }, null, 2))
    const other = block(JSON.stringify({ '@type': 'WebPage', image: 'https://a.com/logo.png' }, null, 2))
    const broken = block('{ "@type": "Organization", "logo": "https://a.com/logo.png", ')
    const text = [real, other, broken].join('\n')
    const r = stripBrokenJsonLdLogo(text)
    expect(r.content).toBe(text)
    expect(r.removed).toBe(0)
  })

  it('is idempotent', () => {
    const text = block(JSON.stringify({ '@type': 'Organization', url: 'https://a.com', logo: 'https://a.com/logo.png', sameAs: [] }, null, 2))
    const once = stripBrokenJsonLdLogo(text).content
    expect(stripBrokenJsonLdLogo(once)).toEqual({ content: once, removed: 0, skipped: 0 })
  })

  it('fixes the real Accord page fixture', () => {
    const file = readFileSync(path.join(__dirname, '__fixtures__/leaked-generator-notes/accord-services.orphan-structured.page.md'), 'utf-8')
    const r = stripBrokenJsonLdLogo(file)
    expect(r.removed).toBe(1)
    expect(r.content).not.toContain('/logo.png')
    expect(file.length - r.content.length).toBe('  "logo": "https://accordadvisors.com/logo.png",\n'.length)
  })
})
