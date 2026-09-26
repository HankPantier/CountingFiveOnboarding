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
// Deliberately conservative: a claim counts only when the lever word sits right
// next to its subject ("serif headlines", "flat cards"), and a clause with a
// negation ("no dark sections") is skipped.
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
// Up to n filler words between a lever word and its subject ("flat tinted cards").
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

// "serif headlines" / "serif editorial display" — but not "serif accent word
// in the headline" (the accent role is serif by design) nor "serif-accent".
function claimsSerifHeadlines(clauses: string[]): boolean {
  return clauses.some((c) => {
    for (const m of c.matchAll(new RegExp(`\\bserif\\s+(${gap(2)})(headlines?|headings?|display|titles?|h1s?)\\b`, 'g'))) {
      if (!/\b(accent|accents|numerals?|word|words)\b/.test(m[1])) return true
    }
    return new RegExp(`\\b(headlines?|headings?|titles?)\\s+${gap(4)}(in\\s+)?(a\\s+)?serif\\b(?!-)(?!\\s+accent)`).test(c)
  })
}

const MONO_EYEBROW = [
  new RegExp(`\\bmono(space|spaced)?[\\s-]+${gap(2)}(eyebrows?|kickers?|overlines?)\\b`),
  new RegExp(`\\b(eyebrows?|kickers?|overlines?)\\s+${gap(3)}(in\\s+)?mono(space|spaced)?\\b`),
]
const DARK_SECTIONS = [
  new RegExp(`\\b(dark|ink|inky|deep[\\s-]ink)\\s+${gap(1)}(sections?|bands?|panels?)\\b`),
  /\blight\s*(→|->|to)\s*ink\b/,
]

type AxisClaim = { axis: StyleAxis; value: string; label: string; res: RegExp[]; alsoSatisfiedBy?: (b: DesignBundle) => boolean }

const NAV = '(nav|navbar|navigation|header bar|top bar|menu bar)'
const IMAGES = '(images?|photos?|photography|imagery|frames?)'
const AXIS_CLAIMS: AxisClaim[] = [
  { axis: 'nav', value: 'bordered', label: 'a bordered nav', res: [new RegExp(`\\b(bordered|hairline)\\s+${gap(1)}${NAV}\\b`), new RegExp(`\\b${NAV}\\s+${gap(3)}(hairline|bordered)\\b`)] },
  { axis: 'nav', value: 'inverted', label: 'an inverted nav', res: [new RegExp(`\\b(inverted|reversed|dark|ink|navy|primary[\\s-]colou?r(ed)?)\\s+${gap(1)}${NAV}\\b`)] },
  ...(['flat', 'outlined', 'elevated'] as const).map(
    (v): AxisClaim => ({ axis: 'cards', value: v, label: `${v} cards`, res: [new RegExp(`\\b${v}\\s+${gap(2)}cards?\\b`)] })
  ),
  {
    axis: 'buttons',
    value: 'pill',
    label: 'pill buttons',
    res: [new RegExp(`\\bpill(-shaped)?\\s+${gap(2)}(buttons?|ctas?)\\b`)],
    alsoSatisfiedBy: (b) => b.tokens.roundness === 'pill',
  },
  {
    axis: 'buttons',
    value: 'sharp',
    label: 'sharp-cornered buttons',
    res: [new RegExp(`\\b(sharp|square|squared|square-cornered|sharp-cornered)\\s+${gap(2)}(buttons?|ctas?)\\b`)],
    alsoSatisfiedBy: (b) => b.tokens.roundness === 'sharp',
  },
  { axis: 'buttons', value: 'bold', label: 'bold uppercase buttons', res: [new RegExp(`\\b(bold|uppercase|all-caps)\\s+${gap(2)}(buttons?|ctas?)\\b`)] },
  { axis: 'heroScale', value: 'dramatic', label: 'a dramatic hero scale', res: [new RegExp(`\\b(dramatic|oversized|monumental)\\s+${gap(2)}hero\\b`)] },
  { axis: 'heroScale', value: 'compact', label: 'a compact hero', res: [new RegExp(`\\bcompact\\s+${gap(1)}hero\\b`)] },
  { axis: 'imageTreatment', value: 'mono', label: 'monochrome imagery', res: [new RegExp(`\\b(mono|monochrome|greyscale|grayscale|black-and-white)\\s+${gap(1)}${IMAGES}\\b`)] },
  { axis: 'imageTreatment', value: 'rounded', label: 'rounded images', res: [new RegExp(`\\brounded\\s+${gap(1)}${IMAGES}\\b`)] },
  { axis: 'imageTreatment', value: 'natural', label: 'natural (ungraded) images', res: [new RegExp(`\\b(natural|ungraded|untinted)\\s+${gap(1)}${IMAGES}\\b`)] },
  { axis: 'footer', value: 'brand', label: 'a brand-colour footer', res: [new RegExp(`\\b(brand|branded|dark|ink|navy|primary[\\s-]colou?r(ed)?)\\s+${gap(1)}footer\\b`)] },
  { axis: 'footer', value: 'light', label: 'a light footer', res: [new RegExp(`\\blight\\s+${gap(1)}footer\\b`)] },
  {
    axis: 'sectionRhythm',
    value: 'generous',
    label: 'a generous section rhythm',
    res: [new RegExp(`\\b(generous|roomy|airy)\\s+${gap(1)}(section\\s+)?(rhythm|section spacing)\\b`)],
    alsoSatisfiedBy: (b) => b.tokens.density === 'airy',
  },
  {
    axis: 'sectionRhythm',
    value: 'compact',
    label: 'a compact section rhythm',
    res: [new RegExp(`\\b(compact|tight)\\s+${gap(1)}(section\\s+)?(rhythm|section spacing)\\b`)],
    alsoSatisfiedBy: (b) => b.tokens.density === 'tight',
  },
  {
    axis: 'accentUsage',
    value: 'underline',
    label: 'an underlined accent word',
    res: [new RegExp(`\\bunderlined?\\s+${gap(2)}accent\\b`), new RegExp(`\\baccent\\s+${gap(2)}underlined?\\b`)],
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
