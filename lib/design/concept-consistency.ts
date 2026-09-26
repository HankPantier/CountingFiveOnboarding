// Pure + client-safe. Pre-critique self-consistency (P7 judge rework): does a
// concept's own description (name, tagline, rationale, moves) match the levers
// it actually set? The A/B on 2026-09-26 found concepts promising "serif
// editorial headlines" with headlineStyle 'sans' and a "bordered nav" the
// bundle never set — the critic then spent its issues on the gap.
//
// Mismatches are NOTES, never errors: a concept is not rejected for wording.
// The generator / reviser attach them to the concept's notes, the P3 repair
// turn quotes them, and the critique + revise prompts restate them (per call,
// never in a cached prefix) so the next revision fixes the lever or the words.
// Deliberately conservative — missing a claim beats a false positive (the
// critic turns each note into an issue and the reviser acts on it): a claim
// counts only when the lever word sits right next to its subject ("serif
// headlines", "flat cards"), the serif ACCENT role never counts, and a clause
// with a negation ("no dark sections") is skipped.
import type { DesignBundle } from './bundle'
import { fontsUnlocked, styleAxesUnlocked } from './capabilities'
import type { DesignCapabilities } from './run-types'
import type { StyleAxis } from './style-axes'

export const CLAIM_CHECK_PREFIX = 'Claim check:'
export const SIGNATURE_CSS_PREFIX = 'Signature CSS:'
export const MIN_SIGNATURE_BLOCKS = 2

// The serif families among the curated fonts (type-pairing-catalog CURATED_FONTS);
// a test pins this against the catalog so a new serif can't slip through.
export const SERIF_FONTS: readonly string[] = [
  'Bitter',
  'DM Serif Display',
  'Fraunces',
  'IBM Plex Serif',
  'Libre Caslon Text',
  'Lora',
  'Merriweather',
  'Playfair Display',
  'Source Serif 4',
]

const NEGATION = /\b(no|not|without|never|avoid|avoids|drop|drops|dropped|remove|removes|removed|instead of|rather than)\b/
// Up to n filler words between a lever word and its subject. Used ONLY for the
// serif / mono treatment claims; every style-axis claim requires the axis noun
// RIGHT AFTER the value word ("flat cards", never "flat fee pricing cards").
const gap = (n: number): string => `(?:[a-z0-9&'-]+\\s+){0,${n}}`

// The claim text, split into clauses. "sans-serif" is folded to "sans" first so
// it never reads as a serif claim.
export function claimClauses(bundle: Pick<DesignBundle, 'name' | 'tagline' | 'rationale' | 'moves'>): string[] {
  return [bundle.name, bundle.tagline ?? '', bundle.rationale, ...bundle.moves]
    .join('\n')
    .toLowerCase()
    .replace(/sans[\s-]?serif/g, 'sans')
    .split(/[.;:!?\n()]|\s[—–]\s|\s-\s/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && !NEGATION.test(c))
}

const anyClause = (clauses: string[], res: RegExp[]): boolean => clauses.some((c) => res.some((re) => re.test(c)))

// The serif ACCENT role (emphasis words, numerals) is serif by design — "serif
// accent", "italic-serif numerals" are never headline claims.
const ACCENT_ROLE = /\b(accents?|numerals?|words?|italics?)\b/
// Words between "headlines" and "serif" that mean the serif is something else:
// "headlines stay sans with serif numerals", "headlines in inter and a serif …".
const HEADLINE_ESCAPE = /\b(sans|with|and|plus|but|while|except|besides)\b/

// "serif headlines" / "serif editorial display" / "headlines set in a serif" —
// but never the accent role.
function claimsSerifHeadlines(clauses: string[]): boolean {
  return clauses.some((c) => {
    for (const m of c.matchAll(new RegExp(`\\bserif\\s+(${gap(2)})(headlines?|headings?|display|titles?|h1s?)\\b`, 'g'))) {
      if (!ACCENT_ROLE.test(m[1])) return true
    }
    for (const m of c.matchAll(new RegExp(`\\b(?:headlines?|headings?|titles?)\\s+(${gap(4)})serif\\b(?![\\s-]+(?:accents?|numerals?|words?|italics?)\\b)(?!-)`, 'g'))) {
      if (!HEADLINE_ESCAPE.test(m[1]) && !ACCENT_ROLE.test(m[1])) return true
    }
    return false
  })
}

