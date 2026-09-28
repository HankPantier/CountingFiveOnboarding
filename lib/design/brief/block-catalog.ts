// Pure. The block + chrome vocabulary the concept model may style, ported from
// the template's export-design-brief.ts BLOCK_CATALOG (component-library-spec).
// Limited to CSS-targetable ids (OVERRIDE_BLOCKS / CHROME_COMPONENTS) so the
// model never writes CSS the sanitizer would reject; client-center is added.
// Every block /design-specimen renders is listed (template block registry).
// Variants come from the template block catalog contract (lib/content/block-catalog.ts),
// filtered to what the site's template version renders (since ≤ version), so a
// newer variant never reaches a concept for a site that can't show it.
// Hints name SCOPED selectors wherever a bare element selector would also hit
// text on a different surface (e.g. a --color-primary panel vs the canvas).
import type { OVERRIDE_BLOCKS } from '@/lib/editor/theme-edit'
import type { CHROME_COMPONENTS } from '../css-targets'
import { blockVariantValuesAt, catalogEpoch, catalogVersion, compareTemplateVersions } from '@/lib/content/block-catalog'

// `since`: the template release that first renders the hook. Entries without
// it have always been there. A site below `since` never sees the entry, so the
// model never styles a hook its markup lacks.
type BlockEntry = { id: (typeof OVERRIDE_BLOCKS)[number]; purpose: string; tokens?: string; since?: string }
export type BlockSpec = BlockEntry & { variants: string[] }
export type ChromeSpec = { id: (typeof CHROME_COMPONENTS)[number]; purpose: string; since?: string }

/** First template release carrying the topbar / contact-drawer / section-nav / blog / 404 hooks. */
export const STYLING_HOOKS_SINCE = '2026.09.11'

