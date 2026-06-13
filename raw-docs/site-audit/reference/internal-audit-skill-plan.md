# Counting Five — Internal Audit Skill Plan

**Version:** 1.0  
**Date:** 2026-04-20  
**Purpose:** Define the complete specification for the `internal-audit` skill — a comprehensive, automated website audit tool that produces branded HTML reports for client site monitoring and agency recommendations.

---

## Overview

The Internal Audit skill accepts a URL, crawls the target site using Firecrawl MCP, runs a multi-dimensional audit across technical health, content quality, SEO, UX, AI readiness, and analytics, then produces a scored, branded HTML report saved to the `reports/` directory. Reports are timestamped for version history, enabling before/after score tracking across engagements.

---

## Input

| Parameter | Required | Description |
|---|---|---|
| `url` | Yes | The root URL to audit (e.g., `https://example.com`) |
| `site_name` | No | Human-readable name for the report header. Inferred from domain if omitted. |
| `max_pages` | No | Maximum pages to crawl (default: 50). Prevents runaway crawls on large sites. |
| `focus_segments` | No | Optional customer segments to check content against (e.g., "small business owners, HR managers") |

---

## Audit Categories & Checks

### 1. Crawl & Sitemap (Foundation)
*All other checks depend on this step.*

- [ ] Use Firecrawl `/map` to generate a full URL inventory of the site
- [ ] Use Firecrawl `/crawl` to fetch page content (markdown + metadata) for each discovered URL
- [ ] Detect and parse any existing `sitemap.xml` (at `/sitemap.xml`, `/sitemap_index.xml`, and in `robots.txt`)
- [ ] Compare sitemap URLs vs. discovered crawl URLs — flag pages missing from sitemap
- [ ] Identify orphaned pages (no internal links pointing to them)
- [ ] Count total pages by type (home, service/product, blog, contact, legal, etc.)
- [ ] Flag pages returning non-200 status codes (404s, 500s, redirects)
- [ ] Detect redirect chains (A→B→C instead of A→C directly)

**Outputs:** Full URL inventory table, sitemap coverage %, list of crawl errors

---

### 2. Technical Health
*Core infrastructure quality.*

- [ ] **SSL/HTTPS** — Is the site on HTTPS? Does the certificate expire within 60 days?
- [ ] **Mixed content** — Are any HTTP resources (images, scripts) loaded on HTTPS pages?
- [ ] **robots.txt** — Present? Properly configured? Are any important pages accidentally blocked?
- [ ] **Canonical tags** — Are canonical tags present and self-referencing correctly? Conflicts?
- [ ] **Broken internal links** — Internal hrefs that 404 or return errors
- [ ] **Redirect chains** — Any 301/302 chains longer than 1 hop
- [ ] **Page size** — Flag pages over 3MB total transfer size
- [ ] **Security headers** — Check for: `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`

**Scoring:** Pass/fail per check. Security headers scored by how many of 5 are present.

---

### 3. Core Web Vitals & Performance
*Google's official performance signals.*

- [ ] Call **Google PageSpeed Insights API** (free, no key required for basic use) for each key page (home, top 5 most linked internal pages)
- [ ] **LCP** (Largest Contentful Paint) — target < 2.5s
- [ ] **CLS** (Cumulative Layout Shift) — target < 0.1
- [ ] **INP** (Interaction to Next Paint) — target < 200ms
- [ ] **FCP** (First Contentful Paint) — target < 1.8s
- [ ] **TTFB** (Time to First Byte) — target < 800ms
- [ ] **Mobile score** vs. **Desktop score** — both reported separately
- [ ] Flag render-blocking resources (undeferred JS/CSS)
- [ ] Image optimization — oversized images, non-WebP/AVIF formats, missing `width`/`height` attributes

**Scoring:** PSI score (0–100) averaged across sampled pages, split mobile/desktop.

---

### 4. On-Page SEO & Metadata
*Per-page content signals.*

