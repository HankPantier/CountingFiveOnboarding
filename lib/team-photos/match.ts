// Pure name-matching, headshot classification, and per-member ranking for team
// headshot discovery. No network or cheerio imports — safe to import from both
// the server scraper (lib/team-photos/scrape-headshots.ts) and the client admin
// UI (components/admin/TeamPhotoManager.tsx). All functions here are pure and
// unit-testable.

export type HeadshotCandidate = {
  imageUrl: string
  altText: string | null
  /** Figcaption / nearest heading text near the image — a naming hint. */
  nearbyName: string | null
  filename: string
  width: number | null
  height: number | null
  /** The page the image was found on. A candidate on an individual bio page
   * (slug matching a member's name) is a high-confidence headshot for them. */
  sourcePageUrl: string
}

/** How sure we are that a candidate is a given member's headshot. `high` is
 * safe to auto-pull; `low` is surfaced for the rep to confirm. */
export type MatchConfidence = 'high' | 'low' | 'none'

export type MemberMatch = {
  name: string
  imageUrl: string | null
  confidence: MatchConfidence
}

// Anchor href/text that hints at a team/about page. Covers the common "About"
// synonyms firms actually use for their roster page — "who we are", "our firm",
// "professionals", "principals/shareholders" — not just literal team/about.
export const TEAM_LINK_RE =
  /team|about|our-people|our-team|staff|leadership|\bmeet\b|people|attorneys|advisors|partners|principals|shareholders|founders|professionals|who[- ]?we[- ]?are|our[- ]?firm|the[- ]?firm|\bbios?\b/i

// Image filenames/paths that are almost never a person's headshot. Beyond the
// obvious chrome, this drops hero/banner/slider art, backgrounds, maps,
// screenshots, award/cert seals, sponsor marks, and social-network glyphs —
// the noise that dominates a homepage crawl.
const SKIP_IMG_RE =
  /logo|icon|favicon|sprite|badge|banner|placeholder|spacer|pixel|1x1|loading|hero|slider|slide|carousel|bg[-_]|background|cover|masthead|map|screenshot|award|cert|seal|sponsor|social|facebook|linkedin|twitter|instagram|youtube|gravatar-blank/i

// Alt/nearby/filename text that signals the image is a person (not a building,
// service graphic, or stock photo).
const PERSON_HINT_RE =
  /headshot|portrait|staff|team|attorney|profile|\bbios?\b|people|member|founder|partner|director|\bcpa\b|advisor|principal|shareholder/i

// Below this the image is a thumbnail/icon, not a usable headshot (only applied
// when the source declares dimensions).
const MIN_HEADSHOT_DIMENSION = 100

/** True when a URL's path looks like a team/about page — used both to pick
 * team-like pages out of an already-crawled inventory and to keep the headshot
 * filter lenient on pages where portraits actually live. Shares TEAM_LINK_RE. */
export function looksLikeTeamPageUrl(url: string): boolean {
  try {
    return TEAM_LINK_RE.test(new URL(url).pathname)
  } catch {
    return TEAM_LINK_RE.test(url)
  }
}

/** Name tokens present in a URL's last path segment (the slug). A bio page at
 * /team/jane-doe yields ["jane", "doe"]. Pure. */
export function slugTokens(url: string): string[] {
  let slug = ''
  try {
    const parts = new URL(url).pathname.replace(/\/+$/, '').split('/')
    slug = parts[parts.length - 1] || ''
  } catch {
    slug = url
  }
  return slug
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
}

/** How many of a member's name tokens appear in a set of haystack tokens. */
export function overlapCount(nameTokens: string[], haystack: Set<string>): number {
  let n = 0
  for (const t of nameTokens) if (haystack.has(t)) n++
  return n
}

// Name tokens for matching: drop credentials after the first comma, lowercase,
// split on non-alphanumerics, keep tokens ≥2 chars. Mirrors injectTeamPhotos'
// leading-name-portion convention.
export function nameTokens(name: string): string[] {
  return name
    .split(',')[0]
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
}

