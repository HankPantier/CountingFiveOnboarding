# Navigation Spec

**Version:** 1.0  
**Status:** Draft

---

## Overview

Navigation is sitemap-seeded but manually curated. The Phase 6 deliverable package includes a `nav.json` file pre-populated from the `confirmed_sitemap`. A lightweight admin editor in the client repo lets the team trim and adjust the nav before launch. The `NavBar` component reads `nav.json` at build time.

Not every page in the sitemap should be in the nav. The admin editor is the mechanism for that curation.

---

## `nav.json` — Structure and Seed Logic

### Format

```json
{
  "logo": {
    "src": "/images/logo.svg",
    "alt": "Korbey Lague PLLP",
    "url": "/"
  },
  "cta": {
    "label": "Schedule a Call",
    "url": "/contact"
  },
  "items": [
    {
      "label": "About",
      "url": "/about",
      "children": [
        { "label": "Our Story",  "url": "/about/our-story" },
        { "label": "Our Team",   "url": "/about/our-team" }
      ]
    },
    {
      "label": "Services",
      "url": "/services",
      "children": [
        { "label": "Tax Services",            "url": "/services/tax" },
        { "label": "Bookkeeping & Payroll",   "url": "/services/bookkeeping-payroll" },
        { "label": "Advisory & Virtual CFO",  "url": "/services/virtual-cfo-advisory" },
        { "label": "Nonprofit Accounting",    "url": "/services/nonprofit" }
      ]
    },
    {
      "label": "Industries",
      "url": "/industries",
      "children": [
        { "label": "Nonprofits",              "url": "/industries/nonprofits" },
        { "label": "Healthcare",              "url": "/industries/healthcare-professionals" }
      ]
    },
    { "label": "Resources", "url": "/resources" },
    { "label": "Contact",   "url": "/contact" }
  ]
}
```

### TypeScript Types

```typescript
// lib/nav/types.ts

export interface NavItem {
  label: string
  url: string
  children?: NavItem[]    // max 1 level deep — no nested menus
}

export interface NavConfig {
  logo: { src: string; alt: string; url: string }
  cta?: { label: string; url: string }
  items: NavItem[]
}
```

**Constraint:** Nav is max 2 levels deep (top-level items + one level of dropdown children). No mega-menus. This keeps markup and mobile behavior simple.

### Seed Generation (in Phase 6 Deliverable Builder)

```typescript
// lib/content/nav-seed-builder.ts

import { ConfirmedSitemapPage } from '@/types/database'

export function buildNavSeed(
  confirmedSitemap: ConfirmedSitemapPage[],
  firmName: string
): NavConfig {
  // Group pages by top-level parent segment
  const groups = new Map<string, ConfirmedSitemapPage[]>()

  for (const page of confirmedSitemap) {
    const segments = page.url.replace(/^\//, '').split('/')
    const topLevel = segments[0]
    if (!groups.has(topLevel)) groups.set(topLevel, [])
    groups.get(topLevel)!.push(page)
  }

  const items: NavItem[] = []

  for (const [topLevel, pages] of groups) {
    const parentPage = pages.find(p => p.url === `/${topLevel}`)
    const children = pages
      .filter(p => p.url !== `/${topLevel}`)
      .map(p => ({ label: p.title, url: p.url }))

    items.push({
      label: parentPage?.title ?? capitalize(topLevel),
      url: `/${topLevel}`,
      children: children.length > 0 ? children : undefined
    })
  }

  return {
    logo: { src: '/images/logo.svg', alt: firmName, url: '/' },
    cta: { label: 'Schedule a Call', url: '/contact' },
    items
  }
}
```

The seeded `nav.json` is included in the deliverable zip at `content/nav.json`.

---

## Admin Nav Editor

A simple JSON editor page inside the client repo. Not the onboarding app — this lives in the client site itself, protected by a dev password during launch prep.

### Route: `/admin/nav`

```
src/
  app/
    admin/
      nav/
        page.tsx    — nav editor UI
        actions.ts  — save nav.json server action
```

