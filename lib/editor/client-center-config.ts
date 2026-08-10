import type { ClientCenterJson, ClientCenterGroup, ClientPortalLink } from '@/types/client-center'

export class InvalidClientCenterJsonError extends Error {
  constructor(message: string) {
    super(`Invalid client-center.json: ${message}`)
    this.name = 'InvalidClientCenterJsonError'
  }
}

function validateLink(item: unknown, path: string): ClientPortalLink {
  if (!item || typeof item !== 'object') {
    throw new InvalidClientCenterJsonError(`${path} is not an object`)
  }
  const obj = item as Record<string, unknown>
  if (typeof obj.label !== 'string' || obj.label.trim() === '') {
    throw new InvalidClientCenterJsonError(`${path}.label must be a non-empty string`)
  }
  if (typeof obj.url !== 'string' || obj.url.trim() === '') {
    throw new InvalidClientCenterJsonError(`${path}.url must be a non-empty string`)
  }
  const link: ClientPortalLink = { label: obj.label, url: obj.url }
  if (obj.description !== undefined) {
    if (typeof obj.description !== 'string') {
      throw new InvalidClientCenterJsonError(`${path}.description must be a string`)
    }
    if (obj.description.trim() !== '') link.description = obj.description
  }
  if (obj.icon !== undefined) {
    if (typeof obj.icon !== 'string') {
      throw new InvalidClientCenterJsonError(`${path}.icon must be a string`)
    }
    if (obj.icon.trim() !== '') link.icon = obj.icon
  }
  return link
}

function validateGroup(item: unknown, path: string): ClientCenterGroup {
  if (!item || typeof item !== 'object') {
    throw new InvalidClientCenterJsonError(`${path} is not an object`)
  }
  const obj = item as Record<string, unknown>
  if (typeof obj.title !== 'string' || obj.title.trim() === '') {
    throw new InvalidClientCenterJsonError(`${path}.title must be a non-empty string`)
  }
  if (!Array.isArray(obj.links)) {
    throw new InvalidClientCenterJsonError(`${path}.links must be an array`)
  }
  return {
    title: obj.title,
    links: obj.links.map((l, i) => validateLink(l, `${path}.links[${i}]`)),
  }
}

export function parseClientCenterJson(text: string): ClientCenterJson {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (err) {
    throw new InvalidClientCenterJsonError(`malformed JSON — ${(err as Error).message}`)
  }
  if (!value || typeof value !== 'object') {
    throw new InvalidClientCenterJsonError('root must be an object')
  }
  const obj = value as Record<string, unknown>
  if (typeof obj.enabled !== 'boolean') {
    throw new InvalidClientCenterJsonError('enabled must be a boolean')
  }
  if (typeof obj.label !== 'string' || obj.label.trim() === '') {
    throw new InvalidClientCenterJsonError('label must be a non-empty string')
  }
  if (!Array.isArray(obj.groups)) {
    throw new InvalidClientCenterJsonError('groups must be an array')
  }
  return {
    enabled: obj.enabled,
    label: obj.label,
    groups: obj.groups.map((g, i) => validateGroup(g, `groups[${i}]`)),
  }
}

export function serializeClientCenterJson(config: ClientCenterJson): string {
  return JSON.stringify(config, null, 2) + '\n'
}