const BLOCK_ENTRIES: readonly BlockEntry[] = [
  {
    id: 'hero',
    purpose:
      'Above-the-fold opener. The statement variant is the Ink & Clay signature: light canvas, large grotesk display headline with ONE word promoted to the italic-serif accent in --color-action, a small-caps kicker, and a framed duotone side image. image/video/slider are full-bleed with a directional brand scrim.',
    
    tokens: '--font-heading, --font-accent, --color-action (accent + kicker), --color-primary (scrim)',
  },
  { id: 'hero-split', purpose: 'Two-column page opener with text + image.', },
  { id: 'page-header', purpose: 'Slim inner-page title bar.', tokens: '--color-primary (bg), --color-near-white (text)' },
  { id: 'intro-text', purpose: 'Short headline + paragraph transition between sections.', },
  { id: 'content-split', purpose: 'Narrative paragraph with a supporting image.', },
  { id: 'content-prose', purpose: 'Long-form copy with no supporting image.', },
  { id: 'checklist-section', purpose: 'Benefits, inclusions or qualifying criteria.', tokens: '--color-action (check icon)' },
  { id: 'process-steps', purpose: 'Numbered how-it-works sequence.', },
  { id: 'feature-grid', purpose: '3–8 equal-weight features with icon + short description.', },
  { id: 'service-cards', purpose: '2–9 named services with descriptions and links.', },
  { id: 'content-cards', purpose: 'Blog posts, articles or resources with images.', },
  { id: 'team-grid', purpose: 'Staff or partner profiles with photos.', },
  { id: 'industry-cards', purpose: 'Industry / niche verticals with icons (often an ink band).', },
  { id: 'testimonials', purpose: 'Client quotes or reviews.', },
  { id: 'stats-bar', purpose: '3–4 numeric proof points.', tokens: '--color-primary (bg), --color-near-white (text)' },
  { id: 'logo-bar', purpose: 'Certification badges or association logos.', },
  { id: 'cta-banner', purpose: 'A direct call to action with a single button.', tokens: '--color-action, --color-primary, --color-near-white' },
  { id: 'pricing', purpose: 'Tiered packages with feature lists and prices.', },
  { id: 'faq-accordion', purpose: 'Expandable question-and-answer pairs.', },
  { id: 'form', purpose: 'Lead-capture, contact or newsletter form.', },
  { id: 'content-table', purpose: 'Comparison data, calendars or structured reference info.', },
  { id: 'client-center', purpose: 'Client portal / secure-file links and logins.', },
  {
    id: 'pricing-calculator',
    purpose:
      'Interactive fee estimator: service rows and option chips on the canvas, and a --color-primary estimate panel whose large price figure (a <p>, e.g. "~$169–$229") is set in --color-action — keep that figure and the other panel text legible on the primary (ideally ≥4.5:1), so adjust that pair or restyle the panel text only with [data-block="pricing-calculator"] .bg-primary p (a bare p also hits the labels on the light canvas).',
    
    tokens: '--color-primary (estimate panel bg), --color-action (estimate figure + CTA), --color-primary-foreground (panel text)',
  },
  {
    id: 'pricing-plans',
    purpose:
      'Plan tier cards with a monthly/annual switch, an "all plans include" list and add-on cards. The most-popular tier is a --color-primary card (class bg-primary) with primary-foreground text, crowned by a "Most popular" pill in --color-action with white text; the other tiers and the lists sit on the canvas. Restyle the featured tier only with [data-block="pricing-plans"] .bg-primary … (a bare h3, span or li also hits the canvas cards).',
    
    tokens: '--color-primary (featured tier bg + ring), --color-primary-foreground (featured text), --color-action (switch, "Most popular" pill, check icons)',
  },
  {
    id: 'booking',
    purpose:
      'Scheduling embed: a centred header (h2 + intro) above a third-party calendar (Calendly widget or iframe). Only the header and the embed\'s outer box are styleable — the calendar is cross-origin and ignores site CSS.',
    
  },
  {
    id: 'contact-info',
    purpose: 'Firm contact details from brand.json: "Reach out" (phone/email/fax links) and "Visit" (address, hours) columns, each row led by a --color-primary icon.',
    
    tokens: '--color-primary (icons, link hover)',
  },
  {
    id: 'map',
    purpose: 'Heading over a bordered, rounded 16:9 Google Maps iframe of the firm address. Style the heading and the frame box only (the map is cross-origin).',
    
  },
  {
    id: 'resource-list',
    purpose: 'Downloadable resources as a card grid (title, description, outline Download button), always followed by a separate newsletter [data-block="form"] section.',
    
  },
  {
    id: 'answer-callout',
    purpose:
      'The "Quick answer" callout at the top of generated pages: a bordered card (rounded-xl, --color-action left accent bar, soft action wash) with a small-caps label and a 2–3 sentence answer. Its card is the block\'s first child div.',
    tokens: '--color-action (accent bar, icon, wash), --color-card, --color-border',
  },
  { id: 'related-links', purpose: '"Keep exploring" list of links to related pages at the foot of generated pages, above a top border.' },
  { id: 'trust-signals', purpose: '"Why clients trust us" two-column list of short credibility points on a surface band.' },
  {
    id: 'resource-browser',
    purpose: 'The blog / resources index: search field, topic dropdown, Newest/Oldest toggle, type filter chips and the grid of post cards (image, type badge, date, title, excerpt).',
    since: STYLING_HOOKS_SINCE,
  },
  { id: 'post-image', purpose: "A blog post's featured image in a rounded frame, under the post title.", since: STYLING_HOOKS_SINCE },
  {
    id: 'post-body',
    purpose: "A blog post's article body (.prose: headings, lists, tables in .prose-table-wrap) and the outline \"More …\" button under it.",
    since: STYLING_HOOKS_SINCE,
  },
  { id: 'related-posts', purpose: '"Related reading" grid of post cards (image, title, excerpt) at the foot of a blog post.', since: STYLING_HOOKS_SINCE },
  { id: 'not-found', purpose: 'The 404 page: "We can’t find that page" heading, link cards to the main pages and a "Back to …" button.', since: STYLING_HOOKS_SINCE },
]

