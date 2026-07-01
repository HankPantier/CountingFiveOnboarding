import { describe, expect, it } from 'vitest'
import { normalizeNavUrls } from './nav-json-builder'
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
