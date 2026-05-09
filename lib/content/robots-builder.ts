export function buildRobotsTxt(websiteUrl: string): string {
  const domain = websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')

  return `User-agent: *
Allow: /

# AI crawlers — explicitly allowed
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: GoogleOther
Allow: /

User-agent: Googlebot-Extended
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: CCBot
Allow: /

# Sitemap and LLM context files
Sitemap: https://${domain}/sitemap.xml
Sitemap: https://${domain}/llms.txt
Sitemap: https://${domain}/llms-full.txt
`
}
