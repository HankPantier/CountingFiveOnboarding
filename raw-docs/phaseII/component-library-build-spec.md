# Component Library Build Spec

**Version:** 1.0  
**Status:** Draft  
**Companion docs:** `component-library-spec.md` (block definitions), `content-assembly-spec.md` (data pipeline), `page-wrapper-spec.md` (theme injection)

---

## Architecture Decisions

### Framework
- **Next.js 15 App Router** — one repo per client, scaffolded from a shared template
- **Tailwind CSS** — all styling via utility classes
- **shadcn/ui** — used throughout for interactive primitives and consistent component semantics
- **TypeScript strict mode** — all block props fully typed

### Server vs. Client Components

Blocks are Server Components by default. Only add `'use client'` when the block requires browser APIs, state, or event handlers.

| Client components | Reason |
|---|---|
| `Hero` (slider variant) | Carousel state, auto-advance timer |
| `Testimonials` (carousel variant) | Carousel state |
| `FaqAccordion` | Accordion open/close state |
| `Form` | Form state, submission handler |
| `NavBar` | Mobile menu state, scroll detection |
| `PricingBlock` | Toggle (monthly/annual) if needed |

All other blocks are Server Components.

### shadcn/ui Components Used

| shadcn component | Used in |
|---|---|
| `Button` | All CTAs, nav, form submit |
| `Card`, `CardHeader`, `CardContent`, `CardFooter` | service-cards, content-cards, team-grid, pricing, feature-grid |
| `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent` | faq-accordion |
| `NavigationMenu` (full suite) | NavBar desktop |
| `Sheet`, `SheetContent`, `SheetTrigger` | NavBar mobile drawer |
| `Carousel`, `CarouselContent`, `CarouselItem`, `CarouselNext`, `CarouselPrevious` | hero (slider), testimonials |
| `Badge` | page-header breadcrumb, pricing tier badges |
| `Separator` | footer column dividers |
| `Input`, `Textarea`, `Select`, `Label` | form block |

---

## Theme System

### How Client Palette Maps to CSS Variables

shadcn/ui is built on CSS custom properties. We map the client's locked palette (from `content_jobs.palette`) to shadcn's standard variable names. This is done once per client during site setup.

**Mapping:**

| Palette field | shadcn CSS variable | Tailwind class |
|---|---|---|
| `primary.hex` | `--primary` | `bg-primary`, `text-primary` |
| `nearWhite.hex` | `--primary-foreground` | `text-primary-foreground` |
| `secondary.hex` | `--secondary` | `bg-secondary`, `text-secondary` |
| `nearBlack.hex` | `--foreground` | `text-foreground` |
| `nearWhite.hex` | `--background` | `bg-background` |
| `action.hex` | `--accent` | `bg-accent`, `text-accent` |
| `nearBlack.hex` (light) | `--muted` | `bg-muted`, `text-muted-foreground` |
| `primary.hex` (border) | `--border` | `border-border` |
| `primary.hex` (ring) | `--ring` | `ring-ring` |

Custom (non-shadcn) variables also added:
```css
--complementary: [hex];  /* complementary color from palette */
--surface: [nearWhite slightly tinted];  /* card backgrounds */
```

### Theme Generation Script

A script reads `brand.md` from the deliverable package and writes `src/styles/theme.css`:

