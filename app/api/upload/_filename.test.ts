import { describe, it, expect } from 'vitest'
import { fileNameFromStoragePath, isSessionStoragePath, sanitizeUploadFileName } from './_filename'

const SID = '11111111-2222-4333-8444-555555555555'
const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

describe('sanitizeUploadFileName', () => {
  it('keeps a normal name', () => {
    expect(sanitizeUploadFileName('headshot-01.jpg')).toBe('headshot-01.jpg')
  })
  it('strips directory components (both separators)', () => {
    expect(sanitizeUploadFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeUploadFileName('C:\\Users\\x\\photo.png')).toBe('photo.png')
  })
  it('collapses dot runs and leading dots', () => {
    expect(sanitizeUploadFileName('..')).toBe('file')
    expect(sanitizeUploadFileName('.htaccess')).toBe('htaccess')
    expect(sanitizeUploadFileName('a..b.png')).toBe('a.b.png')
  })
  it('replaces unsafe characters', () => {
    expect(sanitizeUploadFileName('my photo<script>.png')).toBe('my_photo_script_.png')
  })
  it('never returns empty and caps length', () => {
    expect(sanitizeUploadFileName('')).toBe('file')
    expect(sanitizeUploadFileName('a'.repeat(500)).length).toBe(200)
  })
})

describe('isSessionStoragePath', () => {
  it('accepts a flat object under the session prefix', () => {
    expect(isSessionStoragePath(`sessions/${SID}/${UUID}-logo.png`, SID)).toBe(true)
  })
  it('rejects other sessions and other roots', () => {
    expect(isSessionStoragePath(`sessions/${UUID}/x.png`, SID)).toBe(false)
    expect(isSessionStoragePath(`pdfs/${SID}/intake-summary.pdf`, SID)).toBe(false)
  })
  it('rejects traversal, encoded traversal, nesting and backslashes', () => {
    expect(isSessionStoragePath(`sessions/${SID}/../${UUID}/x.png`, SID)).toBe(false)
    expect(isSessionStoragePath(`sessions/${SID}/..%2F${UUID}%2Fx.png`, SID)).toBe(false)
    expect(isSessionStoragePath(`sessions/${SID}/a/b.png`, SID)).toBe(false)
    expect(isSessionStoragePath(`sessions/${SID}/a\\..\\b.png`, SID)).toBe(false)
    expect(isSessionStoragePath(`sessions/${SID}/%E0%A4%A`, SID)).toBe(false)
  })
})

describe('fileNameFromStoragePath', () => {
  it('drops the presign uuid prefix', () => {
    expect(fileNameFromStoragePath(`sessions/${SID}/${UUID}-team_photo.jpg`)).toBe('team_photo.jpg')
  })
  it('returns empty when there is no name', () => {
    expect(fileNameFromStoragePath(`sessions/${SID}/${UUID}-`)).toBe('')
  })
})