const MONO_EYEBROW = [
  new RegExp(`\\bmono(space|spaced)?[\\s-]+${gap(2)}(eyebrows?|kickers?|overlines?)\\b`),
  new RegExp(`\\b(eyebrows?|kickers?|overlines?)\\s+${gap(3)}(in\\s+)?mono(space|spaced)?\\b`),
]
// Adjacent only: "dark sections", "ink bands", "deep ink bands" — not "dark hero panels".
const DARK_SECTIONS = [/\b(dark|ink|inky|deep[\s-]ink)\s+(sections?|bands?|panels?)\b/, /\blight\s*(→|->|to)\s*ink\b/]

type AxisClaim = { axis: StyleAxis; value: string; label: string; res: RegExp[]; alsoSatisfiedBy?: (b: DesignBundle) => boolean }

const NAV = '(?:nav|navbar|navigation|header bar|top bar|menu bar)'
const IMAGES = '(?:images?|photos?|photography|imagery)'
// A chrome / hero noun that ENDS the claim (clause end, a comma, "and", "with")
// or is followed by a word naming the whole thing — "ink footer links" or
// "compact hero kicker" talk about a part, not the preset.
const whole = (tail: string): string => `(?:\\s+(?:${tail}))?(?=\\s*$|\\s*,|\\s+(?:and|with|in|on|that|for)\\b)`
const HERO_TAIL = whole('scale|headline|headlines|type|display|section')
const FOOTER_TAIL = whole('band|bar|surface|background|block|section')
const AXIS_CLAIMS: AxisClaim[] = [
  { axis: 'nav', value: 'bordered', label: 'a bordered nav', res: [new RegExp(`\\bbordered\\s+${NAV}\\b`)] },
  { axis: 'nav', value: 'inverted', label: 'an inverted nav', res: [new RegExp(`\\b(?:inverted|reversed|dark|ink|navy|primary[\\s-]colou?r(?:ed)?)\\s+${NAV}\\b`)] },
  ...(['flat', 'outlined', 'elevated'] as const).map(
    (v): AxisClaim => ({ axis: 'cards', value: v, label: `${v} cards`, res: [new RegExp(`\\b${v}\\s+(?:card|cards|card surfaces)\\b`)] })
  ),
  {
    axis: 'buttons',
    value: 'pill',
    label: 'pill buttons',
    res: [/\bpill(?:-shaped)?\s+(?:buttons?|ctas?)\b/],
    alsoSatisfiedBy: (b) => b.tokens.roundness === 'pill',
  },
  {
    axis: 'buttons',
    value: 'sharp',
    label: 'sharp-cornered buttons',
    res: [/\b(?:sharp|square|squared|square-cornered|sharp-cornered)\s+(?:buttons?|ctas?)\b/],
    alsoSatisfiedBy: (b) => b.tokens.roundness === 'sharp',
  },
  // Never bare "bold" — "bold CTAs in clay" means colour / weight, not the preset.
  { axis: 'buttons', value: 'bold', label: 'uppercase tracked buttons', res: [/\b(?:uppercase|all-caps|tracked)(?:\s+(?:uppercase|tracked))?\s+(?:buttons?|ctas?|button labels?)\b/] },
  { axis: 'heroScale', value: 'dramatic', label: 'a dramatic hero scale', res: [new RegExp(`\\b(?:dramatic|oversized|monumental)\\s+hero${HERO_TAIL}`)] },
  { axis: 'heroScale', value: 'compact', label: 'a compact hero', res: [new RegExp(`\\bcompact\\s+hero${HERO_TAIL}`)] },
  { axis: 'imageTreatment', value: 'mono', label: 'monochrome imagery', res: [new RegExp(`\\b(?:mono|monochrome|greyscale|grayscale|black-and-white)\\s+${IMAGES}\\b`)] },
  { axis: 'imageTreatment', value: 'rounded', label: 'rounded images', res: [new RegExp(`\\brounded\\s+${IMAGES}\\b`)] },
  { axis: 'imageTreatment', value: 'natural', label: 'natural (ungraded) images', res: [new RegExp(`\\b(?:natural|ungraded|untinted)\\s+${IMAGES}\\b`)] },
  { axis: 'footer', value: 'brand', label: 'a brand-colour footer', res: [new RegExp(`\\b(?:brand|branded|dark|ink|navy|primary[\\s-]colou?r(?:ed)?)\\s+footer${FOOTER_TAIL}`)] },
  { axis: 'footer', value: 'light', label: 'a light footer', res: [new RegExp(`\\blight\\s+footer${FOOTER_TAIL}`)] },
  {
    axis: 'sectionRhythm',
    value: 'generous',
    label: 'a generous section rhythm',
    res: [/\b(?:generous|roomy|airy)\s+(?:section\s+)?(?:rhythm|section spacing)\b/],
    alsoSatisfiedBy: (b) => b.tokens.density === 'airy',
  },
  {
    axis: 'sectionRhythm',
    value: 'compact',
    label: 'a compact section rhythm',
    res: [/\b(?:compact|tight)\s+(?:section\s+)?(?:rhythm|section spacing)\b/],
    alsoSatisfiedBy: (b) => b.tokens.density === 'tight',
  },
  {
    axis: 'accentUsage',
    value: 'underline',
    label: 'an underlined accent word',
    res: [/\bunderlined?\s+accent\b/, /\baccent\s+(?:words?\s+)?underlined?\b/, /\baccent\s+underline\b/],
  },
]

