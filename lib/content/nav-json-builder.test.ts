import { describe, expect, it } from 'vitest'
import { buildNavJson, normalizeNavUrls, type SitemapEntry } from './nav-json-builder'
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
