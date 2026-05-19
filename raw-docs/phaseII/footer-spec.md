# Footer Spec

**Version:** 1.0  
**Status:** Draft

---

## Overview

The footer is a Server Component built from three data sources in the client repo: `nav.json` (for page links), `brand.json` (for firm contact info and social links), and `design.json` (for visual styling tokens). No manual footer configuration is needed beyond what's already in those files.

---

## Data Sources

| Data | Source file | Field |
|---|---|---|
| Firm name | `brand.json` | `firm.name` |
| Tagline / positioning | `brand.json` | `firm.tagline` |
| Address | `brand.json` | `firm.address` |
| Phone | `brand.json` | `firm.phone` |
| Email | `brand.json` | `firm.email` |
| Office hours | `brand.json` | `firm.hours` |
| Social links | `brand.json` | `firm.social` |
| Certification logos | `brand.json` | `firm.certificationLogos` |
| Nav columns | `nav.json` | `items` (reuses nav structure) |
| Copyright year | Runtime | `new Date().getFullYear()` |
| Privacy / legal links | `site.config.ts` | `legal.privacyUrl`, `legal.termsUrl` |

### `brand.json` Shape (Footer-Relevant Fields)

```typescript
interface BrandJson {
  firm: {
    name: string
    tagline?: string
    address: {
      street: string
      city: string
      state: string
      zip: string
    }
    phone: string
    email: string
    hours?: string                  // e.g. "Mon–Fri: 8am–5pm"
    social?: {
      linkedin?: string
      facebook?: string
      twitter?: string
      instagram?: string
      youtube?: string
    }
    certificationLogos?: Array<{
      src: string
      alt: string
      url?: string
    }>
  }
  // ... palette, voice fields not used by footer
}
```

---

## Footer Layout

Three-zone layout:

```
┌─────────────────────────────────────────────────────────────────┐
│  MAIN FOOTER (bg-primary, text-primary-foreground)              │
│                                                                 │
│  [Logo + Tagline]  [Nav Column 1]  [Nav Column 2]  [Contact]   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  CERTIFICATIONS BAR (bg-primary/80)                             │
│  [Logo] [Logo] [Logo] [Logo] [Logo]                             │
├─────────────────────────────────────────────────────────────────┤
│  LEGAL BAR (bg-primary/60 or bg-foreground)                     │
│  © 2025 Firm Name · Privacy Policy · Terms of Use              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component

```tsx
// components/footer/Footer.tsx

import Link from 'next/link'
import { Separator } from '@/components/ui/separator'
import type { NavConfig } from '@/lib/nav/types'
import type { BrandJson } from '@/lib/brand/types'
import { SocialIcon } from './SocialIcon'

interface FooterProps {
  navConfig: NavConfig
  brand: BrandJson
  legalLinks?: { label: string; url: string }[]
}

