import { describe, expect, it } from 'vitest'
import { buildNavJson, cleanNavLabel, lintNavLabels, NAV_LABEL_MAX, normalizeNavUrls, type SitemapEntry } from './nav-json-builder'
import type { NavJson } from '@/types/nav-json'

describe('normalizeNavUrls — nav links follow the current origin', () => {
  const host = 'bblcpa.com'

  it('relativizes firm-host URLs in primary items, nested children, and the CTA', () => {
    const nav: NavJson = {
      primary: [
        { label: 'Who We Are', url: 'https://www.bblcpa.com/who-we-are' },
        {
          label: 'What We Do',
          url: 'https://www.bblcpa.com/what-we-do',
          children: [{ label: 'Tax', url: 'https://www.bblcpa.com/what-we-do/tax' }],
        },
      ],
      cta: { label: 'Get started', url: 'https://bblcpa.com/contact' },
    }

    expect(normalizeNavUrls(nav, host)).toEqual({
      primary: [
        { label: 'Who We Are', url: '/who-we-are' },
        {
          label: 'What We Do',
          url: '/what-we-do',
          children: [{ label: 'Tax', url: '/what-we-do/tax' }],
        },
      ],
      cta: { label: 'Get started', url: '/contact' },
    })
  })

  it('leaves already-relative and external nav URLs untouched', () => {
    const nav: NavJson = {
      primary: [
        { label: 'Contact', url: '/contact' },
        { label: 'Portal', url: 'https://portal.example.com/login' },
      ],
    }
    expect(normalizeNavUrls(nav, host)).toEqual(nav)
  })
})

describe('buildNavJson — sitemap nesting', () => {
  const sitemap: SitemapEntry[] = [
    { url: '/', title: 'Home' },
    { url: '/services', title: 'Services', parent: '/' },
    { url: '/services/accounting', title: 'Accounting', parent: '/services' },
    { url: '/services/accounting/payroll', title: 'Payroll', parent: '/services/accounting' },
    { url: '/services/accounting/tax', title: 'Tax', parent: '/services/accounting' },
  ]

  it('builds three levels (primary → secondary → tertiary) from the sitemap', () => {
    expect(buildNavJson(sitemap)).toEqual({
      primary: [
        {
          label: 'Services',
          url: '/services',
          children: [
            {
              label: 'Accounting',
              url: '/services/accounting',
              children: [
                { label: 'Payroll', url: '/services/accounting/payroll' },
                { label: 'Tax', url: '/services/accounting/tax' },
              ],
            },
          ],
        },
      ],
    })
  })

  it('drops nesting below tertiary', () => {
    const deep: SitemapEntry[] = [
      ...sitemap,
      { url: '/services/accounting/payroll/weekly', title: 'Weekly', parent: '/services/accounting/payroll' },
    ]
    const nav = buildNavJson(deep)
    const payroll = nav.primary[0].children![0].children!.find(c => c.url === '/services/accounting/payroll')
    expect(payroll).toBeDefined()
    expect(payroll!.children).toBeUndefined()
  })

  it('prefers a curated nav_config (with tertiary) over the sitemap', () => {
    const curated: NavJson = {
      primary: [
        {
          label: 'Services',
          url: '/services',
          children: [
            {
              label: 'Accounting',
              url: '/services/accounting',
              children: [{ label: 'Payroll', url: '/services/accounting/payroll' }],
            },
          ],
        },
      ],
    }
    expect(buildNavJson([], curated)).toEqual(curated)
  })
})