- [ ] **Title tags** — Present on every page? Unique across site? Length 50–60 characters?
- [ ] **Meta descriptions** — Present? Unique? Length 120–158 characters?
- [ ] **H1 tags** — Exactly one H1 per page? H1 present at all?
- [ ] **Heading hierarchy** — Logical H1→H2→H3 flow? No skipped levels (H1→H3)?
- [ ] **Keyword presence** — Does page title/H1/first paragraph contain the apparent page topic?
- [ ] **Image alt text** — All `<img>` tags have meaningful alt attributes?
- [ ] **Open Graph tags** — `og:title`, `og:description`, `og:image` present on all pages?
- [ ] **Twitter Card tags** — `twitter:card`, `twitter:title`, `twitter:image` present?
- [ ] **URL structure** — Clean, readable slugs? No excessive parameters? Lowercase?
- [ ] **Internal link anchor text** — Are links using descriptive text vs. "click here"?

**Scoring:** % of pages passing each check, averaged into category score.

---

### 5. Content Quality & Customer Segments
*Is the content doing its job?*

- [ ] **Readability** — Flesch-Kincaid reading level per page (flag anything above Grade 12 for consumer sites)
- [ ] **Content length** — Flag key service/product pages under 300 words as "thin content"
- [ ] **Content freshness** — Detect `<time>` or date patterns; flag blog/news content older than 12 months with no updates
- [ ] **Duplicate content** — Flag pages with >70% content similarity to another page on the site
- [ ] **Customer segment coverage** — If segments are provided, check whether each segment's key concerns/language appear in the content (GPT-assisted semantic check)
- [ ] **CTA inventory** — Does each key page have a clear Call to Action? Is CTA text action-oriented?
- [ ] **Contact information visibility** — Phone, email, or address accessible from homepage and contact page?
- [ ] **Trust signals** — Presence of: testimonials, case studies, certifications, client logos, awards

**Scoring:** Combination of measurable metrics (readability, length, freshness) + checklist items.

---

### 6. Indexability & Search Visibility
*Can Google find and understand the site?*