export function Footer({ navConfig, brand, legalLinks = [] }: FooterProps) {
  const year = new Date().getFullYear()

  // Use top-level nav items as footer columns (max 4 columns shown)
  const footerColumns = navConfig.items.slice(0, 4)

  return (
    <footer className="w-full bg-primary text-primary-foreground">

      {/* Main footer body */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">

          {/* Brand column */}
          <div className="lg:col-span-1">
            <Link href="/">
              {/* Use white logo variant — brand.json should reference logo-white.svg */}
              <img src="/images/logo-white.svg" alt={brand.firm.name} className="h-8 w-auto mb-4" />
            </Link>
            {brand.firm.tagline && (
              <p className="text-sm text-primary-foreground/75 leading-relaxed mb-6">
                {brand.firm.tagline}
              </p>
            )}
            {/* Social icons */}
            {brand.firm.social && (
              <div className="flex gap-3">
                {Object.entries(brand.firm.social).map(([platform, url]) =>
                  url ? (
                    <a key={platform} href={url} target="_blank" rel="noopener noreferrer"
                      aria-label={`${brand.firm.name} on ${platform}`}
                      className="text-primary-foreground/60 hover:text-primary-foreground transition-colors">
                      <SocialIcon platform={platform} className="h-5 w-5" />
                    </a>
                  ) : null
                )}
              </div>
            )}
          </div>

          {/* Nav columns — rendered from nav.json items */}
          {footerColumns.map(item => (
            <div key={item.url}>
              <h3 className="text-sm font-heading font-semibold text-primary-foreground mb-4 uppercase tracking-wide">
                {item.label}
              </h3>
              <ul className="space-y-2">
                {(item.children ?? [{ label: item.label, url: item.url }]).map(child => (
                  <li key={child.url}>
                    <Link href={child.url}
                      className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">
                      {child.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Contact column — always last */}
          <div>
            <h3 className="text-sm font-heading font-semibold text-primary-foreground mb-4 uppercase tracking-wide">
              Contact
            </h3>
            <address className="not-italic space-y-2">
              <p className="text-sm text-primary-foreground/70 leading-relaxed">
                {brand.firm.address.street}<br />
                {brand.firm.address.city}, {brand.firm.address.state} {brand.firm.address.zip}
              </p>
              <p>
                <a href={`tel:${brand.firm.phone}`}
                  className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">
                  {brand.firm.phone}
                </a>
              </p>
              <p>
                <a href={`mailto:${brand.firm.email}`}
                  className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">
                  {brand.firm.email}
                </a>
              </p>
              {brand.firm.hours && (
                <p className="text-sm text-primary-foreground/70">{brand.firm.hours}</p>
              )}
            </address>
          </div>

        </div>
      </div>

      {/* Certifications bar — only renders if certificationLogos exist */}
      {brand.firm.certificationLogos && brand.firm.certificationLogos.length > 0 && (
        <>
          <Separator className="bg-primary-foreground/20" />
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex flex-wrap items-center justify-center gap-6">
              {brand.firm.certificationLogos.map((logo, i) => (
                logo.url ? (
                  <a key={i} href={logo.url} target="_blank" rel="noopener noreferrer">
                    <img src={logo.src} alt={logo.alt} className="h-10 w-auto opacity-75 hover:opacity-100 transition-opacity" />
                  </a>
                ) : (
                  <img key={i} src={logo.src} alt={logo.alt} className="h-10 w-auto opacity-75" />
                )
              ))}
            </div>
          </div>
        </>
      )}

      {/* Legal bar */}
      <Separator className="bg-primary-foreground/20" />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-primary-foreground/50">
          <p>© {year} {brand.firm.name}. All rights reserved.</p>
          {legalLinks.length > 0 && (
            <nav aria-label="Legal" className="flex gap-4">
              {legalLinks.map(link => (
                <Link key={link.url} href={link.url}
                  className="hover:text-primary-foreground transition-colors">
                  {link.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </div>

    </footer>
  )
}
```

---

## `SocialIcon` Component

```tsx
// components/footer/SocialIcon.tsx

import { Linkedin, Facebook, Twitter, Instagram, Youtube } from 'lucide-react'

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  linkedin:  Linkedin,
  facebook:  Facebook,
  twitter:   Twitter,
  instagram: Instagram,
  youtube:   Youtube,
}

export function SocialIcon({ platform, className }: { platform: string; className?: string }) {
  const Icon = ICON_MAP[platform.toLowerCase()]
  if (!Icon) return null
  return <Icon className={className} />
}
```

---

## Loading Footer Data

Footer data is loaded in the root layout (Server Component) alongside the nav:

```tsx
// app/layout.tsx

import { getNavConfig } from '@/lib/nav/get-nav-config'
import { getBrandConfig } from '@/lib/brand/get-brand-config'
import { NavBar } from '@/components/nav/NavBar'
import { Footer } from '@/components/footer/Footer'
import siteConfig from '@/site.config'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const navConfig = getNavConfig()
  const brand = getBrandConfig()

  return (
    <html lang="en">
      <body>
        <NavBar config={navConfig} />
        <main>{children}</main>
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

```typescript
// lib/brand/get-brand-config.ts

import brandJson from '@/content/brand.json'
import type { BrandJson } from './types'

export function getBrandConfig(): BrandJson {
  return brandJson as BrandJson
}
```

---

## `site.config.ts` — Per-Client Configuration

A small config file in the client repo for things not generated from the content package:

```typescript
// site.config.ts

const siteConfig = {
  siteUrl: 'https://korbeylague.com',
  legalLinks: [
    { label: 'Privacy Policy', url: '/privacy-policy' },
    { label: 'Terms of Use',   url: '/terms-of-use' },
  ],
  forms: {
    contactEndpoint: '/api/contact',
    quoteEndpoint:   '/api/quote',
  },
}

export default siteConfig
```

---

## File Structure

```
src/
  components/
    footer/
      Footer.tsx
      SocialIcon.tsx
  lib/
    brand/
      types.ts
      get-brand-config.ts
content/
  brand.json            — generated from brand.md in deliverable package
```
