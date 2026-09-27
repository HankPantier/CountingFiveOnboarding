// Pure. The block + chrome vocabulary the concept model may style, ported from
// the template's export-design-brief.ts BLOCK_CATALOG (component-library-spec).
// Limited to CSS-targetable ids (OVERRIDE_BLOCKS / CHROME_COMPONENTS) so the
// model never writes CSS the sanitizer would reject; client-center is added.
// Every block /design-specimen renders is listed (template block registry).
// Hints name SCOPED selectors wherever a bare element selector would also hit
// text on a different surface (e.g. a --color-primary panel vs the canvas).
import type { OVERRIDE_BLOCKS } from '@/lib/editor/theme-edit'
import type { CHROME_COMPONENTS } from '../css-targets'

export type BlockSpec = { id: (typeof OVERRIDE_BLOCKS)[number]; purpose: string; variants: string[]; tokens?: string }
export type ChromeSpec = { id: (typeof CHROME_COMPONENTS)[number]; purpose: string }

export const BLOCK_CATALOG: readonly BlockSpec[] = [
  {
    id: 'hero',
    purpose:
      'Above-the-fold opener. The statement variant is the Ink & Clay signature: light canvas, large grotesk display headline with ONE word promoted to the italic-serif accent in --color-action, a small-caps kicker, and a framed duotone side image. image/video/slider are full-bleed with a directional brand scrim.',
    variants: ['statement', 'image', 'video', 'slider'],
    tokens: '--font-heading, --font-accent, --color-action (accent + kicker), --color-primary (scrim)',
  },
  { id: 'hero-split', purpose: 'Two-column page opener with text + image.', variants: ['image-right', 'image-left'] },
  { id: 'page-header', purpose: 'Slim inner-page title bar.', variants: [], tokens: '--color-primary (bg), --color-near-white (text)' },
  { id: 'intro-text', purpose: 'Short headline + paragraph transition between sections.', variants: ['centered', 'left-aligned'] },
  { id: 'content-split', purpose: 'Narrative paragraph with a supporting image.', variants: ['image-right', 'image-left'] },
  { id: 'content-prose', purpose: 'Long-form copy with no supporting image.', variants: [] },
  { id: 'checklist-section', purpose: 'Benefits, inclusions or qualifying criteria.', variants: ['with-image', 'standalone'], tokens: '--color-action (check icon)' },
  { id: 'process-steps', purpose: 'Numbered how-it-works sequence.', variants: ['horizontal', 'vertical'] },
  { id: 'feature-grid', purpose: '3–8 equal-weight features with icon + short description.', variants: ['3-col', '4-col'] },
  { id: 'service-cards', purpose: '2–9 named services with descriptions and links.', variants: ['2-col', '3-col'] },
  { id: 'content-cards', purpose: 'Blog posts, articles or resources with images.', variants: ['3-col', '2-col'] },
  { id: 'team-grid', purpose: 'Staff or partner profiles with photos.', variants: ['2-col', '3-col', '4-col'] },
  { id: 'industry-cards', purpose: 'Industry / niche verticals with icons (often an ink band).', variants: ['3-col', '4-col'] },
  { id: 'testimonials', purpose: 'Client quotes or reviews.', variants: ['carousel', 'grid'] },
  { id: 'stats-bar', purpose: '3–4 numeric proof points.', variants: ['3-up', '4-up'], tokens: '--color-primary (bg), --color-near-white (text)' },
  { id: 'logo-bar', purpose: 'Certification badges or association logos.', variants: [] },
  { id: 'cta-banner', purpose: 'A direct call to action with a single button.', variants: ['color-bg', 'image-bg'], tokens: '--color-action, --color-primary, --color-near-white' },
  { id: 'pricing', purpose: 'Tiered packages with feature lists and prices.', variants: ['2-tier', '3-tier', '4-tier'] },
  { id: 'faq-accordion', purpose: 'Expandable question-and-answer pairs.', variants: [] },
  { id: 'form', purpose: 'Lead-capture, contact or newsletter form.', variants: ['contact', 'quote', 'newsletter', 'custom'] },
  { id: 'content-table', purpose: 'Comparison data, calendars or structured reference info.', variants: [] },
  { id: 'client-center', purpose: 'Client portal / secure-file links and logins.', variants: [] },
  {
    id: 'pricing-calculator',
    purpose:
      'Interactive fee estimator: service rows and option chips on the canvas, and a --color-primary estimate panel whose large price figure (a <p>, e.g. "~$169–$229") is set in --color-action — keep that figure and the other panel text legible on the primary (ideally ≥4.5:1), so adjust that pair or restyle the panel text only with [data-block="pricing-calculator"] .bg-primary p (a bare p also hits the labels on the light canvas).',
    variants: [],
    tokens: '--color-primary (estimate panel bg), --color-action (estimate figure + CTA), --color-primary-foreground (panel text)',
  },
  {
    id: 'pricing-plans',
    purpose:
      'Plan tier cards with a monthly/annual switch, an "all plans include" list and add-on cards. The most-popular tier is a --color-primary card (class bg-primary) with primary-foreground text, crowned by a "Most popular" pill in --color-action with white text; the other tiers and the lists sit on the canvas. Restyle the featured tier only with [data-block="pricing-plans"] .bg-primary … (a bare h3, span or li also hits the canvas cards).',
    variants: [],
    tokens: '--color-primary (featured tier bg + ring), --color-primary-foreground (featured text), --color-action (switch, "Most popular" pill, check icons)',
  },
  {
    id: 'booking',
    purpose:
      'Scheduling embed: a centred header (h2 + intro) above a third-party calendar (Calendly widget or iframe). Only the header and the embed\'s outer box are styleable — the calendar is cross-origin and ignores site CSS.',
    variants: [],
  },
  {
    id: 'contact-info',
    purpose: 'Firm contact details from brand.json: "Reach out" (phone/email/fax links) and "Visit" (address, hours) columns, each row led by a --color-primary icon.',
    variants: [],
    tokens: '--color-primary (icons, link hover)',
  },
  {
    id: 'map',
    purpose: 'Heading over a bordered, rounded 16:9 Google Maps iframe of the firm address. Style the heading and the frame box only (the map is cross-origin).',
    variants: [],
  },
  {
    id: 'resource-list',
    purpose: 'Downloadable resources as a card grid (title, description, outline Download button), always followed by a separate newsletter [data-block="form"] section.',
    variants: [],
  },
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
]

export function blockCatalogHint(): string {
  const blocks = BLOCK_CATALOG.map((b) => {
    const variants = b.variants.length ? ` (variants: ${b.variants.join(' | ')})` : ''
    const tokens = b.tokens ? ` Uses: ${b.tokens}.` : ''
    return `- [data-block="${b.id}"]${variants}: ${b.purpose}${tokens}`
  })
  const chrome = CHROME_CATALOG.map((c) => `- [data-component="${c.id}"]: ${c.purpose}`)
  return ['BLOCK VOCABULARY (every block carries data-block on its outer element)', ...blocks, '', 'SITE CHROME (data-component)', ...chrome].join('\n')
}
