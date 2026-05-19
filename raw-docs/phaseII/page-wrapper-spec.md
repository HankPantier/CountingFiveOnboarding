# Page Wrapper Spec

**Version:** 1.0  
**Status:** Draft  
**Companion docs:** `navigation-spec.md`, `footer-spec.md`, `content-assembly-spec.md`

---

## Overview

The page wrapper is the full shell that holds nav, content blocks, and footer for every client site page. It has three layers:

1. **`RootLayout`** — HTML shell, theme injection, nav, footer. Runs once for the entire app.
2. **`PageLayout`** — Per-page wrapper. Handles hero extraction, top padding offset for the fixed nav, and optional page-level background.
3. **`SectionWrapper`** — Already defined in the block library (`Section.tsx`). Controls full-bleed vs. contained layout per block.

---

## Theme Injection

Client palette → CSS custom properties → all Tailwind classes that reference those properties.

This happens in `RootLayout` via a `<style>` tag generated from `design.json` and `brand.json`. It runs server-side so there is no flash of unstyled content.

```tsx
// app/layout.tsx

import { getThemeVars } from '@/lib/theme/get-theme-vars'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const themeVars = getThemeVars()   // reads brand.json + design.json, returns CSS string
  // ...
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeVars }} />
      </head>
      {/* ... */}
    </html>
  )
}
```

