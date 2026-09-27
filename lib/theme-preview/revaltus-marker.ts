// Pure + client-safe. The Revaltus template marker on a DEPLOYED site: every
// page of a template ≥ 2026.09.1 carries
//   <meta name="c5-capabilities" content="fonts,style-axes,specimen">
// (the client template's root layout emits it via generateMetadata `other`,
// see src/lib/theme/template-marker.ts there). A page WITHOUT it is not a
// Revaltus-built site — before DNS cutover, site.config.ts siteUrl is usually
// the client's OLD site (e.g. WordPress). The Theme Studio preview, Design
// Studio renders and the capability handshake all refuse such a page rather
// than show or render the old site as the "current site".

export const SHELL_CAPABILITIES_META = 'c5-capabilities'

const TOKEN_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const MAX_TOKENS = 20
// The marker sits in <head> (a few KB in); the cap only bounds a hostile page.
const MAX_SCAN = 200_000

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)
  return m ? m[2] : null
}

// The marker's capability tokens, or null when the page has no marker at all
// (not a Revaltus site). An empty-content marker is [] (a Revaltus site that
// declares no capabilities), which is distinct from null.
export function findShellMarker(html: string): string[] | null {
  for (const match of html.slice(0, MAX_SCAN).matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0]
    if (attr(tag, 'name')?.trim().toLowerCase() !== SHELL_CAPABILITIES_META) continue
    const tokens = (attr(tag, 'content') ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => TOKEN_RE.test(s))
    return [...new Set(tokens)].slice(0, MAX_TOKENS)
  }
  return null
}

export const hasRevaltusMarker = (html: string): boolean => findShellMarker(html) !== null

// Show the origin (what the operator types into the preview-URL field), not
// the page path a multi-page preview asked for.
function displayUrl(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

export function notRevaltusSiteMessage(url: string): string {
  return `${displayUrl(url)} isn't the Revaltus-built site (it may be the client's old site before DNS cutover). Set the preview URL to the site's Vercel address, e.g. https://<project>.vercel.app.`
}
