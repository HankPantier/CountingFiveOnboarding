// ---------------------------------------------------------------------------
// Image handling for the WordPress blog-sync bridge.
//
// Client repos are private, so a post's hero image (a bare filename resolving to
// public/content-assets/<file>) is not publicly fetchable. Instead of leaking a
// repo URL, the feed emits an authenticated PROXY url; the WP plugin fetches it
// with the same bearer secret, and the proxy route streams the bytes through the
// GitHub App. WordPress never holds a GitHub token.
// ---------------------------------------------------------------------------

import { readBinaryFile, MAIN_BRANCH, type BinaryBlob } from '@/lib/github/repo-files'

export type HeroImage = {
  url: string
  requires_auth: boolean // true → WP plugin must send the bearer header to fetch
  alt: string | null
  filename: string
}

// Only these repo roots may be proxied. Hero images live under content-assets.
const ASSET_ROOTS = ['public/content-assets/', 'public/og-images/']

// Build the proxy URL the WP plugin fetches for a bare hero-image filename.
export function assetUrlFor(origin: string, siteKey: string, filename: string): string {
  const path = `public/content-assets/${filename}`
  return `${origin}/api/wp-feed/${encodeURIComponent(siteKey)}/asset?path=${encodeURIComponent(path)}`
}

// Decode-then-normalize before the allowlist check (CLAUDE.md security rule 8):
// an encoded `..%2F` traversal escapes the root only after decoding. Returns the
// normalized safe path, or null if it fails to decode / escapes / is off-root.
export function isAllowedAssetPath(rawPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  const normalized = decoded.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  if (normalized.includes('..')) return null
  if (!ASSET_ROOTS.some((root) => normalized.startsWith(root))) return null
  return normalized
}

// Read image bytes from the published branch through the GitHub App.
export async function readRepoAsset(githubRepo: string, path: string): Promise<BinaryBlob> {
  return readBinaryFile(githubRepo, path, MAIN_BRANCH)
}