function signatureCssNote(css: DesignBundle['css']): string | null {
  const count = Object.values(css.blocks).filter((body) => typeof body === 'string' && body.trim().length > 0).length
  if (count >= MIN_SIGNATURE_BLOCKS) return null
  return `${SIGNATURE_CSS_PREFIX} only ${count} scoped css.blocks move${count === 1 ? '' : 's'} — every concept needs 2–3 signature css.blocks moves (e.g. the hero, a card family, section headers), each implementing a named move.`
}

// Every mismatch between what the concept SAYS and what its levers DO, plus
// the signature-CSS floor. Style-axis claims are checked only when the axes
// are unlocked (below L3 the site's current style is held, whatever the words).
export function conceptConsistencyNotes(bundle: DesignBundle, caps: DesignCapabilities): string[] {
  const clauses = claimClauses(bundle)
  const notes: string[] = []
  const { treatments, typography } = bundle

  if (claimsSerifHeadlines(clauses) && treatments.headlineStyle !== 'serif' && !SERIF_FONTS.includes(typography.headingFont)) {
    notes.push(
      `${CLAIM_CHECK_PREFIX} the description promises serif headlines, but treatments.headlineStyle is "${treatments.headlineStyle}" and the heading font (${typography.headingFont}) is a sans — set headlineStyle to "serif"${fontsUnlocked(caps) ? ' (or pick a serif headingFont)' : ''}, or change the wording.`
    )
  }
  if (anyClause(clauses, MONO_EYEBROW) && treatments.eyebrowStyle !== 'mono') {
    notes.push(`${CLAIM_CHECK_PREFIX} the description promises mono eyebrows, but treatments.eyebrowStyle is "${treatments.eyebrowStyle}" — set it to "mono", or change the wording.`)
  }
  if (anyClause(clauses, DARK_SECTIONS) && !treatments.darkSections) {
    notes.push(`${CLAIM_CHECK_PREFIX} the description promises dark (ink) sections, but treatments.darkSections is false — turn it on, or change the wording.`)
  }
  if (styleAxesUnlocked(caps)) {
    const seen = new Set<string>()
    for (const claim of AXIS_CLAIMS) {
      if (seen.has(claim.axis) || !anyClause(clauses, claim.res)) continue
      const actual: string = bundle.style?.[claim.axis] ?? 'default'
      if (actual === claim.value || claim.alsoSatisfiedBy?.(bundle)) continue
      seen.add(claim.axis)
      notes.push(
        `${CLAIM_CHECK_PREFIX} the description promises ${claim.label}, but style.${claim.axis} is "${actual}" — set style.${claim.axis} to "${claim.value}" (a preset beats hand CSS), or change the wording.`
      )
    }
  }
  const css = signatureCssNote(bundle.css)
  if (css) notes.push(css)
  return notes
}
