// Extracts the repo-local image references on a page so the editor can show a
// thumbnail + replace control for each. Repo images live flat under
// public/content-assets/ and are referenced by bare filename — both in the
// `hero_image` frontmatter field and as inline markdown `![alt](file.png)`.
// External URLs (http/https) and absolute paths are left alone.

import type { PageFile } from './frontmatter'

export const ASSET_ROOT = 'public/content-assets/'

export type PageImageRef = {
  key: string // stable identity for React keys
  source: 'hero_image' | 'body'
  filename: string // bare filename, e.g. "hero-home.png"
  assetPath: string // public/content-assets/<filename>
  alt: string
}

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg)$/i
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

function isExternal(src: string): boolean {
  return /^https?:\/\//i.test(src) || src.startsWith('//')
}

// A bare filename or a path whose basename is a content-asset image. Returns
// the basename, or null if the ref is external / not an image.
export function localImageFilename(src: string): string | null {
  if (isExternal(src)) return null
  const cleaned = src.replace(/^\.?\//, '')
  const basename = cleaned.split('/').pop() ?? cleaned
  if (!IMAGE_EXT_RE.test(basename)) return null
  return basename
}

export function extractPageImages(file: PageFile): PageImageRef[] {
  const refs: PageImageRef[] = []
  const seen = new Set<string>()

  const hero = file.frontmatter?.fields['hero_image']
  if (hero) {
    const filename = localImageFilename(hero)
    if (filename) {
      refs.push({
        key: `hero:${filename}`,
        source: 'hero_image',
        filename,
        assetPath: ASSET_ROOT + filename,
        alt: file.frontmatter?.fields['hero_image_alt'] ?? '',
      })
      seen.add(filename)
    }
  }

  for (const match of file.body.matchAll(MD_IMAGE_RE)) {
    const alt = match[1] ?? ''
    const filename = localImageFilename(match[2] ?? '')
    if (!filename || seen.has(filename)) continue
    seen.add(filename)
    refs.push({
      key: `body:${filename}`,
      source: 'body',
      filename,
      assetPath: ASSET_ROOT + filename,
      alt,
    })
  }

  return refs
}
