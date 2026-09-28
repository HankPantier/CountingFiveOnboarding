// Server-only. Read the client template's capability marker from the DRAFT
// branch (what the next build ships). Missing ⇒ L1. Other GitHub errors throw
// (callers map them to internalError). Callers must have ensured the draft
// branch exists (readDraftThemeSnapshot / resolveEditContext paths do).
// readEffectiveCapabilities adds the deployed shell's half of the handshake
// (draft ∩ live <meta name="c5-capabilities">); the shell read never throws.
import { DRAFT_BRANCH, FileNotFoundError, readFile, readFileConditional } from '@/lib/github/repo-files'
import { TEMPLATE_MARKER_PATH, intersectWithShell, parseTemplateMarker } from './capabilities'
import type { DesignCapabilities } from './run-types'
import { readShellCapabilities } from './shell-capabilities'
import { normalizeLayoutPresets, type LayoutPresets } from './layout-presets'

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

// The DRAFT template's version for the editor's layout vocabulary (section
// layout picker, AI editor hint + tools). Read through the ETag layer — it runs
// on every editor open and chat turn and the marker rarely changes. Never
// throws: missing marker, no draft branch or any GitHub error ⇒ null (callers
// treat null as the baseline vocabulary).
export async function readDraftTemplateVersion(githubRepo: string): Promise<string | null> {
  try {
    const file = await readFileConditional(githubRepo, TEMPLATE_MARKER_PATH, DRAFT_BRANCH)
    return parseTemplateMarker(file.content).templateVersion
  } catch (err) {
    if (!(err instanceof FileNotFoundError)) {
      console.warn('[template-version] could not read the draft template marker; using baseline layouts', err)
    }
    return null
  }
}

// The DRAFT design.json `layout` presets (template 2026.09.9) for the editor's
// "Following the site preset" hint. ETag-cached like the version read; never
// throws: missing file, bad JSON or any GitHub error ⇒ null (no hint).
export async function readDraftLayoutPresets(githubRepo: string): Promise<LayoutPresets | null> {
  try {
    const file = await readFileConditional(githubRepo, 'content/design.json', DRAFT_BRANCH)
    return normalizeLayoutPresets((JSON.parse(file.content) as { layout?: unknown }).layout) ?? null
  } catch (err) {
    if (!(err instanceof FileNotFoundError) && !(err instanceof SyntaxError)) {
      console.warn('[layout-presets] could not read the draft design.json; no preset hints', err)
    }
    return null
  }
}
