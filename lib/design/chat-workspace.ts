// Server-only (concept-validate / bundle-files → the CSS sanitizer →
// lightningcss). The design chat's working copy for ONE turn (one request):
// seeded from the draft at turn start, patched by the edit tools, validated on
// every patch exactly like a concept (checkConceptCandidate: zod, capability
// tier, palette freedom "free", sanitizer, contrast), rendered by
// render_preview and committed by commit_version / the end-of-turn
// auto-commit. It never touches the network or the DB. Nothing here survives
// the request (P5 R1: no staged state between turns, no migration).
import type { DesignBundle } from './bundle'
import { bundleToRepoFiles, type RenderedThemeFiles, type RepoThemeFiles } from './bundle-files'
import { fontsUnlocked } from './capabilities'
import { applyChatEdit, describeChatEdit, fragmentOf, sameLevers, type ChatEdit, type CssFragmentKey } from './chat-edits'
import { PREVIEWS_PER_TURN } from './chat-types'
import { checkConceptCandidate } from './concept-validate'
import { cssByteLength, cssCaps, countCssLines } from './css-budget'
import type { RenderMetrics } from './metrics'
import type { DesignCapabilities, RunScreenshot } from './run-types'
import type { ThemeBlobShas } from './studio-types'

export const FONTS_LOCKED_TOOL_ERROR =
  'Fonts are locked on this site (its template is below L2) — nothing was changed. Express type through the type-scale custom properties, tracking and treatments instead.'

export type WorkspaceInit = { current: DesignBundle; draftFiles: RepoThemeFiles; draftShas: ThemeBlobShas; caps: DesignCapabilities; model: string }
export type EditOutcome = { ok: true; changed: boolean; notes: string[]; budget: string | null } | { ok: false; error: string }
export type WorkspacePreview = { revision: number; metrics: RenderMetrics | null; baseline: RenderMetrics | null; shots: RunScreenshot[] }

function fragmentBudget(css: DesignBundle['css'], target: CssFragmentKey): string {
  const body = fragmentOf(css, target) ?? ''
  const { maxBytes, maxLines } = cssCaps(target === 'global' ? 'global' : 'target')
  return `${target}: ${countCssLines(body)}/${maxLines} lines, ${cssByteLength(body)}/${maxBytes} bytes`
}

export class ChatWorkspace {
  readonly caps: DesignCapabilities
  private working: DesignBundle
  private files: RepoThemeFiles
  private shas: ThemeBlobShas
  private rev = 0
  private committedRev = 0
  private pending: string[] = []
  private previews = 0
  private preview: WorkspacePreview | null = null
  private versionIds: string[] = []

  constructor(private readonly init: WorkspaceInit) {
    this.caps = init.caps
    this.working = init.current
    this.files = init.draftFiles
    this.shas = init.draftShas
  }

  bundle(): DesignBundle {
    return this.working
  }
  revision(): number {
    return this.rev
  }
  isStaged(): boolean {
    return this.rev !== this.committedRev
  }
  draftShas(): ThemeBlobShas {
    return this.shas
  }
  pendingSummary(): string {
    return [...new Set(this.pending)].join(', ').slice(0, 300)
  }

  apply(edit: ChatEdit): EditOutcome {
    if (edit.kind === 'fonts' && !fontsUnlocked(this.caps)) return { ok: false, error: FONTS_LOCKED_TOOL_ERROR }
    const candidate = applyChatEdit(this.working, edit)
    if (sameLevers(candidate, this.working)) return { ok: true, changed: false, notes: [], budget: null }
    const v = checkConceptCandidate(
      candidate,
      { current: this.init.current, caps: this.caps, paletteFreedom: 'free', draftFiles: this.files, model: this.init.model },
      []
    )
    if (!v.ok) return { ok: false, error: v.errors.join(' ').slice(0, 1500) }
    // The sanitizer may normalize the edit away (e.g. CSS that sanitizes to the
    // fragment already staged): compare what WOULD be staged, so a no-op never
    // bumps the revision (which would stale the preview and re-commit nothing).
    if (sameLevers(v.concept.bundle, this.working)) return { ok: true, changed: false, notes: [], budget: null }
    this.working = { ...v.concept.bundle, name: this.working.name, meta: { source: 'chat', model: this.init.model } }
    this.rev++
    this.pending.push(describeChatEdit(edit))
    return { ok: true, changed: true, notes: v.concept.notes, budget: edit.kind === 'css' ? fragmentBudget(this.working.css, edit.target) : null }
  }

  // The files a commit (or preview) of the working copy produces — hand CSS
  // outside the managed region is KEPT (removeLegacy: false), same as commit.
  renderedFiles(): { ok: true; files: RenderedThemeFiles } | { ok: false; errors: string[] } {
    const r = bundleToRepoFiles(this.working, this.files, { removeLegacy: false })
    return r.ok ? { ok: true, files: r.files } : { ok: false, errors: r.errors }
  }

  takePreviewSlot(): boolean {
    if (this.previews >= PREVIEWS_PER_TURN) return false
    this.previews++
    return true
  }
  previewsUsed(): number {
    return this.previews
  }
  // Hands back a slot taken for a preview that never rendered (no time left).
  releasePreviewSlot(): void {
    if (this.previews > 0) this.previews--
  }
  // `revision` = the revision whose theme was rendered (captured when the
  // preview theme was taken); an edit that landed during the render makes the
  // recorded preview stale, so it never gates CSS it didn't render.
  recordPreview(p: Omit<WorkspacePreview, 'revision'>, revision: number = this.rev): void {
    this.preview = { ...p, revision }
  }
  // The preview of the CURRENT working copy, or null (never previewed / edited since).
  currentPreview(): WorkspacePreview | null {
    return this.preview && this.preview.revision === this.rev ? this.preview : null
  }

  // `at` = the revision + bundle that was actually committed (captured before
  // the commit's await). Edits applied after it stay staged — with their
  // pending summaries — for the next commit / the auto-commit.
  markCommitted(appliedBlobs: ThemeBlobShas, versionId: string | null, at: { revision: number; bundle: DesignBundle } = { revision: this.rev, bundle: this.working }): void {
    const r = bundleToRepoFiles(at.bundle, this.files, { removeLegacy: false })
    if (r.ok) this.files = { brandText: r.files.brandText, designText: r.files.designText, overridesCss: r.files.overridesCss }
    this.shas = appliedBlobs
    this.pending = this.pending.slice(Math.max(0, at.revision - this.committedRev))
    this.committedRev = at.revision
    if (versionId) this.versionIds.push(versionId)
  }
  lastVersionId(): string | null {
    return this.versionIds[this.versionIds.length - 1] ?? null
  }
}
