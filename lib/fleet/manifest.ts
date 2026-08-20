import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Manifest, TreeEntryLike } from './types'
import type { TreeEntry } from '@/lib/github/repo-files'

// The manifest lives at repo-root config/template-managed-paths.json.
const DEFAULT_MANIFEST_PATH = path.join(process.cwd(), 'config', 'template-managed-paths.json')

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`template-managed-paths.json: "${field}" must be an array of strings`)
  }
  return value as string[]
}

export function loadManifest(manifestPath: string = DEFAULT_MANIFEST_PATH): Manifest {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
  return {
    include: assertStringArray(raw.include, 'include'),
    exclude: assertStringArray(raw.exclude, 'exclude'),
    flagIfChanged: assertStringArray(raw.flagIfChanged ?? [], 'flagIfChanged'),
  }
}

// An entry matches a path when it equals it exactly, or (for a directory entry
// ending in '/') the path sits under it.
function matches(entry: string, filePath: string): boolean {
  if (entry.endsWith('/')) return filePath.startsWith(entry)
  return filePath === entry
}

function matchesAny(entries: string[], filePath: string): boolean {
  return entries.some((e) => matches(e, filePath))
}

// A path is template-managed (safe to sync) when an include matches AND no
// exclude matches. Exclude always wins so client-owned files (theme.css,
// content/**, site.config.ts) can never be synced even if an include is broad.
export function isManaged(filePath: string, manifest: Manifest): boolean {
  return matchesAny(manifest.include, filePath) && !matchesAny(manifest.exclude, filePath)
}

export function isFlagged(filePath: string, manifest: Manifest): boolean {
  return matchesAny(manifest.flagIfChanged, filePath)
}

// The subset of a template file tree that a rollout will sync — blobs only,
// filtered by the manifest. Pure so it can be unit-tested without GitHub.
export function selectManagedPaths(
  tree: readonly TreeEntryLike[],
  manifest: Manifest
): string[] {
  return tree
    .filter((n) => n.type === 'blob' && isManaged(n.path, manifest))
    .map((n) => n.path)
    .sort()
}

// Re-export a narrow structural type so callers can pass real octokit TreeEntry
// or a test fixture without importing the github module.
export type { TreeEntry }
