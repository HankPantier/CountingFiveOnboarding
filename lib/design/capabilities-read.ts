// Server-only. Read the client template's capability marker from the DRAFT
// branch (what the next build ships). Missing ⇒ L1. Other GitHub errors throw
// (callers map them to internalError). Callers must have ensured the draft
// branch exists (readDraftThemeSnapshot / resolveEditContext paths do).
import { DRAFT_BRANCH, FileNotFoundError, readFile } from '@/lib/github/repo-files'
import { TEMPLATE_MARKER_PATH, parseTemplateMarker } from './capabilities'
import type { DesignCapabilities } from './run-types'

export async function readDesignCapabilities(githubRepo: string): Promise<DesignCapabilities> {
  try {
    const file = await readFile(githubRepo, TEMPLATE_MARKER_PATH, DRAFT_BRANCH)
    return parseTemplateMarker(file.content)
  } catch (err) {
    if (err instanceof FileNotFoundError) return parseTemplateMarker(null)
    throw err
  }
}
