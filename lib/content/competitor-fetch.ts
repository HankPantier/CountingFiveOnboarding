type CompetitorRef = {
  url: string
  title: string
  excerpt: string
}

function extractBodyText(html: string): string {
  // Remove script, style, nav, footer, header, aside tags and their content
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')

  // Strip all remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ')

  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  // Take the longest contiguous block (split by double spaces or very short segments)
  const blocks = cleaned.split(/\s{3,}/).filter(b => b.length > 100)
  if (blocks.length > 0) {
    blocks.sort((a, b) => b.length - a.length)
    return blocks[0]
  }

  return cleaned
}

function truncateToTokens(text: string, maxTokens: number): string {
  // Rough approximation: 1 token ≈ 4 characters
  const maxChars = maxTokens * 4
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars).replace(/\s\S*$/, '') + '...'
}

export async function fetchCompetitorPages(
  refs: Array<{ url: string; title: string }>
): Promise<CompetitorRef[]> {
  const results: CompetitorRef[] = []

  for (const ref of refs.slice(0, 3)) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)

      const res = await fetch(ref.url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CountingFiveBot/1.0)' },
      })
      clearTimeout(timeout)

      if (!res.ok) continue

      const html = await res.text()
      const bodyText = extractBodyText(html)
      const excerpt = truncateToTokens(bodyText, 800)

      if (excerpt.length > 50) {
        results.push({ url: ref.url, title: ref.title, excerpt })
      }
    } catch {
      // Skip silently on fetch failure
    }
  }

  return results
}

export async function fetchExistingContent(
  websiteUrl: string,
  currentSitemap: Array<{ url: string; new_url?: string; action: string }> | undefined,
  proposedUrl: string
): Promise<string | null> {
  if (!currentSitemap) return null

  // Find the current URL that maps to this proposed URL
  const mapping = currentSitemap.find(
    row => row.new_url?.replace(/[→→]\s*/, '').trim() === proposedUrl
  )

  if (!mapping || !mapping.url) return null

  // Build full URL
  const baseUrl = websiteUrl.replace(/\/$/, '')
  const fullUrl = mapping.url.startsWith('http') ? mapping.url : `${baseUrl}${mapping.url}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(fullUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CountingFiveBot/1.0)' },
    })
    clearTimeout(timeout)

    if (!res.ok) return null

    const html = await res.text()
    const bodyText = extractBodyText(html)
    return truncateToTokens(bodyText, 1200)
  } catch {
    return null
  }
}
