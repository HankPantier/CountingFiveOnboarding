// ---------------------------------------------------------------------------
// Per-client blog/insights section config (content/blog.json in the client
// repo). Lets a firm name the section (Resources / Insights / Blog / News) and
// choose its public path. The client-site template reads this file at build
// time; `/resources` stays the internal canonical route and a custom `path` is
// remapped to it by a rewrite in the template's next.config.
//
// This mirrors the template repo's src/lib/content/blog-config.ts — the two are
// separate deploy units, so the value set + defaults are intentionally kept in
// sync by duplication (same as the content-type value set).
// ---------------------------------------------------------------------------

/** The canonical, internal blog route. A custom path rewrites to this. */
export const DEFAULT_BLOG_PATH = '/resources'
const DEFAULT_LABEL = 'Resources'
const DEFAULT_INTRO = 'Practical advice and seasonal updates from our team.'

export type BlogConfig = {
  /** Public base path, single clean segment with leading slash (e.g. /insights). */
  path: string
  /** Nav label + short name. */
  label: string
  /** Index-page H1. */
  title: string
  /** Index-page intro paragraph. */
  intro: string
}

/**
 * Coerce a raw path to a single-segment, root-relative path. Anything that isn't
 * a clean `/segment` ([A-Za-z0-9-]) falls back to the canonical default so the
 * rewrite/redirect can never target a malformed or unsafe destination.
 */
export function normalizeBlogPath(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_BLOG_PATH
  const trimmed = raw.trim()
  if (!trimmed) return DEFAULT_BLOG_PATH
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const noTrailing = withSlash.replace(/\/+$/, '')
  if (!/^\/[A-Za-z0-9-]+$/.test(noTrailing)) return DEFAULT_BLOG_PATH
  return noTrailing
}

function cleanString(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const t = raw.trim()
  return t.length > 0 ? t : undefined
}

/** Resolve a parsed blog.json object (or anything) into a complete BlogConfig. */
export function resolveBlogConfig(raw: unknown): BlogConfig {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const path = normalizeBlogPath(obj.path)
  const label = cleanString(obj.label) ?? DEFAULT_LABEL
  const title = cleanString(obj.title) ?? label
  const intro = cleanString(obj.intro) ?? DEFAULT_INTRO
  return { path, label, title, intro }
}

/** The Resources defaults shipped with a fresh deliverable. */
export const DEFAULT_BLOG_CONFIG: BlogConfig = resolveBlogConfig({})

/** Serialize a BlogConfig to the content/blog.json file body (2-space JSON). */
export function serializeBlogConfig(config: BlogConfig): string {
  return JSON.stringify(
    { path: config.path, label: config.label, title: config.title, intro: config.intro },
    null,
    2
  )
}