- [ ] **Google index check** — Run `site:domain.com` via web search to estimate indexed page count and compare to crawled page count
- [ ] **Bing/DuckDuckGo** — Spot check index presence on alternative engines
- [ ] **robots.txt disallow rules** — Cross-reference with crawled pages to flag accidentally blocked content
- [ ] **Noindex tags** — Identify pages with `<meta name="robots" content="noindex">` and flag if they appear to be important pages
- [ ] **Sitemap submission signals** — Is the sitemap referenced in robots.txt? (Indicates it's been submitted)
- [ ] **Pagination** — Are paginated pages using `rel="next"` / `rel="prev"` or canonical to page 1?

---

### 7. Schema & Structured Data
*Machine-readable signals for search and AI.*

- [ ] Detect all JSON-LD and microdata schema blocks across crawled pages
- [ ] Identify schema types present (Organization, LocalBusiness, Product, Article, FAQPage, BreadcrumbList, WebSite, SiteLinksSearchBox, etc.)
- [ ] **Required schemas check** — Flag missing schema types based on site type:
  - All sites: `Organization`, `WebSite`
  - Local business: `LocalBusiness` with NAP (Name, Address, Phone)
  - E-commerce: `Product`, `Offer`
  - Blog/news: `Article`, `BlogPosting`
  - Service business: `Service`
- [ ] **Schema quality** — Are required properties populated? (e.g., `LocalBusiness` without `telephone` or `address`)
- [ ] **BreadcrumbList** — Present on interior pages?
- [ ] **FAQ schema** — Are FAQ sections marked up for rich results?
- [ ] Validate schema JSON syntax (malformed JSON is silent failure)

**Scoring:** % of applicable schemas present + quality score on populated fields.

---

### 8. AI / LLM Readiness
*Cutting-edge: how well does this site communicate with AI systems?*

- [ ] **llms.txt** — Check for `/llms.txt` at root (emerging standard for AI-readable site context)
- [ ] **AI answer presence** — Search for the business name + core service in Perplexity/web search to check if the site appears in AI-generated answers
- [ ] **Content structure for AI** — Are key facts (hours, pricing, services, differentiators) clearly stated in text (not buried in images or PDFs)?
- [ ] **FAQ / Q&A content** — Is there content written in question-answer format that LLMs can extract?
- [ ] **About/identity content** — Is there a clear "who we are, what we do, who we serve" passage that AI can use as a summary?
- [ ] **Unstructured data in images** — Flag important info (phone numbers, addresses, pricing) that exists only as image text and is therefore invisible to AI
- [ ] **robots.txt AI crawler rules** — Are AI crawlers (GPTBot, ClaudeBot, PerplexityBot) blocked or allowed?

**Scoring:** Checklist-based, 0–100 based on % of checks passing.

---

### 9. User Experience & Accessibility
*Can real users and assistive technologies use the site?*

- [ ] **Mobile viewport meta tag** — Present on all pages?
- [ ] **Tap target size** — PSI flags elements too small for mobile tap (< 48x48px)
- [ ] **Color contrast** — WCAG AA minimum 4.5:1 for body text (inferred from CSS if available)
- [ ] **ARIA labels** — Do interactive elements (buttons, form fields) have accessible labels?
- [ ] **Form labels** — Are all `<input>` elements associated with a `<label>`?
- [ ] **Skip navigation** — Is there a "skip to main content" link for keyboard users?
- [ ] **Navigation structure** — Is there a consistent nav present on all pages?
- [ ] **404 page** — Does the site have a custom 404 page with navigation back to the site?
- [ ] **Print stylesheet or print-friendliness** — Minor signal for certain business types

**Scoring:** Checklist + PSI mobile score contribution.

---

### 10. Analytics & Tracking
*Is the site measuring what matters?*

- [ ] **Google Analytics / GA4** — Detect GA4 measurement ID or gtag.js in page source
- [ ] **Google Tag Manager** — Detect GTM container snippet
- [ ] **Meta Pixel** — Detect Facebook/Meta Pixel `fbq()` initialization
- [ ] **LinkedIn Insight Tag** — Detect LinkedIn pixel
- [ ] **Other tracking** — Flag any other analytics/ad pixels found (HubSpot, Hotjar, Clarity, etc.)
- [ ] **Duplicate tracking** — Flag if both GA4 and legacy Universal Analytics appear (old setups)
- [ ] **Tag firing on key pages** — Check that analytics fires on homepage, a service page, and contact page
- [ ] **Conversion events** — Infer from source whether contact form or CTA pages have event tracking set up

**Scoring:** Presence-based. Core = GA4 + GTM. Bonus for Meta/LinkedIn pixels.

---

## Scoring Methodology

### Per-Category Scoring (0–100)

Each category produces a score based on the ratio of passing checks, weighted by check importance within the category.

### Letter Grade Scale

| Score | Grade | Label |
|---|---|---|
| 90–100 | A | Excellent |
| 80–89 | B | Good |
| 70–79 | C | Needs Work |
| 60–69 | D | Poor |
| < 60 | F | Critical Issues |

### Overall Score Weighting

| Category | Weight |
|---|---|
| Technical Health | 15% |
| Core Web Vitals & Performance | 20% |
| On-Page SEO & Metadata | 15% |
| Content Quality & Segments | 10% |
| Indexability & Search Visibility | 10% |
| Schema & Structured Data | 10% |
| AI / LLM Readiness | 5% |
| User Experience & Accessibility | 10% |
| Analytics & Tracking | 5% |

*Crawl & Sitemap is a foundation step — it does not contribute directly to the score but gates all other checks.*

### Priority Flags

Each category surfaces:
- 🔴 **Critical** — Actively hurting rankings or UX. Fix immediately.
- 🟡 **Warning** — Suboptimal. Should be addressed in next sprint.
- 🟢 **Pass** — Meets or exceeds standard.

---

## Report Structure (HTML Deliverable)

The output is a single self-contained `.html` file with inline CSS and no external dependencies.

### Sections (in order):

1. **Header** — Counting Five logo (from `assets/`), report title, site name, URL audited, date generated, "Snapshot Report" badge
2. **Executive Summary** — Large overall score (number + letter grade), score ring/dial graphic, one-sentence verdict, top 3 critical findings callout box
3. **Score Dashboard** — Grid of all 9 category scores with mini grade badges and a sparkline-style visual indicator
4. **Category Sections** (one per category) — Category score + grade, expandable findings table (check name | status | detail), "Quick Wins" box with top 2–3 actionable items
5. **Page Inventory** — Sortable table of all crawled pages: URL, title, status code, index status, H1 present, schema present, word count
6. **Recommendations Summary** — Master list of all recommendations, sorted by priority (Critical → Warning), with effort estimate (Low / Medium / High) and impact estimate
7. **Footer** — "Audit generated by Counting Five" + date + `reports/[filename]` path

### Filename Convention:
```
reports/audit-[domain]-[YYYY-MM-DD].html
```
Example: `reports/audit-acmeplumbing-2026-04-20.html`

---

## Technical Implementation Plan

### Tools Used

| Tool | Purpose |
|---|---|
| Firecrawl MCP (`/map`) | URL discovery / sitemap generation |
| Firecrawl MCP (`/crawl`) | Per-page content + metadata extraction |
| Firecrawl MCP (`/scrape`) | Targeted single-page re-scrapes for schema/head inspection |
| Google PageSpeed Insights API | Core Web Vitals (free, no key required) |
| WebSearch / WebFetch | Google index check (`site:` queries), robots.txt, llms.txt, sitemap.xml |
| Python (via Bash) | Score calculation, HTML report generation, data aggregation |
| Read / Write | Asset loading (logos), report file output |

### Execution Flow

```
Step 1: CRAWL
  └─ Firecrawl /map → full URL list
  └─ Firecrawl /crawl → page content, metadata, status codes
  └─ Fetch robots.txt, sitemap.xml, llms.txt directly

Step 2: AUDIT
  └─ Technical checks (SSL, redirects, broken links, security headers)
  └─ PageSpeed Insights API calls (home + top 5 pages)
  └─ On-page SEO checks (title, meta, headings, alt text, OG tags)
  └─ Content analysis (readability, length, CTAs, trust signals)
  └─ Index checks (site: search queries)
  └─ Schema detection and validation
  └─ AI readiness checks (llms.txt, content structure, robot rules)
  └─ UX checks (mobile meta, ARIA, forms)
  └─ Analytics detection (GA4, GTM, Meta pixel)

Step 3: SCORE
  └─ Compute per-category scores (0–100)
  └─ Apply weighting → overall score
  └─ Assign letter grades
  └─ Generate priority-ranked recommendations list

Step 4: REPORT
  └─ Load Counting Five logo from assets/
  └─ Render HTML report with all findings
  └─ Save to reports/audit-[domain]-[YYYY-MM-DD].html
  └─ Return link to user
```

### Error Handling

- If Firecrawl fails on a page, log it as "crawl error" and continue
- If PageSpeed API is rate-limited, fall back to Lighthouse estimates from PSI data already in crawl
- If a check cannot be completed (e.g., no access to analytics backend), mark as "Unable to verify" rather than failing the score
- Cap crawl at `max_pages` (default 50) to prevent timeouts on large sites; note the cap in the report

---

## Skill Invocation

The skill is triggered when the user:
- Says "run an audit on [URL]"
- Says "audit this site: [URL]"
- Says "run the internal audit"
- Provides a URL and asks for a site report, health check, or SEO analysis

### Prompt to user if URL is missing:
> "I'm ready to run the audit. What's the URL of the site you'd like to analyze? You can also optionally tell me the client name and any customer segments you'd like me to check content against."

---

## Future Enhancements (v2 Backlog)

- Competitor benchmarking (compare scores side-by-side against 1–2 competitor URLs)
- Score delta between audit runs (show +/- change from previous report)
- Google Search Console integration (if user can connect it) for real impression/click data
- Email delivery of report to client
- Scheduled audits (monthly auto-run via the `schedule` skill)
- Lighthouse CI integration for deeper accessibility scoring
- CMS detection (WordPress, Webflow, Squarespace) and CMS-specific recommendations

---

## Assets

| File | Use |
|---|---|
| `assets/CountingFive-Logo-040125.png` | Primary logo — dark background header |
| `assets/CountingFive-Logo-revers.png` | Reversed logo — light background or footer use |