```typescript
// scripts/generate-theme.ts

import chroma from 'chroma-js'
import { palette } from '../brand.json'  // parsed from brand.md

function toHsl(hex: string): string {
  const [h, s, l] = chroma(hex).hsl()
  return `${Math.round(h ?? 0)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

const theme = `
:root {
  --background: ${toHsl(palette.nearWhite.hex)};
  --foreground: ${toHsl(palette.nearBlack.hex)};
  --primary: ${toHsl(palette.primary.hex)};
  --primary-foreground: ${toHsl(palette.nearWhite.hex)};
  --secondary: ${toHsl(palette.secondary.hex)};
  --secondary-foreground: ${toHsl(palette.nearWhite.hex)};
  --accent: ${toHsl(palette.action.hex)};
  --accent-foreground: ${toHsl(palette.nearWhite.hex)};
  --muted: ${toHsl(palette.nearWhite.hex)};
  --muted-foreground: ${toHsl(palette.nearBlack.hex)};
  --border: ${toHsl(palette.primary.hex)};
  --ring: ${toHsl(palette.primary.hex)};
  --surface: ${toHsl(palette.nearWhite.hex)};
  --complementary: ${toHsl(palette.complementary.hex)};
  --radius: 0.5rem;
}
`
```

This runs once during site setup. The generated `theme.css` is imported in `globals.css`.

---

## Standard Block Wrapper

Every block uses a shared `Section` wrapper that handles full-bleed vs. contained layout:

```tsx
// components/blocks/Section.tsx

interface SectionProps {
  id?: string
  fullBleed?: boolean       // if true, background fills viewport width
  className?: string
  children: React.ReactNode
}

export function Section({ id, fullBleed = false, className = '', children }: SectionProps) {
  return (
    <section id={id} className={`w-full ${className}`}>
      <div className={fullBleed ? 'w-full' : 'mx-auto max-w-7xl px-4 sm:px-6 lg:px-8'}>
        {children}
      </div>
    </section>
  )
}
```

Full-bleed blocks (`hero`, `stats-bar`, `cta-banner`, `logo-bar`) set `fullBleed` — their backgrounds span edge to edge while inner content is still max-width constrained.

---

## Typography Component

```tsx
// components/blocks/Typography.tsx
// Renders markdown prose content inside blocks

import ReactMarkdown from 'react-markdown'

interface ProseProps {
  children: string
  className?: string
}

export function Prose({ children, className = '' }: ProseProps) {
  return (
    <div className={`prose prose-lg max-w-none
      prose-headings:font-heading prose-headings:text-foreground
      prose-p:text-foreground prose-p:leading-relaxed
      prose-strong:text-foreground
      prose-a:text-primary prose-a:no-underline hover:prose-a:underline
      prose-ul:text-foreground prose-ol:text-foreground
      ${className}`}>
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  )
}
```

`Prose` is used for any markdown prose content slot. It is not used for structured data slots (card arrays, step lists, etc.) — those are pre-parsed into typed props.

---

## Block Build Patterns

The following details the markup pattern and prop interface for each block. Representative blocks are shown in full; remaining blocks follow the same structural pattern.

---

### `hero` — Full-Bleed Hero

**Component:** `'use client'` (slider variant); Server Component for image/video variants  
**shadcn:** `Button`, `Carousel` (slider only)

```tsx
// components/blocks/Hero.tsx

export interface HeroProps {
  variant: 'image' | 'video' | 'slider'
  headline: string
  subheadline: string
  ctaPrimary: { label: string; url: string }
  ctaSecondary?: { label: string; url: string }
  backgroundAsset?: string            // URL for image or video
  overlayOpacity?: number             // 0–1, default 0.4
  slides?: Array<{                    // slider only
    headline: string
    subheadline: string
    ctaPrimary: { label: string; url: string }
    backgroundAsset: string
  }>
}

export function Hero({ variant, headline, subheadline, ctaPrimary, ctaSecondary, backgroundAsset, overlayOpacity = 0.4, slides }: HeroProps) {
  return (
    <section className="relative w-full min-h-[70vh] flex items-center overflow-hidden">
      {/* Background layer */}
      {variant === 'image' && backgroundAsset && (
        <>
          <img src={backgroundAsset} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-foreground" style={{ opacity: overlayOpacity }} />
        </>
      )}
      {variant === 'video' && backgroundAsset && (
        <>
          <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover">
            <source src={backgroundAsset} type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-foreground" style={{ opacity: overlayOpacity }} />
        </>
      )}
      {(variant === 'image' || variant === 'video') && !backgroundAsset && (
        <div className="absolute inset-0 bg-primary" />
      )}

      {/* Content */}
      {variant !== 'slider' && (
        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-24">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-heading font-bold text-primary-foreground mb-6">
            {headline}
          </h1>
          <p className="text-lg sm:text-xl text-primary-foreground/90 max-w-2xl mb-8">
            {subheadline}
          </p>
          <div className="flex flex-wrap gap-4">
            <Button asChild size="lg">
              <a href={ctaPrimary.url}>{ctaPrimary.label}</a>
            </Button>
            {ctaSecondary && (
              <Button asChild variant="outline" size="lg" className="border-primary-foreground text-primary-foreground hover:bg-primary-foreground hover:text-primary">
                <a href={ctaSecondary.url}>{ctaSecondary.label}</a>
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Slider variant — uses shadcn Carousel */}
      {variant === 'slider' && slides && (
        <HeroSlider slides={slides} />
      )}
    </section>
  )
}
```

---

### `page-header` — Inner Page Header

**Component:** Server Component  
**shadcn:** `Badge`

```tsx
// components/blocks/PageHeader.tsx

export interface PageHeaderProps {
  headline: string
  subheadline?: string
  breadcrumb?: Array<{ label: string; url: string }>
}

export function PageHeader({ headline, subheadline, breadcrumb }: PageHeaderProps) {
  return (
    <section className="w-full bg-primary py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-sm text-primary-foreground/70">
            <a href="/" className="hover:text-primary-foreground transition-colors">Home</a>
            {breadcrumb.map((crumb, i) => (
              <span key={i} className="flex items-center gap-2">
                <span>/</span>
                {i === breadcrumb.length - 1 ? (
                  <span className="text-primary-foreground">{crumb.label}</span>
                ) : (
                  <a href={crumb.url} className="hover:text-primary-foreground transition-colors">{crumb.label}</a>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-bold text-primary-foreground">
          {headline}
        </h1>
        {subheadline && (
          <p className="mt-4 text-lg text-primary-foreground/80 max-w-2xl">{subheadline}</p>
        )}
      </div>
    </section>
  )
}
```

---

### `intro-text` — Section Transition

**Component:** Server Component  
**shadcn:** `Button`

```tsx
// components/blocks/IntroText.tsx

export interface IntroTextProps {
  variant: 'centered' | 'left-aligned'
  headline: string
  body: string                        // prose markdown
  cta?: { label: string; url: string }
}

export function IntroText({ variant, headline, body, cta }: IntroTextProps) {
  const alignment = variant === 'centered' ? 'text-center items-center' : 'text-left items-start'
  return (
    <Section className="py-16 sm:py-20">
      <div className={`flex flex-col ${alignment} max-w-3xl ${variant === 'centered' ? 'mx-auto' : ''}`}>
        <h2 className="text-3xl sm:text-4xl font-heading font-bold text-foreground mb-6">{headline}</h2>
        <Prose className={variant === 'centered' ? 'text-center' : ''}>{body}</Prose>
        {cta && (
          <Button asChild className="mt-8">
            <a href={cta.url}>{cta.label}</a>
          </Button>
        )}
      </div>
    </Section>
  )
}
```

---

### `content-split` — Text + Image Two-Column

**Component:** Server Component  
**shadcn:** `Button`

```tsx
// components/blocks/ContentSplit.tsx

export interface ContentSplitProps {
  variant: 'image-right' | 'image-left'
  headline: string
  body: string                        // prose markdown
  image: string
  imageAlt: string
  cta?: { label: string; url: string }
}

export function ContentSplit({ variant, headline, body, image, imageAlt, cta }: ContentSplitProps) {
  const imageFirst = variant === 'image-left'
  return (
    <Section className="py-16 sm:py-20">
      <div className={`grid grid-cols-1 lg:grid-cols-2 gap-12 items-center ${imageFirst ? '' : ''}`}>
        <div className={imageFirst ? 'order-2 lg:order-1' : ''}>
          <h2 className="text-3xl sm:text-4xl font-heading font-bold text-foreground mb-6">{headline}</h2>
          <Prose>{body}</Prose>
          {cta && (
            <Button asChild className="mt-8">
              <a href={cta.url}>{cta.label}</a>
            </Button>
          )}
        </div>
        <div className={imageFirst ? 'order-1 lg:order-2' : ''}>
          <img src={image} alt={imageAlt} className="w-full h-auto rounded-lg object-cover aspect-[4/3]" />
        </div>
      </div>
    </Section>
  )
}
```

---

### `feature-grid` — Icon + Title + Description Grid

**Component:** Server Component  
**shadcn:** `Card`, `CardHeader`, `CardContent`

```tsx
// components/blocks/FeatureGrid.tsx

export interface FeatureGridItem {
  icon: string          // icon name string (maps to icon library — see Icon component)
  title: string
  description: string
}

export interface FeatureGridProps {
  variant: '3-col' | '4-col'
  headline: string
  intro?: string
  items: FeatureGridItem[]
}

export function FeatureGrid({ variant, headline, intro, items }: FeatureGridProps) {
  const cols = variant === '4-col'
    ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
  return (
    <Section className="py-16 sm:py-20">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-heading font-bold text-foreground">{headline}</h2>
        {intro && <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">{intro}</p>}
      </div>
      <div className={`grid ${cols} gap-6`}>
        {items.map((item, i) => (
          <Card key={i} className="border-border bg-card">
            <CardHeader>
              <Icon name={item.icon} className="h-8 w-8 text-primary mb-2" />
              <h3 className="text-lg font-heading font-semibold text-foreground">{item.title}</h3>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground leading-relaxed">{item.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </Section>
  )
}
```

---

### `faq-accordion` — Expandable Q&A

**Component:** `'use client'`  
**shadcn:** `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent`

```tsx
// components/blocks/FaqAccordion.tsx
'use client'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'

export interface FaqItem {
  question: string
  answer: string
}

export interface FaqAccordionProps {
  headline: string
  items: FaqItem[]
}

export function FaqAccordion({ headline, items }: FaqAccordionProps) {
  return (
    <Section className="py-16 sm:py-20 bg-muted/30">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-heading font-bold text-foreground mb-10 text-center">{headline}</h2>
        <Accordion type="single" collapsible className="space-y-3">
          {items.map((item, i) => (
            <AccordionItem key={i} value={`item-${i}`} className="bg-card border border-border rounded-lg px-6">
              <AccordionTrigger className="text-left font-heading font-semibold text-foreground hover:text-primary hover:no-underline py-5">
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground leading-relaxed pb-5">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </Section>
  )
}
```

---

### `pricing` — Tier Cards

**Component:** Server Component (add `'use client'` only if monthly/annual toggle is added)  
**shadcn:** `Card`, `CardHeader`, `CardContent`, `CardFooter`, `Badge`, `Button`

```tsx
// components/blocks/Pricing.tsx

export interface PricingTier {
  name: string
  price: string
  pricePeriod?: string               // e.g. "/ month"
  description: string
  features: string[]
  cta: { label: string; url: string }
  highlighted?: boolean              // true = recommended, renders with primary bg
}

export interface PricingProps {
  variant: '2-tier' | '3-tier' | '4-tier'
  headline: string
  intro?: string
  tiers: PricingTier[]
  disclaimer?: string
}

export function Pricing({ variant, headline, intro, tiers, disclaimer }: PricingProps) {
  const cols = { '2-tier': 'lg:grid-cols-2', '3-tier': 'lg:grid-cols-3', '4-tier': 'lg:grid-cols-4' }[variant]
  return (
    <Section className="py-16 sm:py-20">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-heading font-bold text-foreground">{headline}</h2>
        {intro && <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">{intro}</p>}
      </div>
      <div className={`grid grid-cols-1 ${cols} gap-6 items-stretch`}>
        {tiers.map((tier, i) => (
          <Card key={i} className={`flex flex-col border-2 ${tier.highlighted ? 'border-primary bg-primary' : 'border-border bg-card'}`}>
            <CardHeader className="pb-0">
              {tier.highlighted && <Badge className="w-fit mb-2 bg-accent text-accent-foreground">Recommended</Badge>}
              <h3 className={`text-xl font-heading font-bold ${tier.highlighted ? 'text-primary-foreground' : 'text-foreground'}`}>{tier.name}</h3>
              <div className="flex items-baseline gap-1 mt-2">
                <span className={`text-4xl font-bold font-heading ${tier.highlighted ? 'text-primary-foreground' : 'text-foreground'}`}>{tier.price}</span>
                {tier.pricePeriod && <span className={`text-sm ${tier.highlighted ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{tier.pricePeriod}</span>}
              </div>
              <p className={`text-sm mt-2 ${tier.highlighted ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{tier.description}</p>
            </CardHeader>
            <CardContent className="flex-1 pt-6">
              <ul className="space-y-3">
                {tier.features.map((feature, j) => (
                  <li key={j} className={`flex items-start gap-3 text-sm ${tier.highlighted ? 'text-primary-foreground' : 'text-foreground'}`}>
                    <span className={`mt-0.5 shrink-0 ${tier.highlighted ? 'text-accent' : 'text-accent'}`}>✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button asChild className="w-full" variant={tier.highlighted ? 'secondary' : 'default'}>
                <a href={tier.cta.url}>{tier.cta.label}</a>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
      {disclaimer && <p className="text-center text-sm text-muted-foreground mt-6">{disclaimer}</p>}
    </Section>
  )
}
```

---

### `form` — Generic Lead Capture

**Component:** `'use client'`  
**shadcn:** `Input`, `Textarea`, `Select`, `Label`, `Button`

```tsx
// components/blocks/Form.tsx
'use client'

export interface FormProps {
  variant: 'contact' | 'quote' | 'newsletter'
  headline: string
  intro?: string
  sidebarContent?: string            // markdown — office info, hours, etc.
  successMessage?: string
  submitEndpoint: string             // configured per client — e.g. '/api/contact'
}
```

The `submitEndpoint` prop is set in `site.config.ts` per client (email routing, CRM integration, etc.) — it is not part of the block library itself.

---

### Remaining Blocks — Interface Reference

All remaining blocks follow the patterns established above. TypeScript interfaces:

```tsx
// hero-split
interface HeroSplitProps {
  variant: 'image-right' | 'image-left'
  headline: string; subheadline: string
  ctaPrimary: { label: string; url: string }
  ctaSecondary?: { label: string; url: string }
  image: string; imageAlt: string
}

// content-prose
interface ContentProseProps { headline?: string; body: string }

// checklist-section
interface ChecklistSectionProps {
  variant: 'with-image' | 'standalone'
  headline: string; intro?: string
  items: string[]
  image?: string; imageAlt?: string
  cta?: { label: string; url: string }
}

// process-steps
interface Step { number: string; title: string; description: string }
interface ProcessStepsProps {
  variant: 'horizontal' | 'vertical'
  headline: string; intro?: string; steps: Step[]
  cta?: { label: string; url: string }
}

// service-cards
interface ServiceCard { title: string; description: string; url: string; image?: string }
interface ServiceCardsProps {
  variant: '2-col' | '3-col'
  headline: string; intro?: string; cards: ServiceCard[]
}

// content-cards
interface ContentCard { title: string; excerpt: string; url: string; image: string; date?: string }
interface ContentCardsProps {
  variant: '3-col' | '2-col'
  headline: string; cards: ContentCard[]
  cta?: { label: string; url: string }
}

// team-grid
interface TeamMember { name: string; title: string; credentials?: string; bio: string; photo: string; photoAlt: string }
interface TeamGridProps {
  variant: '2-col' | '3-col' | '4-col'
  headline: string; intro?: string; members: TeamMember[]
}

// industry-cards
interface IndustryCard { icon: string; title: string; description: string; url?: string }
interface IndustryCardsProps {
  variant: '3-col' | '4-col'
  headline: string; intro?: string; industries: IndustryCard[]
}

// testimonials
interface Testimonial { quote: string; name: string; title: string; company?: string; rating?: number }
interface TestimonialsProps {
  variant: 'carousel' | 'grid'
  headline?: string; testimonials: Testimonial[]
}

// stats-bar
interface Stat { value: string; label: string }
interface StatsBarProps { variant: '3-up' | '4-up'; stats: Stat[] }

// logo-bar
interface Logo { src: string; alt: string; url?: string }
interface LogoBarProps { headline?: string; logos: Logo[] }

// cta-banner
interface CtaBannerProps {
  variant: 'color-bg' | 'image-bg'
  headline: string; body?: string
  ctaPrimary: { label: string; url: string }
  ctaSecondary?: { label: string; url: string }
  backgroundAsset?: string
}

// content-table
interface ContentTableProps {
  headline?: string; intro?: string
  headers: string[]; rows: string[][]
  caption?: string
}
```

---

## Icon Component

Blocks reference icons by name string. A single `Icon` component maps names to SVG markup:

```tsx
// components/blocks/Icon.tsx

// Recommended: use lucide-react (already available, matches shadcn conventions)
import { icons } from 'lucide-react'

interface IconProps {
  name: string
  className?: string
}

export function Icon({ name, className }: IconProps) {
  const LucideIcon = icons[name as keyof typeof icons]
  if (!LucideIcon) return <span className={className} aria-hidden>●</span>
  return <LucideIcon className={className} aria-hidden />
}
```

Claude's content generation prompt should use lucide icon names when annotating feature-grid, process-steps, and industry-cards content. A reference list of common CPA firm icons: `Calculator`, `BarChart`, `FileText`, `Users`, `Shield`, `Building2`, `TrendingUp`, `Landmark`, `BookOpen`, `ClipboardCheck`.

---

## File Structure

```
src/
  components/
    blocks/
      Hero.tsx
      PageHeader.tsx
      HeroSplit.tsx
      IntroText.tsx
      ContentSplit.tsx
      ContentProse.tsx
      ChecklistSection.tsx
      ProcessSteps.tsx
      FeatureGrid.tsx
      ServiceCards.tsx
      ContentCards.tsx
      TeamGrid.tsx
      IndustryCards.tsx
      Testimonials.tsx
      StatsBar.tsx
      LogoBar.tsx
      CtaBanner.tsx
      Pricing.tsx
      FaqAccordion.tsx
      Form.tsx
      ContentTable.tsx
      Section.tsx         — shared wrapper
      Icon.tsx            — shared icon router
    assembly/
      BlockRenderer.tsx
      Typography.tsx      — Prose component
  styles/
    globals.css           — imports theme.css + Tailwind base
    theme.css             — generated from brand.md (do not edit manually)
scripts/
  generate-theme.ts       — palette → CSS variables
```
