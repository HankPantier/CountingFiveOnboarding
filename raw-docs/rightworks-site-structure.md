# Typical Right Works CPA Site Structure

**Reference site:** https://www.aeystercpa.com/
**Captured:** 2026-03-09

---

## Common Navigation Structure

| Nav Item | URL Pattern | Content |
|---|---|---|
| What We Do | `/what-we-do` | Services overview with cards linking to detail pages |
| Who We Are | `/who-we-are` | Team members with names, titles, certifications |
| Who We Serve | `/who-we-serve` | Industry niches with dedicated sub-pages per niche |
| Resources | `/resources` | Articles, blog posts, tools |
| Client Center | (button/external) | Client portal link |
| Get In Touch / Contact | `/contact` | Contact form + location(s) with address, phone, fax, email, hours |

---

## What We Can Auto-Discover Per Page

### Homepage (`/`)
- Business name + tagline
- Services overview (cards with title + short description)
- Industry niches served (cards with title + short description)
- Certifications/affiliations (e.g., QuickBooks ProAdvisor)
- Partner logos (in footer or body)

### What We Do (`/what-we-do` + sub-pages like `/what-we-do/outsourced-accounting`)
- **Service names** — e.g., Outsourced Accounting, Business Consulting, Full-Service Payroll, Tax Planning & Preparation, QuickBooks Consulting
- **Service descriptions** — detailed text per service
- **Pricing tiers/packages** — structured offerings (e.g., Basic / Standard / Premium with included items)

### Who We Are (`/who-we-are`)
- **Team members:** Name, title, certifications (e.g., "Angela Eyster Lohrey, CPA — Owner")
- May include bios and headshot images
- Roles: Owner, Executive Assistant, Office Manager, Bookkeeper, etc.

### Who We Serve (`/who-we-serve` + sub-pages)
- **Industry niches** — e.g., Funeral Home Owners, Construction, Attorneys, Beer Distributors
- Each niche has a dedicated sub-page with detailed description of how the firm serves that industry

### Contact (`/contact`)
- **Location(s)** with:
  - Office name (e.g., "York Office")
  - Street address
  - Phone number
  - Fax number
  - Email address
  - Hours of operation (per day)
- Multiple locations possible (each with their own details)
- Contact form

### Footer
- Repeated contact info (address, phone, fax, email)
- Certification/affiliation logos (PICPA, NSA, NSTP, etc.)
- "website powered by Rightworks" attribution
- Social media links (if present)

---

## Crawl Strategy

For a typical Right Works site, the agent should crawl these pages in order:
1. **Homepage** — get business name, tagline, service/niche overview, certifications
2. **Contact page** — get all location(s), hours, phone, email
3. **Who We Are** — get team members with names, titles, certs, bios
4. **What We Do** (overview) — get service list
5. **What We Do sub-pages** — get detailed service descriptions + pricing/offerings
6. **Who We Serve** (overview) — get niche list
7. **Who We Serve sub-pages** — get niche descriptions

This gives us the most complete picture with minimal page loads.