```typescript
// lib/theme/get-theme-vars.ts

import chroma from 'chroma-js'
import brandJson from '@/content/brand.json'
import designJson from '@/content/design.json'

function toHsl(hex: string): string {
  const [h, s, l] = chroma(hex).hsl()
  return `${Math.round(h ?? 0)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

export function getThemeVars(): string {
  const { palette } = brandJson
  const { typography, radius } = designJson

  return `:root {
    /* shadcn/ui color system */
    --background:           ${toHsl(palette.nearWhite.hex)};
    --foreground:           ${toHsl(palette.nearBlack.hex)};
    --primary:              ${toHsl(palette.primary.hex)};
    --primary-foreground:   ${toHsl(palette.nearWhite.hex)};
    --secondary:            ${toHsl(palette.secondary.hex)};
    --secondary-foreground: ${toHsl(palette.nearWhite.hex)};
    --accent:               ${toHsl(palette.action.hex)};
    --accent-foreground:    ${toHsl(palette.nearWhite.hex)};
    --muted:                ${toHsl(palette.nearWhite.hex)};
    --muted-foreground:     ${toHsl(palette.nearBlack.hex)};
    --card:                 ${toHsl(palette.nearWhite.hex)};
    --card-foreground:      ${toHsl(palette.nearBlack.hex)};
    --border:               ${toHsl(palette.primary.hex)};
    --ring:                 ${toHsl(palette.primary.hex)};
    --radius:               ${radius ?? '0.5rem'};

    /* Custom site tokens */
    --complementary:        ${toHsl(palette.complementary.hex)};
    --surface:              ${toHsl(palette.nearWhite.hex)};

    /* Typography */
    --font-heading:         '${typography.headingFont}', sans-serif;
    --font-body:            '${typography.bodyFont}', sans-serif;
  }`
}
```

### Typography Loading

Font families declared in `design.json` are loaded via Next.js `next/font/google` in the root layout. Two fonts maximum.

```typescript
// lib/theme/load-fonts.ts

import { design } from '@/content/design.json'

// This is evaluated at build time — fonts must be known statically.
// Supported heading/body font combinations are pre-defined; the design.json
// references a font key that maps to a Next.js font import.

export const FONT_MAP = {
  'Inter':        () => import('@next/font/google').then(m => m.Inter({ subsets: ['latin'], variable: '--font-heading' })),
  'Playfair Display': () => import('@next/font/google').then(m => m.Playfair_Display({ subsets: ['latin'], variable: '--font-heading' })),
  'Open Sans':    () => import('@next/font/google').then(m => m.Open_Sans({ subsets: ['latin'], variable: '--font-body' })),
  'Lato':         () => import('@next/font/google').then(m => m.Lato({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-body' })),
  // ... extend as new font pairings are added to the type catalog
}
```

In practice, the client site's `layout.tsx` statically imports the two fonts defined for that client and injects them as CSS variables. The theme generation script (`generate-theme.ts`) outputs the complete `layout.tsx` with the correct static imports — this avoids the limitation that `next/font` cannot be called dynamically.

---

## `RootLayout`

Full root layout combining theme, nav, and footer:

```tsx
// app/layout.tsx

import type { Metadata } from 'next'
import { Inter, Open_Sans } from 'next/font/google'   // generated statically per client
import { NavBar } from '@/components/nav/NavBar'
import { Footer } from '@/components/footer/Footer'
import { getNavConfig } from '@/lib/nav/get-nav-config'
import { getBrandConfig } from '@/lib/brand/get-brand-config'
import { getThemeVars } from '@/lib/theme/get-theme-vars'
import siteConfig from '@/site.config'
import './globals.css'

// Font variables — these two imports are generated per client by generate-theme.ts
const headingFont = Inter({
  subsets: ['latin'],
  variable: '--font-heading',
  display: 'swap',
})
const bodyFont = Open_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const navConfig = getNavConfig()
  const brand = getBrandConfig()
  const themeVars = getThemeVars()

  return (
    <html lang="en" className={`${headingFont.variable} ${bodyFont.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeVars }} />
      </head>
      <body className="bg-background text-foreground font-body antialiased">
        <NavBar config={navConfig} />
        {children}
        <Footer
          navConfig={navConfig}
          brand={brand}
          legalLinks={siteConfig.legalLinks}
        />
      </body>
    </html>
  )
}
```

---

## `PageLayout` — Per-Page Wrapper

Each page route wraps its content in `PageLayout`. This component handles:
- Top padding offset to account for the fixed NavBar height (64px / 4rem)
- Hero extraction — the hero block sits outside the `pt-16` offset since it extends under the nav
- Optional page-level schema JSON-LD injection

```tsx
// components/layout/PageLayout.tsx

import type { PageFrontmatter } from '@/lib/assembly/parse-page-md'
import { SchemaScript } from './SchemaScript'

interface PageLayoutProps {
  frontmatter: PageFrontmatter
  heroSlot: React.ReactNode     // rendered Hero/PageHeader/HeroSplit block — sits above padding
  children: React.ReactNode     // all other blocks — sits below padding offset
}

export function PageLayout({ frontmatter, heroSlot, children }: PageLayoutProps) {
  return (
    <>
      {/* Schema JSON-LD */}
      <SchemaScript frontmatter={frontmatter} />

      {/* Hero — extends under the fixed nav bar, no top offset */}
      <div className="relative">
        {heroSlot}
      </div>

      {/* Body sections — padded to clear the fixed nav on non-hero pages */}
      <div>
        {children}
      </div>
    </>
  )
}
```

**Note on the hero/nav overlap:** The `hero` and `hero-split` blocks start at the very top of the viewport and visually sit behind the transparent nav. The `page-header` block has `pt-16` (64px) baked in to clear the nav, since it is not a full-bleed hero.

---

## SEO Head — Next.js Metadata API

Each page exports a `generateMetadata` function that populates the `<head>` from frontmatter:

```typescript
// app/[...slug]/page.tsx

import type { Metadata } from 'next'
import { parsePageMd } from '@/lib/assembly/parse-page-md'
import { getPageByUrl } from '@/lib/content/get-page'
import siteConfig from '@/site.config'

export async function generateMetadata({ params }: { params: { slug: string[] } }): Promise<Metadata> {
  const url = '/' + params.slug.join('/')
  const markdown = await getPageByUrl(url)
  const { frontmatter } = parsePageMd(markdown)

  return {
    title:       frontmatter.meta_title,
    description: frontmatter.meta_description,
    alternates: {
      canonical: frontmatter.canonical_url,
    },
    openGraph: {
      title:       frontmatter.meta_title,
      description: frontmatter.meta_description,
      url:         frontmatter.canonical_url,
      siteName:    siteConfig.siteName,
      type:        'website',
    },
    keywords: [
      frontmatter.target_keyword,
      ...frontmatter.secondary_keywords,
    ].filter(Boolean),
  }
}
```

### Homepage Metadata

The homepage (`app/page.tsx`) has its own `generateMetadata` that pulls from `content/pages/home.md`.

---

## Schema JSON-LD Injection

Per-page structured data is injected as a `<script type="application/ld+json">` tag via the `SchemaScript` component:

```tsx
// components/layout/SchemaScript.tsx

import type { PageFrontmatter } from '@/lib/assembly/parse-page-md'
import brandJson from '@/content/brand.json'
import siteConfig from '@/site.config'

interface SchemaScriptProps {
  frontmatter: PageFrontmatter
}

export function SchemaScript({ frontmatter }: SchemaScriptProps) {
  const schema = buildSchema(frontmatter)
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}

function buildSchema(fm: PageFrontmatter) {
  const base = {
    '@context': 'https://schema.org',
    '@type':    fm.schema_markup ?? 'WebPage',
    'name':     fm.meta_title,
    'description': fm.meta_description,
    'url':      fm.canonical_url,
  }

  // Enrich with LocalBusiness on Service/HomePage types
  if (['Service', 'LocalBusiness', 'WebPage'].includes(fm.schema_markup ?? '')) {
    return {
      ...base,
      'provider': {
        '@type': 'LocalBusiness',
        'name':  brandJson.firm.name,
        'telephone': brandJson.firm.phone,
        'address': {
          '@type':           'PostalAddress',
          'streetAddress':   brandJson.firm.address.street,
          'addressLocality': brandJson.firm.address.city,
          'addressRegion':   brandJson.firm.address.state,
          'postalCode':      brandJson.firm.address.zip,
        }
      }
    }
  }

  // Add FAQ schema when faq_block is present
  if (fm.faq_block && fm.faq_block.length > 0) {
    return [
      base,
      {
        '@context': 'https://schema.org',
        '@type':    'FAQPage',
        'mainEntity': fm.faq_block.map(item => ({
          '@type':          'Question',
          'name':           item.question,
          'acceptedAnswer': { '@type': 'Answer', 'text': item.answer }
        }))
      }
    ]
  }

  return base
}
```

---

## Full Page Route

Putting it all together — the full page rendering route:

```tsx
// app/[...slug]/page.tsx

import type { Metadata } from 'next'
import { parsePageMd } from '@/lib/assembly/parse-page-md'
import { extractBlockProps } from '@/lib/assembly/extract-block-props'
import { getPageByUrl, getAllPageUrls } from '@/lib/content/get-page'
import { PageLayout } from '@/components/layout/PageLayout'
import { BlockRenderer } from '@/components/assembly/BlockRenderer'
import { Hero } from '@/components/blocks/Hero'
import { HeroSplit } from '@/components/blocks/HeroSplit'
import { PageHeader } from '@/components/blocks/PageHeader'

// Static params for build-time generation
export async function generateStaticParams() {
  const urls = await getAllPageUrls()
  return urls.map(url => ({
    slug: url.replace(/^\//, '').split('/')
  }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // ... (see SEO section above)
}

interface PageProps {
  params: { slug: string[] }
}

export default async function Page({ params }: PageProps) {
  const url = '/' + params.slug.join('/')
  const markdown = await getPageByUrl(url)
  const { frontmatter, sections } = parsePageMd(markdown)
  const blockProps = sections.map(s => extractBlockProps(s, frontmatter))

  // Render hero from frontmatter annotation
  const heroNode = renderHero(frontmatter, sections[0]?.rawContent ?? '')

  // Body sections (skip the first if it was the hero's H1/subhead source)
  const bodySections = sections

  return (
    <PageLayout frontmatter={frontmatter} heroSlot={heroNode}>
      {bodySections.map((_, i) => (
        <BlockRenderer key={i} {...blockProps[i]} />
      ))}
    </PageLayout>
  )
}

function renderHero(fm: PageFrontmatter, firstSectionContent: string) {
  // Extract H1 and opening paragraph for hero content
  const h1Match = firstSectionContent.match(/^#\s+(.+)$/m)
  const paraMatch = firstSectionContent.match(/^(?!#)(.{20,})/m)
  const headline = h1Match?.[1] ?? fm.title
  const subheadline = paraMatch?.[1] ?? fm.meta_description

  if (fm.hero === 'hero') {
    return (
      <Hero
        variant={(fm.hero_variant as 'image' | 'video' | 'slider') ?? 'image'}
        headline={headline}
        subheadline={subheadline}
        ctaPrimary={{ label: 'Learn More', url: '#' }}   // replaced by CTA from content
        backgroundAsset={fm.hero_image}
      />
    )
  }
  if (fm.hero === 'hero-split') {
    return (
      <HeroSplit
        variant={(fm.hero_variant as 'image-right' | 'image-left') ?? 'image-right'}
        headline={headline}
        subheadline={subheadline}
        ctaPrimary={{ label: 'Learn More', url: '#' }}
        image={fm.hero_image ?? ''}
        imageAlt={headline}
      />
    )
  }
  // Default: page-header
  return <PageHeader headline={headline} subheadline={subheadline} />
}
```

---

## `globals.css`

```css
/* src/styles/globals.css */

@tailwind base;
@tailwind components;
@tailwind utilities;

@import './theme.css';   /* generated by generate-theme.ts — do not edit */

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
    font-family: var(--font-body);
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-heading);
  }
}
```

---

## Full-Bleed vs. Contained Pattern

| Block | `Section fullBleed` | Reason |
|---|---|---|
| `hero` | true | Background spans full viewport |
| `hero-split` | false | Content-width layout |
| `page-header` | true | Background spans full viewport |
| `stats-bar` | true | Brand color band, edge to edge |
| `cta-banner` | true | Color/image background, edge to edge |
| `logo-bar` | true | Usually a tinted band |
| All other blocks | false | Max-width contained |

Full-bleed blocks manage their own inner max-width container. The `Section` wrapper handles this:

```tsx
// Full-bleed: outer div is w-full, inner div is max-w-7xl mx-auto
// Contained:  outer div is mx-auto max-w-7xl px-4 sm:px-6 lg:px-8
```

---

## File Structure Summary

```
src/
  app/
    layout.tsx                  — RootLayout: theme, nav, footer
    page.tsx                    — Homepage
    [...slug]/
      page.tsx                  — Dynamic page route
  components/
    layout/
      PageLayout.tsx            — Per-page wrapper (hero slot + body)
      SchemaScript.tsx          — JSON-LD injection
    assembly/
      BlockRenderer.tsx         — Block ID → component router
    blocks/                     — All 21 block components
    nav/                        — NavBar, MobileNav
    footer/                     — Footer, SocialIcon
  lib/
    theme/
      get-theme-vars.ts         — Palette → CSS custom properties
    assembly/
      parse-page-md.ts          — .md → frontmatter + RawSection[]
      extract-block-props.ts    — RawSection → typed block props
      md-utils.ts               — Parsing utilities
    content/
      get-page.ts               — Read .md files from content/pages/
    nav/
      types.ts
      get-nav-config.ts
    brand/
      types.ts
      get-brand-config.ts
  styles/
    globals.css
    theme.css                   — Generated — do not edit
content/                        — From deliverable zip (not src/)
  pages/
    *.md
  nav.json
  brand.json
  design.json
  llms.txt
  llms-full.txt
  robots.txt
  sitemap.xml
site.config.ts                  — Per-client: siteUrl, legalLinks, form endpoints
scripts/
  generate-theme.ts             — Run once during setup: palette → theme.css + layout.tsx fonts
```
