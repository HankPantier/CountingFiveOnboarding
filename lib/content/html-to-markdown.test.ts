import { describe, it, expect } from 'vitest'
import { extractArticleMarkdown } from './html-to-markdown'

const PAGE = `<!doctype html><html><head>
  <title>Tax Tips for Contractors</title>
  <meta name="description" content="How contractors cut their tax bill.">
</head><body>
  <header><nav><a href="/">Home</a></nav></header>
  <main>
    <article class="entry-content">
      <h1>Tax Tips for Contractors</h1>
      <p>First paragraph with a <a href="/services">link</a>.</p>
      <h2>Deductions</h2>
      <ul><li>Mileage</li><li>Home office</li></ul>
      <img src="/images/chart.png" alt="A chart">
      <blockquote>Keep good records.</blockquote>
    </article>
  </main>
  <footer><p>Copyright old firm</p><script>tracking()</script></footer>
</body></html>`

describe('extractArticleMarkdown', () => {
  it('strips boilerplate and keeps the article body verbatim', () => {
    const { markdown } = extractArticleMarkdown(PAGE, { baseUrl: 'https://old.example.com/blog/tax' })
    expect(markdown).toContain('# Tax Tips for Contractors')
    expect(markdown).toContain('## Deductions')
    expect(markdown).toMatch(/- +Mileage/)
    expect(markdown).toMatch(/- +Home office/)
    expect(markdown).toContain('> Keep good records.')
    expect(markdown).toContain('[link](/services)')
    // nav/footer/script are gone
    expect(markdown).not.toContain('[Home](/)')
    expect(markdown).not.toContain('Copyright old firm')
    expect(markdown).not.toContain('tracking()')
  })

  it('resolves image srcs to absolute and collects them', () => {
    const { markdown, imageUrls } = extractArticleMarkdown(PAGE, {
      baseUrl: 'https://old.example.com/blog/tax',
    })
    expect(imageUrls).toEqual(['https://old.example.com/images/chart.png'])
    expect(markdown).toContain('https://old.example.com/images/chart.png')
  })

  it('extracts title and meta description from the head', () => {
    const { extractedTitle, extractedMetaFromHtml } = extractArticleMarkdown(PAGE, {
      baseUrl: 'https://old.example.com/blog/tax',
    })
    expect(extractedTitle).toBe('Tax Tips for Contractors')
    expect(extractedMetaFromHtml).toBe('How contractors cut their tax bill.')
  })

  it('falls back to body when no article container exists', () => {
    const bare = '<html><body><p>Just a paragraph.</p></body></html>'
    const { markdown } = extractArticleMarkdown(bare, { baseUrl: 'https://x.com' })
    expect(markdown).toContain('Just a paragraph.')
  })

  it('returns empty on blank input without throwing', () => {
    expect(extractArticleMarkdown('', { baseUrl: 'https://x.com' }).markdown).toBe('')
  })

  it('drops images with unresolvable/data src', () => {
    const html = '<article><p>Hi</p><img src="data:image/png;base64,AAAA"></article>'
    const { imageUrls, markdown } = extractArticleMarkdown(html, { baseUrl: 'https://x.com' })
    expect(imageUrls).toEqual([])
    expect(markdown).toContain('Hi')
  })
})
