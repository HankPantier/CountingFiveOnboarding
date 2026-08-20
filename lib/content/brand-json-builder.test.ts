import { describe, expect, it } from 'vitest'
import { detectPlatform } from './brand-json-builder'

describe('detectPlatform — social platforms', () => {
  it('classifies the known brand platforms by hostname', () => {
    expect(detectPlatform('https://www.linkedin.com/company/acme')).toBe('linkedin')
    expect(detectPlatform('https://facebook.com/acme')).toBe('facebook')
    expect(detectPlatform('https://x.com/acme')).toBe('twitter')
    expect(detectPlatform('https://twitter.com/acme')).toBe('twitter')
    expect(detectPlatform('https://instagram.com/acme')).toBe('instagram')
    expect(detectPlatform('https://youtu.be/abc123')).toBe('youtube')
  })
})

describe('detectPlatform — Apple Maps', () => {
  it('classifies Apple Maps links', () => {
    expect(detectPlatform('https://maps.apple.com/?address=1+Main+St')).toBe('appleMaps')
    expect(detectPlatform('https://maps.apple.com/place?place-id=123')).toBe('appleMaps')
    expect(detectPlatform('https://apple.com/maps/place/foo')).toBe('appleMaps')
  })
})

describe('detectPlatform — Google Maps', () => {
  it('classifies Google Maps links across host/path shapes', () => {
    expect(detectPlatform('https://maps.google.com/?q=1+Main+St')).toBe('googleMaps')
    expect(detectPlatform('https://www.google.com/maps/place/Foo')).toBe('googleMaps')
    expect(detectPlatform('https://maps.app.goo.gl/abcdef')).toBe('googleMaps')
    expect(detectPlatform('https://goo.gl/maps/abcdef')).toBe('googleMaps')
  })
})

describe('detectPlatform — fallbacks', () => {
  it('falls back to other for unrecognized or invalid URLs', () => {
    expect(detectPlatform('https://www.yelp.com/biz/acme')).toBe('other')
    expect(detectPlatform('https://google.com/search?q=maps')).toBe('other')
    expect(detectPlatform('not a url')).toBe('other')
  })
})
