# Phase II — Claude Code Instructions

This file orients you to the Phase II spec documents and tells you how to use them when building a CountingFive client website. Read this first, then read the relevant spec before touching any code.

---

## What Phase II Is

Phase I of this system is the AI onboarding chat agent that collects information from a CPA firm client and generates a content package (`.md` files, `brand.json`, `design.json`, `nav.json`, `llms.txt`, `robots.txt`, `sitemap.xml`) delivered as a downloadable zip.

Phase II is the **client website itself** — a separate Next.js repo per client that unpacks that content package and assembles it into a live website using a shared block component library.

---

## The Seven Spec Documents

Read the relevant spec before writing any code for that area. They are interdependent — read them in the order listed if starting fresh.

| File | What it covers | Read before... |
|---|---|---|
| `component-library-spec.md` | The 21 block definitions — IDs, purposes, variants, content slots, token references. The vocabulary for everything else. | Any other spec. |
| `block-annotation-spec.md` | How block recommendations are embedded in `.md` files (frontmatter + inline comments), FAQ auto-append logic, and how Claude chooses blocks during Phase I content generation. | `content-assembly-spec.md` |
| `component-library-build-spec.md` | TypeScript interfaces, JSX markup patterns, shadcn/ui usage, server/client designations, and the palette → CSS variable theme system. | Building any block component. |
| `content-assembly-spec.md` | The full pipeline from `.md` file to rendered page: section parsing, typed prop extraction per block, `BlockRenderer`, and the hybrid markdown strategy. | Building the assembly layer. |
| `navigation-spec.md` | `nav.json` format, `NavBar` component (shadcn `NavigationMenu` + mobile `Sheet`), scroll behavior, and the admin nav editor. | Building navigation. |
| `footer-spec.md` | Footer layout, data sourced from `nav.json` + `brand.json`, certifications bar, social icons, legal bar. | Building the footer. |
| `page-wrapper-spec.md` | `RootLayout`, theme injection, font loading, `PageLayout`, SEO metadata, schema JSON-LD, full-bleed pattern. | Building the page shell. |

---

## Architecture in Brief

- **One repo per client.** Each client site is a separate Next.js 15 (App Router, TypeScript) repo scaffolded from a shared template.
- **Content lives in `/content/`.** The deliverable zip from Phase I is unzipped here. Do not edit these files manually — they are the source of truth.
- **Blocks are in `/src/components/blocks/`.** 21 components. Tailwind + shadcn/ui throughout.
- **Assembly is in `/src/lib/assembly/`.** Parses `.md` → typed props → `BlockRenderer`.
- **Theme is generated, not hand-written.** Run `scripts/generate-theme.ts` once after unzipping the content package. It reads `content/brand.json` + `content/design.json` and writes `src/styles/theme.css` and the font imports in `app/layout.tsx`. Do not edit `theme.css` manually.
- **CSS authoring is deferred.** The specs define token names and Tailwind class patterns. Per-client visual polish (spacing tweaks, shadow depth, etc.) happens after the component library is functionally complete.

---

## Starting a New Client Site

1. **Unzip the content package** into `/content/` in the repo root.
2. **Run the theme generator:** `npx tsx scripts/generate-theme.ts`
   - This writes `src/styles/theme.css` (CSS custom properties from palette)
   - This updates `app/layout.tsx` with the correct `next/font/google` imports for this client's fonts
3. **Curate the nav:** Open `content/nav.json`, trim any pages that shouldn't appear in navigation, and adjust labels if needed.
4. **Build or verify the block components** match the interfaces in `component-library-build-spec.md`.
5. **Run the dev server** and navigate to any page — the assembly system reads `/content/pages/*.md` and renders blocks automatically.

---

## Key Conventions

### Block annotations in `.md` files
Every section in a page `.md` file is preceded by an HTML comment:
```
<!-- block: feature-grid | variant: 3-col -->
## Section Heading
```
The assembler splits on these comments to identify which block to render for each section. The frontmatter declares the hero block separately (`hero:`, `hero_variant:`, `hero_image:`). Never remove or alter these annotations — they are the page's structural schema.

### FAQ is always auto-appended
The `faq-accordion` block is never written inline by hand. It is appended programmatically by `deliverable-builder.ts` in the Phase I pipeline using the structured `faq_block` data from `generated_pages`. If a page is missing its FAQ section, check whether `faq_block` was populated in the database, not the `.md` file.

