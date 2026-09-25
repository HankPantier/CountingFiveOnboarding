// Pure (server + tests). Trimmed per-block HTML samples from the client's REAL
// rendered page (the live shell), so the model can target child selectors
// precisely — ported from export-design-brief's fetchRenderedMarkup. Scripts,
// styles, event handlers, inline styles and SVG internals are removed; long
// text runs and class lists are shortened; each sample and the total are capped.
// The result is untrusted page data — the prompt fences it.
import * as cheerio from 'cheerio'

const KEEP_ATTR = /^(class|role|href|id|type|alt|for|name|data-[a-z0-9-]+|aria-[a-z-]+)$/
const MAX_CLASS_CHARS = 120
const MAX_TEXT_RUN = 80

export function extractBlockSamples(shellHtml: string, opts: { perBlockChars?: number; totalChars?: number } = {}): string {
  const perBlock = opts.perBlockChars ?? 1200
  const total = opts.totalChars ?? 9000
  const $ = cheerio.load(shellHtml)
  $('script, style, noscript, template, iframe, link, meta').remove()
  $('svg').empty()

  const seen = new Set<string>()
  const out: string[] = []
  let used = 0
  $('[data-block], [data-component]').each((_, el) => {
    const $el = $(el)
    const block = $el.attr('data-block')
    const key = block ? `data-block="${block}"` : `data-component="${$el.attr('data-component') ?? ''}"`
    if (seen.has(key)) return
    seen.add(key)

    const clone = $el.clone()
    clone.find('*').addBack().each((__, node) => {
      const $n = $(node)
      for (const name of Object.keys($n.attr() ?? {})) {
        if (!KEEP_ATTR.test(name) || name.startsWith('on')) $n.removeAttr(name)
      }
      const cls = $n.attr('class')
      if (cls && cls.length > MAX_CLASS_CHARS) $n.attr('class', `${cls.slice(0, MAX_CLASS_CHARS)}…`)
    })
    let html = $.html(clone)
      .replace(/\s+/g, ' ')
      .replace(new RegExp(`>([^<]{${MAX_TEXT_RUN},})<`, 'g'), (_m, text: string) => `>${text.slice(0, MAX_TEXT_RUN)}…<`)
      .trim()
    if (html.length > perBlock) html = `${html.slice(0, perBlock)} …[truncated]`
    const chunk = `[${key}]\n${html}`
    if (used + chunk.length > total) return false
    out.push(chunk)
    used += chunk.length
  })
  return out.join('\n\n')
}
