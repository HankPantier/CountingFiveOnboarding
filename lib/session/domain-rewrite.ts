// Pure helpers for the firm rename / domain-change flow. Kept separate from the
// routes so the host parsing + rewrite logic is unit-testable.

// Reduce a raw website value ("https://www.example.com/x?y") to its bare host
// ("example.com") for display, comparison, and substring matching in URLs.
export function hostOf(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
    .trim()
}

// Replace every occurrence of the old host (with or without a leading www.)
// with the new host, case-insensitively. Used to migrate URLs/links in already
// generated content when the operator opts to patch it after a domain change.
export function rewriteHost(text: string, oldHost: string, newHost: string): string {
  if (!text || !oldHost || oldHost === newHost) return text
  const esc = oldHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`(?:www\\.)?${esc}`, 'gi'), newHost)
}
