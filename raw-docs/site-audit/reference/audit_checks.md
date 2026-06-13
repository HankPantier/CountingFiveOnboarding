# Audit Checks Reference

Full list of checks, thresholds, and scoring logic for each category.

## 1. Crawl & Sitemap (Foundation — not scored)
- URL inventory via crawl
- sitemap.xml detection (root, sitemap_index, robots.txt reference)
- Page type classification
- 4xx/5xx error tracking
- Redirect chain detection (chains > 1 hop)
- Orphaned page detection

## 2. Technical Health (15%)
| Check | Pass Threshold | Weight |
|---|---|---|
| SSL/HTTPS valid | No SSL error | 2.0 |
| SSL expiry | > 60 days remaining | 1.0 |
| robots.txt present | File returns 200 | 1.0 |
| Mixed content | 0 pages with HTTP resources on HTTPS | 1.5 |
| Redirect chains | 0 multi-hop chains | 1.0 |
| Broken links | 0 crawl errors | 1.5 |
| Security headers | ≥ 3 of 5 present | 1.5 |
| All 5 security headers | All 5 present | 0.5 |

Security headers checked: Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy

## 3. Core Web Vitals & Performance (20%)
Pulled from Google PageSpeed Insights API (mobile + desktop). Score = average of both.

| Metric | Good | Poor |
|---|---|---|
| LCP (Largest Contentful Paint) | < 2.5s | > 4.0s |
| CLS (Cumulative Layout Shift) | < 0.1 | > 0.25 |
| FCP (First Contentful Paint) | < 1.8s | > 3.0s |
| TTFB (Time to First Byte) | < 0.8s | > 1.8s |
| INP (Interaction to Next Paint) | < 200ms | > 500ms |

Category score = PSI performance score (0-100) averaged across mobile and desktop.

## 4. On-Page SEO & Metadata (15%)
| Check | Pass Threshold | Weight |
|---|---|---|
| Pages with title tag | ≥ 95% | 2.0 |
| Title length (50-65 chars) | ≥ 80% of pages | 1.5 |
| Unique title tags | ≥ 95% unique | 1.5 |
| Pages with meta description | ≥ 90% | 2.0 |
| Meta description length (100-165) | ≥ 80% of pages | 1.0 |
| Single H1 per page | ≥ 90% of pages | 2.0 |
| Heading hierarchy (no skips) | ≥ 90% of pages | 1.0 |
| Image alt text complete | ≥ 90% of pages | 1.5 |
| Open Graph tags complete | ≥ 80% of pages | 1.5 |
| Twitter Card tag | ≥ 60% of pages | 0.5 |
| Clean URL structure | ≥ 95% of pages | 1.0 |

## 5. Content Quality & Segments (10%)
| Check | Pass Threshold | Weight |
|---|---|---|
| Adequate word count (≥ 300) | ≥ 80% of pages | 2.0 |
| Readable content (FK ≤ Grade 12) | ≥ 80% of pages | 1.5 |
| No duplicate titles | 0 duplicate titles | 1.5 |
| Pages with CTA | ≥ 70% | 2.0 |
| Pages with trust signals | ≥ 40% | 1.0 |
| Contact info on homepage | Present | 1.5 |

CTA detection: "contact us", "get started", "book a", "schedule", "request a", "sign up", "free trial", "get a quote", "call us", "let's talk", "try free"

Trust signal detection: "testimonial", "review", "case study", "certified", "award", "accredited", "years of experience", "clients", "guarantee", "trusted"

## 6. Indexability & Search Visibility (10%)
| Check | Pass Threshold | Weight |
|---|---|---|
| XML sitemap found | Yes | 2.0 |
| Sitemap in robots.txt | Yes | 1.0 |
| Low noindex rate | < 10% of pages | 1.5 |
| Google index count | Verified via WebSearch (external) | — |

## 7. Schema & Structured Data (10%)
| Check | Pass Threshold | Weight |
|---|---|---|
| Organization schema | Present | 2.0 |
| WebSite schema | Present | 1.5 |
| BreadcrumbList schema | Present | 1.0 |
| Pages with any schema | ≥ 50% | 1.5 |
| All JSON-LD valid syntax | No parse errors | 2.0 |

## 8. AI / LLM Readiness (5%)
| Check | Pass Threshold | Weight |
|---|---|---|
| llms.txt present | /llms.txt returns 200 | 1.5 |
| AI crawlers not blocked | 0 blocked in robots.txt | 2.0 |
| FAQPage schema | Present | 1.0 |
| About/identity content | Key phrases on homepage | 1.5 |
| Contact info in text (not image-only) | Phone present in HTML | 1.0 |

## 9. UX & Accessibility (10%)
| Check | Pass Threshold | Weight |
|---|---|---|
| Mobile viewport meta | ≥ 95% of pages | 2.0 |
| Accessible buttons (aria-label) | ≥ 80% of pages | 1.5 |
| Form labels associated | ≥ 80% of pages | 1.5 |
| Skip navigation link | ≥ 30% of pages | 0.5 |
| Custom 404 page | Present (>500 bytes) | 1.0 |

## 10. Analytics & Tracking (5%)
| Check | Pass Threshold | Weight |
|---|---|---|
| Google Analytics 4 (GA4) | Detected on any page | 3.0 |
| Google Tag Manager | Detected | 2.0 |
| GA4 page coverage | ≥ 2 pages | 1.5 |
| Meta Pixel | Detected | 1.0 |
| LinkedIn Insight Tag | Detected | 0.5 |