export function tokenOverlap(tokens: string[], haystack: string): number {
  const hay = new Set(haystack.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  let score = 0
  for (const t of tokens) if (hay.has(t)) score++
  return score
}

/** Aspect ratio (w/h) when both dims are known, else null. */
function aspectRatio(c: HeadshotCandidate): number | null {
  if (c.width === null || c.height === null || c.height === 0) return null
  return c.width / c.height
}

/** Hard filter: does this candidate plausibly show a person's face? Drops site
 * chrome, banners, maps, seals, and social glyphs by filename; drops banner /
 * strip aspect ratios and tiny images when dimensions are declared; then keeps
 * only images that carry a positive signal — they sit on a team/bio-looking
 * page, their text names a person, or they're square-ish. Biased to keep on
 * team/bio pages (where real portraits live) and to drop generic homepage art. */
export function isLikelyHeadshot(c: HeadshotCandidate): boolean {
  if (SKIP_IMG_RE.test(c.filename) || SKIP_IMG_RE.test(c.imageUrl)) return false

  const ratio = aspectRatio(c)
  if (ratio !== null && (ratio > 1.8 || ratio < 0.45)) return false
  if (c.width !== null && c.height !== null && Math.max(c.width, c.height) < MIN_HEADSHOT_DIMENSION) {
    return false
  }

  const onTeamPage = looksLikeTeamPageUrl(c.sourcePageUrl)
  const hasPersonHint = PERSON_HINT_RE.test(`${c.nearbyName ?? ''} ${c.altText ?? ''} ${c.filename}`)
  const squareish = ratio !== null && ratio >= 0.7 && ratio <= 1.4
  return onTeamPage || hasPersonHint || squareish
}

/** Candidate headshots for one member, filtered to likely faces and ordered
 * best-first for that person. Reuses the same signals as
 * {@link matchHeadshotsToMembers} so the strip order matches the confidence a
 * rep sees: a portrait on the member's own bio page ranks highest, then
 * name-token overlap in the image's text, then a small square-ish / on-team
 * prior. Stable across equal scores. Pure. */
export function rankCandidatesForMember(
  member: { name: string },
  candidates: HeadshotCandidate[]
): HeadshotCandidate[] {
  const tokens = nameTokens(member.name)
  const slugNeeded = tokens.length === 1 ? 1 : 2

  const score = (c: HeadshotCandidate): number => {
    let s = 0
    if (tokens.length > 0) {
      const slug = new Set(slugTokens(c.sourcePageUrl))
      if (overlapCount(tokens, slug) >= slugNeeded) s += 1000
      s += tokenOverlap(tokens, `${c.nearbyName ?? ''} ${c.altText ?? ''} ${c.filename}`) * 100
    }
    const ratio = aspectRatio(c)
    if (ratio !== null && ratio >= 0.7 && ratio <= 1.4) s += 10
    if (looksLikeTeamPageUrl(c.sourcePageUrl)) s += 5
    return s
  }

  return candidates
    .filter(isLikelyHeadshot)
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((entry) => entry.c)
}

/** Best-guess candidate per member, tagged with a confidence tier. Never
 * auto-commits — only the auto-pull orchestrator acts, and only on `high`. Pure.
 *
 * - `high`: the candidate sits on an individual bio page whose slug matches the
 *   member's name (one person per bio page), OR its surrounding text matches
 *   both name tokens (first + last). Safe to pull automatically.
 * - `low`: a single name token matched — surfaced for the rep to confirm.
 * - `none`: nothing matched. */
export function matchHeadshotsToMembers(
  members: { name: string }[],
  candidates: HeadshotCandidate[]
): MemberMatch[] {
  return members.map((member) => {
    const tokens = nameTokens(member.name)
    if (tokens.length === 0) return { name: member.name, imageUrl: null, confidence: 'none' as const }

    // A bio page carries one person: if its slug matches the member's name, the
    // best image on that page is almost certainly them. Two name tokens must
    // match (or the member's only token, for single-name people) so a generic
    // slug like /about doesn't false-positive.
    const slugNeeded = tokens.length === 1 ? 1 : 2
    const bioMatches = candidates.filter((c) => {
      const slug = new Set(slugTokens(c.sourcePageUrl))
      return overlapCount(tokens, slug) >= slugNeeded
    })
    if (bioMatches.length > 0) {
      // Among a bio page's images, prefer the one whose own text also names the
      // member; else the first (usually the primary portrait).
      let best = bioMatches[0]
      let bestScore = -1
      for (const c of bioMatches) {
        const score = tokenOverlap(tokens, `${c.nearbyName ?? ''} ${c.altText ?? ''} ${c.filename}`)
        if (score > bestScore) {
          bestScore = score
          best = c
        }
      }
      return { name: member.name, imageUrl: best.imageUrl, confidence: 'high' as const }
    }

    // Fall back to name overlap in the image's own surrounding text.
    let best: { url: string; score: number } | null = null
    for (const c of candidates) {
      const score = tokenOverlap(tokens, `${c.nearbyName ?? ''} ${c.altText ?? ''} ${c.filename}`)
      if (score > 0 && (!best || score > best.score)) best = { url: c.imageUrl, score }
    }
    if (!best) return { name: member.name, imageUrl: null, confidence: 'none' as const }
    return { name: member.name, imageUrl: best.url, confidence: best.score >= 2 ? 'high' : 'low' }
  })
}

/** Best-guess candidate imageUrl per member. Thin wrapper over
 * {@link matchHeadshotsToMembers} kept for the discover route/UI. Pure. */
export function suggestCandidatesByName(
  members: { name: string }[],
  candidates: HeadshotCandidate[]
): Record<string, string | null> {
  const result: Record<string, string | null> = {}
  for (const m of matchHeadshotsToMembers(members, candidates)) result[m.name] = m.imageUrl
  return result
}
