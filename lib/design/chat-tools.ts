// Server-only (via the workspace → sanitizer, and chat-preview → renderer). The
// design chat's tool set. Edit tools patch the in-request working copy and
// validate immediately; they return { ok: false, error } instead of throwing,
// so the model can correct itself (fonts are refused below L2 by the
// workspace). render_preview renders the working copy (≤ PREVIEWS_PER_TURN per
// turn, refused when the preview could eat the commit reserve) and hands the
// model the screenshots via toModelOutput — from an in-request cache, so images
// reach the model only in the turn that rendered them (history is text). It
// never throws (PF4). commit_version delegates to the injected commit
// (chat-commit.ts). No style_axes tool until P6b.
//
// chatPreviewDeps binds render_preview to renderChatPreview for one turn: the
// SERVER-generated turn id (the assistant message id — never model- or
// client-supplied), the turn-start baseline (theme + shas: a commit mid-turn
// must not move the baseline) and the turn deadline.
import type { SupabaseClient } from '@supabase/supabase-js'
import { tool } from 'ai'
import { z } from 'zod'
import type { Database } from '@/types/database'
import { PALETTE_ROLES } from '@/lib/editor/theme-edit'
import { CSS_FRAGMENT_KEYS, type ChatEdit } from './chat-edits'
import { COMMIT_FAILED_ERROR } from './chat-commit'
import { previewCheck } from './chat-gate'
import {
  CHAT_COMMIT_RESERVE_MS,
  CHAT_PREVIEW_FAILED_ERROR,
  CHAT_PREVIEW_NO_TIME_ERROR,
  chatPreviewFits,
  chatPreviewTheme,
  isChatBaselineCached,
  renderChatPreview,
  type ChatPreviewResult,
  type ChatPreviewTarget,
} from './chat-preview'
import { PREVIEWS_PER_TURN, type CommitOutput, type RenderPreviewOutput } from './chat-types'
import type { ChatWorkspace, EditOutcome } from './chat-workspace'
import type { ComposedTheme } from './composed-theme'
import { RENDER_DEADLINE_MS } from './run-types'
import type { ThemeBlobShas } from './studio-types'

// The least a preview can cost (2 renders, baseline cached) plus the commit
// reserve; below this no preview can fit. The exact check (cached or not) is
// deps.previewFits.
export const MIN_PREVIEW_TIME_MS = 2 * RENDER_DEADLINE_MS + CHAT_COMMIT_RESERVE_MS
export const PREVIEW_LIMIT_ERROR = `You have used this turn’s ${PREVIEWS_PER_TURN} previews — commit, or ask the admin to continue in a new message.`
export const PREVIEW_TIME_ERROR = CHAT_PREVIEW_NO_TIME_ERROR
const EDIT_FAILED_ERROR = 'That change could not be validated — nothing was changed. Try a smaller or different change.'

export type ChatToolDeps = {
  defaultPage: string
  timeLeftMs: () => number
  preview: (page: string, previewNo: number, theme: ComposedTheme) => Promise<ChatPreviewResult>
  commit: (summary: string) => Promise<CommitOutput>
  // PF1: whether a preview of `page` started now still leaves
  // CHAT_COMMIT_RESERVE_MS (baseline cached or not). chatPreviewDeps provides it.
  previewFits?: (page: string) => boolean
}

// One turn's binding of render_preview to renderChatPreview (see header).
export function chatPreviewDeps(args: {
  db: SupabaseClient<Database>
  target: ChatPreviewTarget
  turnId: string
  baselineTheme: ComposedTheme
  baselineShas: ThemeBlobShas
  turnDeadlineAt: number
}): Pick<ChatToolDeps, 'timeLeftMs' | 'preview'> & { previewFits: (page: string) => boolean } {
  const { db, target, turnId, baselineTheme, baselineShas, turnDeadlineAt } = args
  return {
    timeLeftMs: () => turnDeadlineAt - Date.now(),
    previewFits: (page) =>
      chatPreviewFits({ now: Date.now(), turnDeadlineAt, baselineCached: isChatBaselineCached(target.sessionId, baselineShas, page) }),
    preview: (page, previewNo, theme) => renderChatPreview({ db, target, turnId, previewNo, page, theme, baselineTheme, baselineShas, turnDeadlineAt }),
  }
}

const hex = z.string().max(9).describe('#rrggbb')
const length = z.string().max(24).describe('CSS length, e.g. 16px or 1.5rem')
const fontName = z.string().max(60).describe('A curated font name')
const paletteShape = Object.fromEntries(PALETTE_ROLES.map((r) => [r, hex.optional()])) as Record<(typeof PALETTE_ROLES)[number], z.ZodOptional<typeof hex>>

function editOutput(o: EditOutcome) {
  if (!o.ok) return { ok: false as const, error: o.error }
  return { ok: true as const, changed: o.changed, staged: o.changed, notes: o.notes, ...(o.budget ? { cssBudget: o.budget } : {}) }
}

// What the model reads from a preview result: no signed URLs, ever.
function previewForModel(output: RenderPreviewOutput): unknown {
  if (!output.ok) return output
  const { shots, ...rest } = output
  return { ...rest, viewports: shots.map((s) => s.viewport) }
}

