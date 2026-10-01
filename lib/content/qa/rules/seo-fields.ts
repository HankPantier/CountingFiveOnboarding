import { randomUUID } from 'node:crypto'
import type { Finding } from '@/types/qa-review'

const TITLE_MIN = 50, TITLE_MAX = 60, DESC_MIN = 150, DESC_MAX = 160

function f(kind: string, severity: Finding['severity'], quote: string, message: string): Finding {
  return { id: randomUUID(), agent: 'rules', severity, kind, quote, message, safety: 'flag', status: 'open' }
}

export function checkSeoFields(metaTitle: string | null, metaDescription: string | null, body: string): Finding[] {
  const out: Finding[] = []
  const title = metaTitle?.trim() ?? ''
  const desc = metaDescription?.trim() ?? ''
  if (!title) out.push(f('meta_missing', 'high', '', 'The page has no meta title.'))
  else if (title.length < TITLE_MIN || title.length > TITLE_MAX)
    out.push(f('meta_length', 'med', title, `Meta title is ${title.length} characters; aim for ${TITLE_MIN}–${TITLE_MAX}.`))
  if (!desc) out.push(f('meta_missing', 'high', '', 'The page has no meta description.'))
  else if (desc.length < DESC_MIN || desc.length > DESC_MAX)
    out.push(f('meta_length', 'med', desc, `Meta description is ${desc.length} characters; aim for ${DESC_MIN}–${DESC_MAX}.`))

  // Ignore fenced code; read ATX headings only.
  const levels: Array<{ level: number; text: string }> = []
  let inFence = false
  for (const line of body.split('\n')) {
    if (line.trimStart().startsWith('```')) { inFence = !inFence; continue }
    if (inFence) continue
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) levels.push({ level: m[1].length, text: m[2] })
  }
  for (const h of levels.filter(h => h.level === 1)) {
    out.push(f('heading_h1', 'med', h.text, 'The page title is already the H1; body headings should start at H2.'))
  }
  for (let i = 1; i < levels.length; i++) {
    if (levels[i].level > levels[i - 1].level + 1) {
      out.push(f('heading_skip', 'low', levels[i].text, `Heading jumps from H${levels[i - 1].level} to H${levels[i].level}.`))
    }
  }
  return out
}