describe('nav labels — SEO titles never reach the header', () => {
  it('strips "| Firm" suffixes and "About Home"', () => {
    expect(cleanNavLabel('Contact Us | Aurora Consulting Group LLC', 'Aurora Consulting Group LLC')).toBe('Contact Us')
    expect(cleanNavLabel('Who We Are | Stephen P. Pryor, CPA')).toBe('Who We Are')
    expect(cleanNavLabel('About Home | Kinexus CPAs & Advisors')).toBe('About')
    expect(cleanNavLabel('Home | Stephen P. Pryor, CPA')).toBe('Home')
  })

  it('strips "- Firm" suffixes, "About <Firm>" and "your trusted…" taglines', () => {
    expect(cleanNavLabel('Tax Planning - Buss CPA', 'Buss CPA')).toBe('Tax Planning')
    expect(cleanNavLabel('Tax - Individual Returns', 'Buss CPA')).toBe('Tax - Individual Returns')
    expect(cleanNavLabel('About Berg Advisors | Trusted CPA & Accounting Experts', 'Berg Advisors')).toBe('About')
    expect(cleanNavLabel('About RootAdvisors your trusted accounting partner', 'Accord Advisors')).toBe('About RootAdvisors')
  })

  it('leaves clean labels untouched', () => {
    expect(cleanNavLabel('Industries We Serve', 'Berg Advisors')).toBe('Industries We Serve')
  })

  it('shortens Berg-style sitemap titles to the slug or a word-boundary cut', () => {
    const sitemap: SitemapEntry[] = [
      { url: '/', title: 'Small Business Accounting, Bookkeeping, Tax, & Advisory | Berg Advisors' },
      { url: '/services', title: 'Accounting, Bookkeeping, Tax, & Advisory Services' },
      { url: '/services/tax', title: 'Professional Tax Services for Small Businesses and Individuals Nationwide', parent: '/services' },
      { url: '/about-us', title: 'About Berg Advisors | Trusted CPA & Accounting Experts' },
      { url: '/contact-us', title: 'Contact Berg Advisors for Accounting, Tax & Advisory Services' },
      { url: '/services/irs-representation-and-tax-resolution-services', title: 'IRS representation and tax resolution services for business owners', parent: '/services' },
    ]
    const nav = buildNavJson(sitemap, undefined, { firmName: 'Berg Advisors' })
    expect(nav.primary.map((i) => i.label)).toEqual(['Services', 'About', 'Contact Us'])
    const kids = nav.primary[0].children!.map((c) => c.label)
    expect(kids).toEqual(['Tax', 'IRS representation and tax'])
    expect(lintNavLabels(nav)).toEqual([])
    for (const k of kids) expect(k.length).toBeLessThanOrEqual(NAV_LABEL_MAX)
  })

  it('cleans curated labels of "| Firm" but only lints (never truncates) long ones', () => {
    const curated: NavJson = {
      primary: [
        { label: 'Who We Are | Stephen P. Pryor, CPA', url: '/who-we-are' },
        { label: 'Accounting Services for Small Business | Berg Advisors', url: '/services/accounting' },
        { label: 'Professional Tax Services for Small Businesses and Individuals Nationwide', url: '/services/tax' },
      ],
    }
    const nav = buildNavJson([], curated, { firmName: 'Stephen P. Pryor, CPA' })
    expect(nav.primary.map((i) => i.label)).toEqual([
      'Who We Are',
      'Accounting Services for Small Business',
      'Professional Tax Services for Small Businesses and Individuals Nationwide',
    ])
    const lint = lintNavLabels(nav)
    expect(lint).toHaveLength(2)
    expect(lint[0]).toMatch(/38 characters/)
  })

  it('lints a label that still contains "|", and only sentence-length dropdown rows', () => {
    expect(lintNavLabels({ primary: [{ label: 'A | B', url: '/a' }] })[0]).toMatch(/contains "\|"/)
    const nav: NavJson = {
      primary: [
        {
          label: 'Services',
          url: '/services',
          children: [
            { label: 'Accounting and tax services for physicians', url: '/a' }, // 42: fine in a dropdown
            { label: 'Why small businesses are going bankrupt and how to avoid it', url: '/b' },
          ],
        },
      ],
    }
    expect(lintNavLabels(nav)).toEqual([
      'Nav label "Why small businesses are going bankrupt and how to avoid it" (dropdown) is 59 characters — keep it to 50 or fewer.',
    ])
  })
})
