import { describe, expect, it } from 'vitest'
import { buildClientCenterJson } from './client-center-json-builder'
import type { SessionSchema } from '@/types/session-schema'

describe('buildClientCenterJson — flat schema → grouped client-center.json', () => {
  it('groups portals by category, preserving first-appearance order', () => {
    const schema: SessionSchema = {
      clientPortals: [
        { label: 'ShareFile', url: 'https://sf.example.com', description: 'Upload files', category: 'Documents' },
        { label: 'Pay Your Bill', url: 'https://pay.example.com', category: 'Payments' },
        { label: 'Secure Upload', url: 'https://up.example.com', category: 'Documents' },
      ],
    }

    expect(buildClientCenterJson(schema)).toEqual({
      enabled: true,
      label: 'Client Center',
      groups: [
        {
          title: 'Documents',
          links: [
            { label: 'ShareFile', url: 'https://sf.example.com', description: 'Upload files' },
            { label: 'Secure Upload', url: 'https://up.example.com' },
          ],
        },
        { title: 'Payments', links: [{ label: 'Pay Your Bill', url: 'https://pay.example.com' }] },
      ],
    })
  })

  it('puts uncategorized portals in a default "Client Resources" group', () => {
    const result = buildClientCenterJson({
      clientPortals: [{ label: 'QuickBooks', url: 'https://qbo.intuit.com' }],
    })
    expect(result.groups).toEqual([
      { title: 'Client Resources', links: [{ label: 'QuickBooks', url: 'https://qbo.intuit.com' }] },
    ])
  })

  it('drops entries missing a url or label', () => {
    const result = buildClientCenterJson({
      clientPortals: [
        { label: 'No URL', url: '   ' },
        { label: '', url: 'https://x.example.com' },
        { label: 'Good', url: 'https://good.example.com' },
      ],
    })
    expect(result.groups).toEqual([
      { title: 'Client Resources', links: [{ label: 'Good', url: 'https://good.example.com' }] },
    ])
  })

  it('returns a disabled, empty config when there are no portals', () => {
    expect(buildClientCenterJson({})).toEqual({ enabled: false, label: 'Client Center', groups: [] })
    expect(buildClientCenterJson({ clientPortals: [] }).enabled).toBe(false)
  })
})
