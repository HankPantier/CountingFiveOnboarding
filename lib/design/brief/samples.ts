// Pure (server + tests). Trimmed per-block HTML samples from the client's REAL
// rendered page (the live shell), so the model can target child selectors
// precisely — ported from export-design-brief's fetchRenderedMarkup. Scripts,
// styles, event handlers, inline styles and SVG internals are removed; long
// text runs and class lists are shortened; REPEATED siblings (cards in a grid,
// list items, slides) are collapsed to the first one plus a "+N more" marker.
// One sample per block / component (its first instance). Budget (WS-B, R2 I1b
// — the old 1200-per-block / 9000-total cap in page order covered only 9 of
// the specimen's 27 targets): each sample gets totalChars / (number of
// samples), clamped to [minBlockChars, perBlockChars]; when the total still
// overflows, samples that are NOT CSS targets are dropped first, then the
// latest targets in page order. Output stays in page order.
// The result is untrusted page data — the prompt fences it.
import * as cheerio from 'cheerio'
import { CSS_TARGETS } from '../css-targets'

const KEEP_ATTR = /^(class|role|href|id|type|alt|for|name|data-[a-z0-9-]+|aria-[a-z-]+)$/
const MAX_CLASS_CHARS = 120
const MAX_TEXT_RUN = 60
export const SAMPLE_PER_BLOCK_MAX = 1200
export const SAMPLE_PER_BLOCK_MIN = 500
export const SAMPLE_TOTAL_CHARS = 16_000
const TRUNCATED = ' …[truncated]'

export function extractBlockSamples(
  shellHtml: string,
  opts: { perBlockChars?: number; minBlockChars?: number; totalChars?: number } = {}
): string {
  const perBlockMax = opts.perBlockChars ?? SAMPLE_PER_BLOCK_MAX
  const perBlockMin = Math.min(opts.minBlockChars ?? SAMPLE_PER_BLOCK_MIN, perBlockMax)
  const total = opts.totalChars ?? SAMPLE_TOTAL_CHARS
  const $ = cheerio.load(shellHtml)
  $('script, style, noscript, template, iframe, link, meta').remove()
  $('svg').empty()

  const seen = new Set<string>()
  const found: { key: string; target: boolean; html: string }[] = []
  $('[data-block], [data-component]').each((_, el) => {
    const $el = $(el)
    const block = $el.attr('data-block')
    const id = block ?? $el.attr('data-component') ?? ''
    const key = block ? `data-block="${block}"` : `data-component="${id}"`
    if (seen.has(key)) return
    seen.add(key)

    const clone = $el.clone()
    // Repeated siblings → the first + a marker (depth-first, so a grid of
    // cards keeps one full card).
    clone.find('*').addBack().each((__, node) => {
      const kids = $(node).children().toArray()
      if (kids.length < 2) return
      // A child's "shape": its tag + class list (cards of one grid share it).
      const groups = new Map<string, typeof kids>()
      for (const k of kids) {
        const sig = `${k.tagName}.${($(k).attr('class') ?? '').trim()}`
        groups.set(sig, [...(groups.get(sig) ?? []), k])
      }
      for (const same of groups.values()) {
        if (same.length < 2) continue
        for (const extra of same.slice(1)) $(extra).remove()
        $(same[0]).after(` …+${same.length - 1} more like this `)
      }
    })
    clone.find('*').addBack().each((__, node) => {
      const $n = $(node)
      for (const name of Object.keys($n.attr() ?? {})) {
        if (!KEEP_ATTR.test(name) || name.startsWith('on')) $n.removeAttr(name)
      }
      const cls = $n.attr('class')
      if (cls && cls.length > MAX_CLASS_CHARS) $n.attr('class', `${cls.slice(0, MAX_CLASS_CHARS)}…`)
    })
    const html = $.html(clone)
      .replace(/\s+/g, ' ')
      .replace(new RegExp(`>([^<]{${MAX_TEXT_RUN},})<`, 'g'), (_m, text: string) => `>${text.slice(0, MAX_TEXT_RUN)}…<`)
      .trim()
    found.push({ key, target: (CSS_TARGETS as readonly string[]).includes(id), html })
  })
  if (found.length === 0) return ''

  // Each chunk also spends its label, the truncation marker and the join.
  const overhead = found.reduce((n, f) => n + f.key.length + 3 + TRUNCATED.length + 2, 0)
  const perBlock = Math.max(perBlockMin, Math.min(perBlockMax, Math.floor((total - overhead) / found.length)))
  const chunks = found.map((f) => {
    const body = f.html.length > perBlock ? `${f.html.slice(0, perBlock)}${TRUNCATED}` : f.html
    return { ...f, chunk: `[${f.key}]\n${body}` }
  })
  // Over budget: drop non-targets first, then the latest targets.
  const keep = new Set(chunks)
  let used = chunks.reduce((n, c) => n + c.chunk.length + 2, 0)
  const dropOrder = [...chunks.filter((c) => !c.target).reverse(), ...chunks.filter((c) => c.target).reverse()]
  for (const c of dropOrder) {
    if (used <= total) break
    keep.delete(c)
    used -= c.chunk.length + 2
  }
  return chunks
    .filter((c) => keep.has(c))
    .map((c) => c.chunk)
    .join('\n\n')
}
