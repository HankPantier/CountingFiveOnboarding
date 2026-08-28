// ---------------------------------------------------------------------------
// Assemble one generated page into a single Divi Builder shortcode string.
// Part of the throwaway Divi/WordPress export bridge (see ./README.md).
// ---------------------------------------------------------------------------

import { siteHost, internalizeHref } from '@/lib/content/deliverable-builder'
import { markdownToHtml } from './markdown'
import {
  parseDiviSections,
  parseCards,
  parseQA,
  basicContentBlock,
  subPageHeader,
  copyImageBlock,
  cardGridBlock,
  ctaBlock,
  accordionBlock,
  pricingTablesBlock,
  type DiviSection,
  type QA,
} from './blocks'
import type { PricingPlansConfig } from '@/types/pricing-plans'

export type DiviPageInput = {
  page_title: string
  page_url: string
  hero_block: string | null
  hero_variant: string | null
  hero_image_alt: string | null
  hero_subhead: string | null
  hero_image_query: string | null
  content_markdown: string | null
  faq_block: unknown
  cta: { text: string; url: string } | null
}

function colsFromVariant(variant: string | undefined, fallback: number): number {
  const m = (variant ?? '').match(/(\d+)/)
  const n = m ? Number(m[1]) : NaN
  return n >= 1 && n <= 4 ? n : fallback
}

// Rewrite inline markdown links on the firm's own host to root-relative so a
// migrated page doesn't hard-jump back to the old site.
function internalizeLinks(md: string, host: string): string {
  return md.replace(
    /(!?)(\]\()(https?:\/\/[^)\s]+)/g,
    (full, bang: string, open: string, url: string) =>
      bang ? full : open + internalizeHref(url, host)
  )
}

function headingHtml(section: DiviSection): string {
  return `<h2>${section.heading}</h2>\n${markdownToHtml(section.content)}`
}

// Pull the first markdown link out of a section body for a CTA fallback.
function firstLink(content: string): { text: string; url: string } | null {
  const m = content.match(/\[([^\]]+)\]\(([^)\s]+)\)/)
  return m ? { text: m[1].trim(), url: m[2].trim() } : null
}

function renderSection(
  section: DiviSection,
  images: Map<string, string>,
  pageCta: { text: string; url: string } | null,
  pricingPlans: PricingPlansConfig | null
): string {
  const imageUrl = section.query ? images.get(section.query.trim()) : undefined

  switch (section.blockId) {
    case 'pricing-plans': {
      // Config-driven: the page md is a minimal host, the tiers live in
      // content/pricing-plans.json (threaded in as pricingPlans).
      if (pricingPlans && pricingPlans.tiers.length > 0) return pricingTablesBlock(pricingPlans)
      return basicContentBlock(headingHtml(section))
    }

    case 'content-split': {
      const side = section.variant === 'image-left' ? 'image-left' : 'image-right'
      return copyImageBlock({
        heading: section.heading,
        bodyHtml: markdownToHtml(section.content),
        imageUrl,
        imageAlt: section.alt,
        side,
      })
    }

    case 'feature-grid':
    case 'service-cards':
    case 'industry-cards': {
      const cards = parseCards(section.content)
      if (cards.length === 0) return basicContentBlock(headingHtml(section))
      const cols = colsFromVariant(section.variant, section.blockId === 'service-cards' ? 3 : 3)
      return cardGridBlock(section.heading, cards, cols)
    }

    case 'cta-banner': {
      const link = pageCta ?? firstLink(section.content) ?? { text: 'Get in touch', url: '/contact/' }
      const bodyHtml = markdownToHtml(section.content.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1'))
      return ctaBlock({ heading: section.heading, bodyHtml, buttonText: link.text, buttonUrl: link.url })
    }

    case 'faq-accordion': {
      const qa = parseQA(section.content)
      if (qa.length === 0) return basicContentBlock(headingHtml(section))
      return accordionBlock(section.heading, qa)
    }

    default:
      // intro-text, content-prose, content-table, checklist-section,
      // process-steps, stats-bar, logo-bar, testimonials, team-grid,
      // content-cards, form, and anything new render as clean styled prose so
      // no content is ever dropped.
      return basicContentBlock(headingHtml(section))
  }
}

function renderHero(page: DiviPageInput, images: Map<string, string>, body: string): string {
  const heroBlock = page.hero_block ?? 'page-header'
  if (heroBlock !== 'hero' && heroBlock !== 'hero-split') {
    return subPageHeader(page.page_title, page.hero_subhead ?? undefined)
  }
  const firstHeading = body.match(/^##\s+(.+?)\s*$/m)
  const headline = firstHeading ? firstHeading[1].trim() : page.page_title
  const imageUrl = page.hero_image_query ? images.get(page.hero_image_query.trim()) : undefined
  const side = page.hero_variant === 'image-left' ? 'image-left' : 'image-right'
  return copyImageBlock({
    heading: headline,
    subhead: page.hero_subhead ?? undefined,
    bodyHtml: '',
    buttonText: page.cta?.text,
    buttonUrl: page.cta?.url,
    imageUrl,
    imageAlt: page.hero_image_alt ?? headline,
    side,
    hero: true,
  })
}

function faqFromColumn(raw: unknown): QA[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (it): it is { question: string; answer: string } =>
        !!it &&
        typeof it === 'object' &&
        typeof (it as { question?: unknown }).question === 'string' &&
        typeof (it as { answer?: unknown }).answer === 'string'
    )
    .map((it) => ({ question: it.question, answer: it.answer }))
}

// Every unique image query a page needs (hero + section images), so the caller
// can resolve them all up front.
export function collectPageQueries(page: DiviPageInput): string[] {
  const queries: string[] = []
  if (page.hero_image_query) queries.push(page.hero_image_query.trim())
  for (const s of parseDiviSections(page.content_markdown ?? '')) {
    if (s.query) queries.push(s.query.trim())
  }
  return queries.filter(Boolean)
}

export function buildPageDivi(
  page: DiviPageInput,
  images: Map<string, string>,
  websiteUrl: string,
  pricingPlans: PricingPlansConfig | null = null
): string {
  const host = siteHost(websiteUrl)
  const body = internalizeLinks(page.content_markdown ?? '', host)
  const sections = parseDiviSections(body)

  const parts: string[] = [renderHero(page, images, body)]
  for (const section of sections) {
    parts.push(renderSection(section, images, page.cta, pricingPlans))
  }

  // Append the structured FAQ unless the page already carried an inline
  // faq-accordion section.
  const hasInlineFaq = sections.some((s) => s.blockId === 'faq-accordion')
  if (!hasInlineFaq) {
    const faq = faqFromColumn(page.faq_block)
    if (faq.length > 0) {
      parts.push(accordionBlock(`Frequently Asked Questions`, faq))
    }
  }

  return parts.join('')
}