The editor is a drag-and-drop tree editor (using `@dnd-kit/sortable`) pre-loaded with the current `nav.json`. The admin can:
- Rename nav labels (without changing page URLs)
- Remove items from the nav (the page still exists — it's just not navigable)
- Reorder items within a level
- Move a page from child to top-level or vice versa
- Add the CTA button label and URL
- Change the logo file reference

Changes save back to `content/nav.json` via a server action. On next build, the NavBar picks up the changes.

---

## `NavBar` Component

### Behavior
- **Desktop:** Horizontal top nav with dropdown menus for items that have children. Logo left, nav items center, CTA button right.
- **Mobile:** Hamburger trigger opens a `Sheet` (shadcn) sliding from the left. Accordion-style sub-items.
- **Sticky:** Fixed to top on scroll. Background transitions from transparent (over hero) to `bg-background/95 backdrop-blur` on scroll.
- **Active state:** Current page item highlighted via `text-primary` and `font-semibold`.

### Component

```tsx
// components/nav/NavBar.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import {
  NavigationMenu, NavigationMenuList, NavigationMenuItem,
  NavigationMenuTrigger, NavigationMenuContent, NavigationMenuLink
} from '@/components/ui/navigation-menu'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Menu } from 'lucide-react'
import type { NavConfig } from '@/lib/nav/types'

interface NavBarProps {
  config: NavConfig
}

export function NavBar({ config }: NavBarProps) {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200
      ${scrolled ? 'bg-background/95 backdrop-blur-sm shadow-sm border-b border-border' : 'bg-transparent'}`}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">

          {/* Logo */}
          <Link href={config.logo.url} className="flex-shrink-0">
            <img src={config.logo.src} alt={config.logo.alt} className="h-8 w-auto" />
          </Link>

          {/* Desktop nav */}
          <NavigationMenu className="hidden lg:flex">
            <NavigationMenuList>
              {config.items.map(item => (
                item.children ? (
                  <NavigationMenuItem key={item.url}>
                    <NavigationMenuTrigger className={`font-medium ${pathname.startsWith(item.url) ? 'text-primary' : ''}`}>
                      {item.label}
                    </NavigationMenuTrigger>
                    <NavigationMenuContent>
                      <ul className="grid w-48 gap-1 p-2">
                        {item.children.map(child => (
                          <li key={child.url}>
                            <NavigationMenuLink asChild>
                              <Link href={child.url}
                                className={`block px-3 py-2 rounded-md text-sm transition-colors
                                  hover:bg-accent hover:text-accent-foreground
                                  ${pathname === child.url ? 'bg-accent/50 text-primary font-medium' : 'text-foreground'}`}>
                                {child.label}
                              </Link>
                            </NavigationMenuLink>
                          </li>
                        ))}
                      </ul>
                    </NavigationMenuContent>
                  </NavigationMenuItem>
                ) : (
                  <NavigationMenuItem key={item.url}>
                    <NavigationMenuLink asChild>
                      <Link href={item.url}
                        className={`px-4 py-2 text-sm font-medium transition-colors hover:text-primary
                          ${pathname === item.url ? 'text-primary' : 'text-foreground'}`}>
                        {item.label}
                      </Link>
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                )
              ))}
            </NavigationMenuList>
          </NavigationMenu>

          {/* Desktop CTA */}
          <div className="hidden lg:flex">
            {config.cta && (
              <Button asChild>
                <Link href={config.cta.url}>{config.cta.label}</Link>
              </Button>
            )}
          </div>

          {/* Mobile trigger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild className="lg:hidden">
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <MobileNav config={config} pathname={pathname} onClose={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

        </div>
      </div>
    </header>
  )
}
```

### Mobile Nav Sub-Component

```tsx
// components/nav/MobileNav.tsx

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import type { NavConfig } from '@/lib/nav/types'

interface MobileNavProps {
  config: NavConfig
  pathname: string
  onClose: () => void
}

export function MobileNav({ config, pathname, onClose }: MobileNavProps) {
  return (
    <nav className="flex flex-col h-full">
      {/* Logo header */}
      <div className="p-4 border-b border-border">
        <Link href="/" onClick={onClose}>
          <img src={config.logo.src} alt={config.logo.alt} className="h-7 w-auto" />
        </Link>
      </div>

      {/* Nav items */}
      <div className="flex-1 overflow-y-auto p-4">
        <Accordion type="multiple">
          {config.items.map(item => (
            item.children ? (
              <AccordionItem key={item.url} value={item.url} className="border-b border-border/50">
                <AccordionTrigger className={`text-sm font-medium py-3
                  ${pathname.startsWith(item.url) ? 'text-primary' : 'text-foreground'}`}>
                  {item.label}
                </AccordionTrigger>
                <AccordionContent>
                  <ul className="space-y-1 pb-2">
                    {item.children.map(child => (
                      <li key={child.url}>
                        <Link href={child.url} onClick={onClose}
                          className={`block px-3 py-2 rounded-md text-sm transition-colors
                            hover:bg-accent hover:text-accent-foreground
                            ${pathname === child.url ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            ) : (
              <div key={item.url} className="border-b border-border/50">
                <Link href={item.url} onClick={onClose}
                  className={`block py-3 text-sm font-medium transition-colors hover:text-primary
                    ${pathname === item.url ? 'text-primary' : 'text-foreground'}`}>
                  {item.label}
                </Link>
              </div>
            )
          ))}
        </Accordion>
      </div>

      {/* CTA at bottom */}
      {config.cta && (
        <div className="p-4 border-t border-border">
          <Button asChild className="w-full">
            <Link href={config.cta.url} onClick={onClose}>{config.cta.label}</Link>
          </Button>
        </div>
      )}
    </nav>
  )
}
```

---

## Loading `nav.json` at Build Time

```typescript
// lib/nav/get-nav-config.ts

import navConfig from '@/content/nav.json'
import type { NavConfig } from './types'

export function getNavConfig(): NavConfig {
  return navConfig as NavConfig
}
```

The `NavBar` is a client component, but `nav.json` is loaded and passed in as a prop from the server layout:

```tsx
// app/layout.tsx (server component)

import { getNavConfig } from '@/lib/nav/get-nav-config'
import { NavBar } from '@/components/nav/NavBar'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const navConfig = getNavConfig()
  return (
    <html>
      <body>
        <NavBar config={navConfig} />
        {children}
      </body>
    </html>
  )
}
```

---

## File Structure

```
src/
  components/
    nav/
      NavBar.tsx
      MobileNav.tsx
  lib/
    nav/
      types.ts
      get-nav-config.ts
  app/
    admin/
      nav/
        page.tsx        — admin editor
        actions.ts      — save action
content/
  nav.json              — seeded from deliverable, curated by admin
scripts/
  (nav-seed-builder lives in the onboarding app, not the client repo)
```

---

## Tertiary Navigation + Section Side-Nav (v2)

> The examples above are a v1 draft using a `NavConfig`/`items` shape. The
> shipped contract is `NavJson` (`{ primary: NavItem[], cta? }`, `NavItem =
> { label, url, children? }`) in both repos. This section is the authoritative
> spec for three-level nav; treat it as the source of truth over the v1 examples.

### Three levels

`NavItem.children` may now nest **two levels deep**: primary → secondary →
tertiary. Nothing renders below tertiary.

- **Onboarding editors.** `components/editor/NavEditor.tsx` (the in-repo
  `nav.json` editor) reorders every level by drag-and-drop (`@dnd-kit`, within a
  sibling list only) and can add/remove tertiary items. `NavCurationPhase.tsx`
  derives tertiary from the sitemap and preserves it on save.
- **Builder.** `lib/content/nav-json-builder.ts` builds the tree recursively
  from the sitemap by parent linkage, capped at three levels (deeper is dropped
  with a warning). A curated `nav_config` is passed through untouched.

### Rendering rules (template repo)

- **Header dropdowns (`NavBar`/`MobileNav`) and `Footer`: unchanged.** They map
  a single level of `children`, so tertiary items never appear there.
- **Section side-nav (`SideNav`).** Shown only on **secondary/tertiary pages**
  of a primary that has tertiary items (see `lib/nav/nav-tree.ts →
  resolveSideNav`) — never on the primary landing page. It lists every secondary
  of the active primary as a bold header, with each secondary's tertiary items
  as lighter, indented links; the active branch gets a left accent bar.
  Server-rendered from the route URL; mobile collapses it behind an
  "In this section" accordion (`SideNavCollapse`).
- **Layout.** `PageLayout` takes an optional `sideNav` slot: the full-bleed hero
  stays edge-to-edge and the body sits in a two-column grid beside the rail.