### Structured vs. prose markdown
- **Structured blocks** (feature-grid, service-cards, team-grid, pricing, process-steps, stats-bar, checklist-section, testimonials) — their section content is written by Claude in a specific list format and pre-parsed into typed arrays by `lib/assembly/extract-block-props.ts`. See `content-assembly-spec.md` for the exact format per block.
- **Prose blocks** (intro-text, content-split, content-prose, cta-banner) — their body content is raw markdown passed to `react-markdown` via the `<Prose>` component.

### Server vs. client components
Default to Server Components. Only the following blocks require `'use client'`:
`Hero` (slider variant), `Testimonials` (carousel), `FaqAccordion`, `Form`, `NavBar`, `Pricing` (if toggle added).

### Theme tokens, not hex values
Never hardcode hex values in component markup. Always use Tailwind classes that reference the CSS custom properties (`bg-primary`, `text-foreground`, `border-border`, etc.). The full mapping is in `component-library-build-spec.md` under "Theme System."

### Full-bleed blocks
`hero`, `page-header`, `stats-bar`, `cta-banner`, and `logo-bar` set `fullBleed` on the `<Section>` wrapper. Their backgrounds span the full viewport width; inner content is still max-width constrained. All other blocks are contained.

### `content/` files are read-only at runtime
`content/nav.json`, `content/brand.json`, `content/design.json`, and all `.md` files are read at build time via `lib/nav/get-nav-config.ts`, `lib/brand/get-brand-config.ts`, and `lib/content/get-page.ts`. Do not write to these files from application code.

---

## File Structure Reference

```
/                           ← client site repo root
├── content/                ← unzipped from Phase I deliverable — do not edit
│   ├── pages/
│   │   └── *.md            ← one file per confirmed page, with block annotations
│   ├── nav.json            ← seeded from sitemap, manually curated
│   ├── brand.json          ← palette, firm info, social links, certifications
│   ├── design.json         ← typography pairing, radius, spacing tokens
│   ├── llms.txt
│   ├── llms-full.txt
│   ├── robots.txt
│   └── sitemap.xml
├── src/
│   ├── app/
│   │   ├── layout.tsx      ← RootLayout: theme, fonts, nav, footer
│   │   ├── page.tsx        ← Homepage
│   │   └── [...slug]/
│   │       └── page.tsx    ← Dynamic page route + generateMetadata
│   ├── components/
│   │   ├── blocks/         ← 21 block components + Section.tsx + Icon.tsx
│   │   ├── assembly/
│   │   │   └── BlockRenderer.tsx
│   │   ├── layout/
│   │   │   ├── PageLayout.tsx
│   │   │   └── SchemaScript.tsx
│   │   ├── nav/
│   │   │   ├── NavBar.tsx
│   │   │   └── MobileNav.tsx
│   │   └── footer/
│   │       ├── Footer.tsx
│   │       └── SocialIcon.tsx
│   ├── lib/
│   │   ├── assembly/
│   │   │   ├── parse-page-md.ts
│   │   │   ├── extract-block-props.ts
│   │   │   └── md-utils.ts
│   │   ├── content/
│   │   │   └── get-page.ts
│   │   ├── nav/
│   │   │   ├── types.ts
│   │   │   └── get-nav-config.ts
│   │   ├── brand/
│   │   │   ├── types.ts
│   │   │   └── get-brand-config.ts
│   │   └── theme/
│   │       └── get-theme-vars.ts
│   └── styles/
│       ├── globals.css
│       └── theme.css       ← generated by scripts/generate-theme.ts — do not edit
├── scripts/
│   └── generate-theme.ts   ← run once during site setup
└── site.config.ts          ← siteUrl, legalLinks, form endpoints
```

---

## What Is Not in These Specs

- **CSS authoring / visual polish.** Token names are defined; actual spacing, shadow, and typographic fine-tuning per client is a separate pass after the library is built.
- **Form submission handling.** The `Form` block provides markup only. Endpoint wiring (email, CRM, etc.) is per-client configuration in `site.config.ts`.
- **CMS or database.** Content is file-based. There is no runtime database on the client site.
- **Image optimization pipeline.** Images are referenced by filename. Next.js `<Image>` optimization and asset hosting decisions are per-client.
- **The Phase I onboarding app.** That is a separate codebase (`counting-five-onboarding`). These specs cover only the client-facing website built from Phase I's output.