export function buildDesignChatTools(ws: ChatWorkspace, deps: ChatToolDeps) {
  const images = new Map<string, ChatPreviewResult['images']>()
  const edit = (e: ChatEdit) => {
    try {
      return editOutput(ws.apply(e))
    } catch (err) {
      console.error('[design-chat] edit tool failed', err)
      return { ok: false as const, error: EDIT_FAILED_ERROR }
    }
  }

  return {
    set_palette: tool({
      description: 'Stage palette changes: #rrggbb for the roles you change only. Validated for contrast immediately.',
      inputSchema: z.object(paletteShape),
      execute: async (patch) => edit({ kind: 'palette', patch }),
    }),
    set_fonts: tool({
      description: 'Stage font changes (curated fonts only). Refused on sites whose fonts are locked.',
      inputSchema: z.object({ headingFont: fontName.optional(), bodyFont: fontName.optional(), accentFont: fontName.optional() }),
      execute: async (patch) => edit({ kind: 'fonts', patch }),
    }),
    set_tokens: tool({
      description: 'Stage roundness / density / feel and partial radius or spacing maps (CSS lengths).',
      inputSchema: z.object({
        roundness: z.enum(['sharp', 'soft', 'pill']).optional(),
        density: z.enum(['tight', 'balanced', 'airy']).optional(),
        visualFeel: z.enum(['classic', 'modern', 'editorial']).optional(),
        radius: z.object({ none: length.optional(), sm: length.optional(), md: length.optional(), lg: length.optional(), pill: length.optional() }).optional(),
        spacing: z
          .object({ xs: length.optional(), sm: length.optional(), md: length.optional(), lg: length.optional(), xl: length.optional(), '2xl': length.optional() })
          .optional(),
      }),
      execute: async (patch) => edit({ kind: 'tokens', patch }),
    }),
    set_treatments: tool({
      description: 'Stage headline (sans|serif), eyebrow (standard|mono) and dark-section treatments.',
      inputSchema: z.object({
        headlineStyle: z.enum(['sans', 'serif']).optional(),
        eyebrowStyle: z.enum(['standard', 'mono']).optional(),
        darkSections: z.boolean().optional(),
      }),
      execute: async (patch) => edit({ kind: 'treatments', patch }),
    }),
    set_block_css: tool({
      description: 'Replace ONE target’s whole CSS fragment (a block id, a chrome id, or "global"). Sanitized immediately; see the CSS rules.',
      inputSchema: z.object({ target: z.enum(CSS_FRAGMENT_KEYS), css: z.string().max(16_000).describe('The full new CSS for this target') }),
      execute: async ({ target, css }) => edit({ kind: 'css', target, css }),
    }),
    remove_block_css: tool({
      description: 'Delete one target’s CSS fragment.',
      inputSchema: z.object({ target: z.enum(CSS_FRAGMENT_KEYS) }),
      execute: async ({ target }) => edit({ kind: 'remove-css', target }),
    }),
    render_preview: tool({
      description: `Render the staged design on a page (desktop + mobile) and see it, with render checks. At most ${PREVIEWS_PER_TURN} per turn.`,
      inputSchema: z.object({ page: z.string().max(200).optional().describe('Site path, e.g. /services (default: the admin’s page)') }),
      execute: async ({ page }, { toolCallId }): Promise<RenderPreviewOutput> => {
        try {
          const path = page ?? deps.defaultPage
          // PF1: the end-of-turn auto-commit always keeps its reserve.
          if (deps.timeLeftMs() < MIN_PREVIEW_TIME_MS) return { ok: false, error: PREVIEW_TIME_ERROR }
          if (deps.previewFits && !deps.previewFits(path)) return { ok: false, error: PREVIEW_TIME_ERROR }
          // A working copy that can't become theme files costs no slot.
          const theme = chatPreviewTheme(ws.renderedFiles())
          if (!theme.ok) return { ok: false, error: theme.error }
          if (!ws.takePreviewSlot()) return { ok: false, error: PREVIEW_LIMIT_ERROR }
          const previewNo = ws.previewsUsed()
          const r = await deps.preview(path, previewNo, theme.theme)
          ws.recordPreview({ metrics: r.metrics, baseline: r.baseline, shots: r.shots.map(({ url: _url, ...s }) => s) })
          if (r.shots.length === 0) return { ok: false, error: r.error ?? CHAT_PREVIEW_FAILED_ERROR }
          if (r.images.length > 0) images.set(toolCallId, r.images)
          const check = previewCheck(r.metrics, r.baseline)
          return {
            ok: true,
            previewNo,
            page: path,
            shots: r.shots,
            gateFailures: check.gateFailures,
            warnings: r.error ? [...check.warnings, r.error] : check.warnings,
            measured: r.metrics !== null,
          }
        } catch (err) {
          console.error('[design-chat] render_preview failed', err)
          return { ok: false, error: CHAT_PREVIEW_FAILED_ERROR }
        }
      },
      toModelOutput: ({ toolCallId, output }) => {
        const shown = images.get(toolCallId) ?? []
        const note = shown.length > 0 || !output.ok ? '' : ' (screenshots from an earlier turn are not shown again)'
        return {
          type: 'content',
          value: [
            { type: 'text', text: `${JSON.stringify(previewForModel(output))}${note}` },
            ...shown.map((i) => ({ type: 'image-data' as const, data: i.webp.toString('base64'), mediaType: 'image/webp' })),
          ],
        }
      },
    }),
    commit_version: tool({
      description: 'Save the staged design to the draft as a new version. Refused while the latest preview fails a render check.',
      inputSchema: z.object({ summary: z.string().min(1).max(300).describe('One line for the version list') }),
      execute: async ({ summary }): Promise<CommitOutput> => {
        try {
          return await deps.commit(summary)
        } catch (err) {
          console.error('[design-chat] commit_version failed', err)
          return { ok: false, error: COMMIT_FAILED_ERROR }
        }
      },
    }),
  }
}
