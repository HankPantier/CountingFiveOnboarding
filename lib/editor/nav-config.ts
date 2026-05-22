import type { NavJson, NavItem } from '@/types/nav-json'

export class InvalidNavJsonError extends Error {
  constructor(message: string) {
    super(`Invalid nav.json: ${message}`)
    this.name = 'InvalidNavJsonError'
  }
}

function validateNavItem(item: unknown, path: string): NavItem {
  if (!item || typeof item !== 'object') {
    throw new InvalidNavJsonError(`${path} is not an object`)
  }
  const obj = item as Record<string, unknown>
  if (typeof obj.label !== 'string' || obj.label.trim() === '') {
    throw new InvalidNavJsonError(`${path}.label must be a non-empty string`)
  }
  if (typeof obj.url !== 'string' || obj.url.trim() === '') {
    throw new InvalidNavJsonError(`${path}.url must be a non-empty string`)
  }
  const result: NavItem = { label: obj.label, url: obj.url }
  if (obj.children !== undefined) {
    if (!Array.isArray(obj.children)) {
      throw new InvalidNavJsonError(`${path}.children must be an array`)
    }
    result.children = obj.children.map((c, i) =>
      validateNavItem(c, `${path}.children[${i}]`)
    )
  }
  return result
}

export function parseNavJson(text: string): NavJson {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (err) {
    throw new InvalidNavJsonError(`malformed JSON — ${(err as Error).message}`)
  }
  if (!value || typeof value !== 'object') {
    throw new InvalidNavJsonError('root must be an object')
  }
  const obj = value as Record<string, unknown>
  if (!Array.isArray(obj.primary)) {
    throw new InvalidNavJsonError('primary must be an array')
  }
  const primary = obj.primary.map((item, i) => validateNavItem(item, `primary[${i}]`))
  const result: NavJson = { primary }
  if (obj.cta !== undefined) {
    if (!obj.cta || typeof obj.cta !== 'object') {
      throw new InvalidNavJsonError('cta must be an object')
    }
    const cta = obj.cta as Record<string, unknown>
    if (typeof cta.label !== 'string' || typeof cta.url !== 'string') {
      throw new InvalidNavJsonError('cta.label and cta.url must be strings')
    }
    result.cta = { label: cta.label, url: cta.url }
  }
  return result
}

export function serializeNavJson(nav: NavJson): string {
  return JSON.stringify(nav, null, 2) + '\n'
}
