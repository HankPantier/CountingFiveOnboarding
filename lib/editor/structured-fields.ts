import type { Frontmatter } from './frontmatter'

// Typed accessors for the structured SEO frontmatter fields the content editor
// edits as fields (never as raw JSON-LD). Each is stored in the frontmatter as
// single-line JSON, matching the generator (lib/content/deliverable-builder.ts).
// The template (SchemaScript / GeneratedMarkdownPage) reads these to emit live
// JSON-LD and on-page blocks, so frontmatter is the single source of truth.

export type FaqItem = { question: string; answer: string }
export type InternalLink = { url: string; anchor_text: string; reason: string }

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (raw === undefined || raw.trim() === '') return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// Clone + set a raw frontmatter field value (appending to order if new).
function withField(fm: Frontmatter, key: string, value: string): Frontmatter {
  return {
    ...fm,
    fields: { ...fm.fields, [key]: value },
    arrayFields: { ...fm.arrayFields },
    order: fm.order.includes(key) ? [...fm.order] : [...fm.order, key],
  }
}

// Clone + drop a field entirely (from fields, arrayFields, and order). An empty
// structured field is removed rather than written as `key: []`/`key: ""`.
function withoutField(fm: Frontmatter, key: string): Frontmatter {
  const fields = { ...fm.fields }
  const arrayFields = { ...fm.arrayFields }
  delete fields[key]
  delete arrayFields[key]
  return { ...fm, fields, arrayFields, order: fm.order.filter((k) => k !== key) }
}

export function getFaqBlock(fm: Frontmatter): FaqItem[] {
  const items = parseJson<unknown>(fm.fields['faq_block'], [])
  if (!Array.isArray(items)) return []
  return items.filter(
    (it): it is FaqItem =>
      it != null &&
      typeof it === 'object' &&
      typeof (it as FaqItem).question === 'string' &&
      typeof (it as FaqItem).answer === 'string'
  )
}

export function setFaqBlock(fm: Frontmatter, items: FaqItem[]): Frontmatter {
  const cleaned = items.filter((it) => it.question.trim() !== '' || it.answer.trim() !== '')
  return cleaned.length === 0
    ? withoutField(fm, 'faq_block')
    : withField(fm, 'faq_block', JSON.stringify(cleaned))
}

export function getInternalLinks(fm: Frontmatter): InternalLink[] {
  const links = parseJson<unknown>(fm.fields['internal_links'], [])
  if (!Array.isArray(links)) return []
  return links.filter(
    (it): it is InternalLink =>
      it != null &&
      typeof it === 'object' &&
      typeof (it as InternalLink).url === 'string' &&
      typeof (it as InternalLink).anchor_text === 'string' &&
      typeof (it as InternalLink).reason === 'string'
  )
}

export function setInternalLinks(fm: Frontmatter, links: InternalLink[]): Frontmatter {
  const cleaned = links.filter((l) => l.url.trim() !== '' || l.anchor_text.trim() !== '')
  return cleaned.length === 0
    ? withoutField(fm, 'internal_links')
    : withField(fm, 'internal_links', JSON.stringify(cleaned))
}

export function getEeatSignals(fm: Frontmatter): string[] {
  // Stored as JSON (["a","b"]) by the generator; older inline arrays land in
  // arrayFields, so accept both.
  if (fm.arrayFields['eeat_signals']) return fm.arrayFields['eeat_signals']
  const list = parseJson<unknown>(fm.fields['eeat_signals'], [])
  if (!Array.isArray(list)) return []
  return list.filter((s): s is string => typeof s === 'string')
}

export function setEeatSignals(fm: Frontmatter, signals: string[]): Frontmatter {
  const cleaned = signals.map((s) => s.trim()).filter((s) => s !== '')
  return cleaned.length === 0
    ? withoutField(fm, 'eeat_signals')
    : withField(fm, 'eeat_signals', JSON.stringify(cleaned))
}

export function getAnswerBlock(fm: Frontmatter): string {
  const raw = fm.fields['answer_block']
  if (raw === undefined) return ''
  const trimmed = raw.trim()
  // Generator writes JSON.stringify(string) → quoted; older/template format may
  // be a bare YAML scalar. Parse the quoted form, fall back to the raw value.
  if (trimmed.startsWith('"')) {
    const parsed = parseJson<unknown>(trimmed, null)
    if (typeof parsed === 'string') return parsed
  }
  return raw
}

export function setAnswerBlock(fm: Frontmatter, text: string): Frontmatter {
  return text.trim() === ''
    ? withoutField(fm, 'answer_block')
    : withField(fm, 'answer_block', JSON.stringify(text))
}
