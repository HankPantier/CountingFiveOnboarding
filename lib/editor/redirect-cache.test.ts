import { describe, expect, it } from 'vitest'
import { REDIRECTS_CSV_PATH, redirectsCacheAction } from './redirect-cache'

describe('redirectsCacheAction', () => {
  it('reloads a cached, unedited redirects.csv so the next save does not 409', () => {
    expect(redirectsCacheAction(new Map([[REDIRECTS_CSV_PATH, {}]]), new Map())).toBe('reload')
  })
  it('never overwrites unsaved edits', () => {
    expect(redirectsCacheAction(new Map([[REDIRECTS_CSV_PATH, {}]]), new Map([[REDIRECTS_CSV_PATH, 'x']]))).toBe('keep')
  })
  it('does nothing when redirects.csv was never opened', () => {
    expect(redirectsCacheAction(new Map([['content/nav.json', {}]]), new Map())).toBe('none')
  })
})
