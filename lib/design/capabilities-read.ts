// Server-only. Read the client template's capability marker from the DRAFT
// branch (what the next build ships). Missing ⇒ L1. Other GitHub errors throw
// (callers map them to internalError). Callers must have ensured the draft
// branch exists (readDraftThemeSnapshot / resolveEditContext paths do).
// readEffectiveCapabilities adds the deployed shell's half of the handshake
// (draft ∩ live <meta name="c5-capabilities">); the shell read never throws.
import { DRAFT_BRANCH, FileNotFoundError, readFile } from '@/lib/github/repo-files'
import { TEMPLATE_MARKER_PATH, intersectWithShell, parseTemplateMarker } from './capabilities'
import type { DesignCapabilities } from './run-types'
import { readShellCapabilities } from './shell-capabilities'

export async function readDesignCapabilities(githubRepo: string): Promise<DesignCapabilities> {
  try {
    const file = await readFile(githubRepo, TEMPLATE_MARKER_PATH, DRAFT_BRANCH)
    return parseTemplateMarker(file.content)
  } catch (err) {
    if (err instanceof FileNotFoundError) return parseTemplateMarker(null)
    throw err
  }
}

// `draft`: what the draft template supports — use for FILE-CONTRACT decisions
// (write/guard the fonts module, which paths applied_blobs + drift track).
// `effective`: draft ∩ deployed shell — use for GATES (which levers a run,
// chat or commit may change).
export type CapabilityRead = { draft: DesignCapabilities; effective: DesignCapabilities }

export async function readEffectiveCapabilities(args: { githubRepo: string; jobId: string }): Promise<CapabilityRead> {
  const [draft, shell] = await Promise.all([readDesignCapabilities(args.githubRepo), readShellCapabilities(args)])
  return { draft, effective: intersectWithShell(draft, shell) }
}