export const CHROME_CATALOG: readonly ChromeSpec[] = [
  {
    id: 'navbar',
    purpose:
      'Sticky header on every page: logo → desktop menu → optional CTA → mobile hamburger. Background toggles on scroll; active links carry aria-current="page".',
  },
  {
    id: 'footer',
    purpose:
      'Inverted (bg-foreground text-background) footer: logo + tagline + 3 nav columns, certifications bar, legal bar with social icons. The logo renders `invert opacity-90`.',
  },
  {
    id: 'cookie-consent',
    purpose: 'Sticky bottom <aside> with [data-slot="message"], [data-slot="accept"], [data-slot="decline"]. Keep Accept and Decline visually distinct.',
  },
  { id: 'topbar', purpose: 'Thin utility bar above the navbar (footer colours): Client Center button, phone and email links.', since: STYLING_HOOKS_SINCE },
  {
    id: 'contact-drawer',
    purpose: 'The floating "Contact" pill button pinned bottom-right on every page AND the slide-in contact drawer it opens (phone header, Call / Message tabs, form). Both elements carry the attribute.',
    since: STYLING_HOOKS_SINCE,
  },
  { id: 'section-nav', purpose: '"In this section" side menu on section pages: left-border link list on desktop, a bordered accordion on mobile.', since: STYLING_HOOKS_SINCE },
]

const shownAt = (since: string | undefined, templateVersion: string | null) =>
  since === undefined || compareTemplateVersions(since, catalogVersion(templateVersion)) <= 0

/**
 * The vocabulary epoch: the newest variant OR hook `since` at or below the
 * version. Every version with the same epoch sees byte-identical vocabulary,
 * so prompt prefixes are cached per epoch.
 */
export function vocabularyEpoch(templateVersion: string | null): string {
  let epoch = catalogEpoch(templateVersion)
  for (const e of [...BLOCK_ENTRIES, ...CHROME_CATALOG]) {
    if (e.since && shownAt(e.since, templateVersion) && compareTemplateVersions(e.since, epoch) > 0) epoch = e.since
  }
  return epoch
}

export function chromeCatalog(templateVersion: string | null): readonly ChromeSpec[] {
  return CHROME_CATALOG.filter((c) => shownAt(c.since, templateVersion))
}

/**
 * The block vocabulary at a template version (the EFFECTIVE version: the draft
 * marker's — the deployed shell doesn't publish one, see capabilities.ts).
 * null/malformed ⇒ the baseline set. Pure; the same epoch gives the same list.
 */
export function blockCatalog(templateVersion: string | null): readonly BlockSpec[] {
  return BLOCK_ENTRIES.filter((b) => shownAt(b.since, templateVersion)).map((b) => ({ ...b, variants: blockVariantValuesAt(b.id, templateVersion) }))
}

const hintCache = new Map<string, string>()

// Cached per catalog epoch: every version that sees the same vocabulary gets
// byte-identical text, so the prompt-cache prefix only moves when a new
// variant actually becomes available to the site.
export function blockCatalogHint(templateVersion: string | null): string {
  const epoch = vocabularyEpoch(templateVersion)
  const cached = hintCache.get(epoch)
  if (cached !== undefined) return cached
  const blocks = blockCatalog(epoch).map((b) => {
    const variants = b.variants.length ? ` (variants: ${b.variants.join(' | ')})` : ''
    const tokens = b.tokens ? ` Uses: ${b.tokens}.` : ''
    return `- [data-block="${b.id}"]${variants}: ${b.purpose}${tokens}`
  })
  const chrome = chromeCatalog(epoch).map((c) => `- [data-component="${c.id}"]: ${c.purpose}`)
  const hint = ['BLOCK VOCABULARY (every block carries data-block on its outer element)', ...blocks, '', 'SITE CHROME (data-component)', ...chrome].join('\n')
  hintCache.set(epoch, hint)
  return hint
}
