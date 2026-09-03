import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { anthropic } from '@ai-sdk/anthropic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveEditContext } from '../../_helpers'
import { getCurrentUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { trimMessages } from '@/lib/agent/trim-messages'
import { recordTokenUsage } from '@/lib/content/token-usage'
import { aiStreamErrorMessage } from '@/lib/ai/ai-error'
import { buildBrandVoiceBlock } from '@/lib/content/brand-voice'
import {
  DRAFT_BRANCH,
  ensureDraftBranch,
  readFile,
  writeFiles,
  FileNotFoundError,
} from '@/lib/github/repo-files'
import { generateThemeCss, checkThemeContrast } from '@/lib/content/theme-css-generator'
import {
  patchBrandPalette,
  patchDesignTokens,
  upsertBlockOverride,
  PALETTE_ROLES,
  OVERRIDE_BLOCKS,
} from '@/lib/editor/theme-edit'
import { BRAND_PATH, DESIGN_PATH, OVERRIDES_PATH, THEME_CSS_PATH } from '../_theme'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'
export const maxDuration = 120

// A working blob: its current text + the draft-branch sha for optimistic locking.
type Blob = { content: string; sha: string }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  const { githubRepo, sessionId, adminEmail, adminName } = ctx

  // resolveEditContext allows assigned managers; theme editing is admin-only.
  const user = await getCurrentUser()
  if (!user || !user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { messages }: { messages: UIMessage[] } = await req.json()
  const supabase = createServerClient()

  // Working copies of the theme files. Each tool reads from these, commits the
  // changed files atomically to draft, then advances content + sha so a later
  // tool in the same turn builds on the committed version (StaleShaError catches
  // a concurrent save from another admin).
  const files: Record<string, Blob> = {}
  const loadFile = async (path: string, optional = false): Promise<Blob | null> => {
    try {
      const b = await readFile(githubRepo, path, DRAFT_BRANCH)
      return { content: b.content, sha: b.sha }
    } catch (err) {
      if (optional && err instanceof FileNotFoundError) return { content: '', sha: '' }
      if (err instanceof FileNotFoundError) return null
      throw err
    }
  }

  try {
    await ensureDraftBranch(githubRepo)
    const brand = await loadFile(BRAND_PATH)
    const design = await loadFile(DESIGN_PATH)
    if (!brand || !design) {
      return NextResponse.json(
        { error: 'This site has no brand.json / design.json yet — theme editing is unavailable.' },
        { status: 409 }
      )
    }
    files[BRAND_PATH] = brand
    files[DESIGN_PATH] = design
    files[THEME_CSS_PATH] = (await loadFile(THEME_CSS_PATH, true))!
    files[OVERRIDES_PATH] = (await loadFile(OVERRIDES_PATH, true))!
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load theme files' },
      { status: 500 }
    )
  }

  const commitAuthor = {
    authorName: adminName ?? DEFAULT_COMMIT_AUTHOR.name,
    authorEmail: adminEmail ?? DEFAULT_COMMIT_AUTHOR.email,
  }

  // Commit a set of already-computed file contents atomically to draft, then
  // advance the working copies + shas. Throws StaleShaError on a concurrent edit.
  async function commit(changes: { path: string; content: string }[], message: string): Promise<void> {
    const payload = changes.map((c) => ({
      path: c.path,
      content: c.content,
      expectedSha: files[c.path].sha || undefined,
    }))
    const res = await writeFiles(githubRepo, payload, DRAFT_BRANCH, message, commitAuthor)
    for (const c of changes) {
      files[c.path] = { content: c.content, sha: res.blobs[c.path] ?? files[c.path].sha }
    }
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', sessionId)
    .single()
  const schema = (session?.schema_data ?? {}) as SessionSchema
  const firmName = schema.business?.name ?? 'the firm'

  const currentBrand = () => JSON.parse(files[BRAND_PATH].content) as BrandJson
  const currentDesign = () => JSON.parse(files[DESIGN_PATH].content) as DesignJson
  const paletteSummary = () => {
    const p = currentBrand().palette
    return PALETTE_ROLES.map((r) => `${r}: ${p[r]}`).join(', ')
  }
  const tokenSummary = () => {
    const d = currentDesign()
    return `roundness: ${d.roundness}, density: ${d.density}, visualFeel: ${d.visualFeel}, radius: ${JSON.stringify(d.radius)}, spacing: ${JSON.stringify(d.spacing)}`
  }

  const system = `You are the theme/CSS design assistant for ${firmName}'s published website. You adjust the site's visual theme — its colour palette, corner roundness, spacing, and per-block CSS polish. You do NOT edit page copy (a separate content assistant does that).

${buildBrandVoiceBlock(schema)}

CURRENT THEME
Palette — ${paletteSummary()}
Tokens — ${tokenSummary()}

HOW THE THEME WORKS
- The 6-colour palette drives every surface: primary (headers, primary buttons, footer-dark), secondary, complementary, action (accents/rings/eyebrows), near-black (body text), near-white (page background). Foreground colours and dark mode are derived automatically with WCAG-safe contrast — you only set the 6 hexes.
- Roundness is controlled by the radius tokens (none/sm/md/lg/pill). "Pill buttons" = radius.pill ~9999px; "sharp/square" = small values like 0px–4px.
- Spacing tokens (xs…2xl) set the vertical rhythm; larger = airier.
- Per-block polish (e.g. "make the hero heading bigger", "tighten the pricing cards") is CSS targeting a block's data-block attribute.

YOUR TOOLS
- set_palette({ primary?, secondary?, complementary?, action?, nearBlack?, nearWhite? }) — set one or more palette roles to a #rrggbb hex. Only pass the roles you're changing. Regenerates the site theme.
- set_tokens({ roundness?, density?, visualFeel?, radius?, spacing? }) — set corner roundness / spacing tokens. radius and spacing take partial maps of CSS lengths, e.g. radius: { pill: "9999px", lg: "16px" }.
- set_block_override({ block, css }) — write a scoped CSS rule for ONE block. Always scope selectors to the block, e.g. \`[data-block="hero"] h1 { font-size: 3.5rem; }\`. Re-editing the same block replaces its prior rule. Valid blocks: ${OVERRIDE_BLOCKS.join(', ')}.

RULES
- Change ONLY what the admin asks for. Preserve the firm's existing brand character unless they ask to change it.
- When you change a colour, keep the palette coherent (don't break contrast). If a tool reports a contrast warning, tell the admin plainly which pair is low and offer to adjust.
- After a successful change, briefly say what changed. If a tool returns an error, tell the admin and try a corrected call — never claim success when a tool failed.
- Every change is saved to the DRAFT site. Tell the admin to review in the preview and Publish when ready. Never say it is live.
- Use hex colours (#rrggbb) and CSS lengths (px/rem) — never colour names or arbitrary CSS.`

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system,
    messages: await convertToModelMessages(trimMessages(messages)),
    maxOutputTokens: 4000,
    tools: {
      set_palette: {
        description:
          'Set one or more of the 6 palette roles to a #rrggbb hex. Only include roles you are changing. Regenerates and commits theme.css to the draft site.',
        inputSchema: z.object({
          primary: z.string().optional().describe('#rrggbb — headers, primary buttons, footer'),
          secondary: z.string().optional().describe('#rrggbb — secondary surfaces'),
          complementary: z.string().optional().describe('#rrggbb — complementary accents'),
          action: z.string().optional().describe('#rrggbb — CTAs, rings, eyebrows'),
          nearBlack: z.string().optional().describe('#rrggbb — body text / dark'),
          nearWhite: z.string().optional().describe('#rrggbb — page background / light'),
        }),
        execute: async (patch) => {
          const res = patchBrandPalette(files[BRAND_PATH].content, patch)
          if (!res.ok) return { error: res.reason }
          if (!res.changed) return { success: true, note: 'No change — those colours were already set.' }
          const themeCss = generateThemeCss(res.brand, currentDesign())
          try {
            await commit(
              [
                { path: BRAND_PATH, content: res.next },
                { path: THEME_CSS_PATH, content: themeCss },
              ],
              `Theme: update palette via AI (${adminEmail ?? 'admin'})`
            )
          } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to save the palette.' }
          }
          const failures = checkThemeContrast(res.brand)
          return {
            success: true,
            palette: paletteSummary(),
            contrastWarnings: failures.map((f) => `${f.name}: ${f.ratio.toFixed(2)}:1 (need ${f.minRatio}:1)`),
          }
        },
      },
      set_tokens: {
        description:
          'Set corner roundness / spacing tokens. radius + spacing take partial maps of CSS lengths. Regenerates and commits theme.css to the draft site.',
        inputSchema: z.object({
          roundness: z.enum(['sharp', 'soft', 'pill']).optional(),
          density: z.enum(['tight', 'balanced', 'airy']).optional(),
          visualFeel: z.enum(['classic', 'modern', 'editorial']).optional(),
          radius: z
            .object({
              none: z.string().optional(),
              sm: z.string().optional(),
              md: z.string().optional(),
              lg: z.string().optional(),
              pill: z.string().optional(),
            })
            .optional()
            .describe('CSS lengths, e.g. { pill: "9999px", lg: "16px" }'),
          spacing: z
            .object({
              xs: z.string().optional(),
              sm: z.string().optional(),
              md: z.string().optional(),
              lg: z.string().optional(),
              xl: z.string().optional(),
              '2xl': z.string().optional(),
            })
            .optional()
            .describe('CSS lengths, e.g. { xl: "64px" }'),
        }),
        execute: async (patch) => {
          const res = patchDesignTokens(files[DESIGN_PATH].content, patch)
          if (!res.ok) return { error: res.reason }
          if (!res.changed) return { success: true, note: 'No change — those tokens were already set.' }
          const themeCss = generateThemeCss(currentBrand(), res.design)
          try {
            await commit(
              [
                { path: DESIGN_PATH, content: res.next },
                { path: THEME_CSS_PATH, content: themeCss },
              ],
              `Theme: update tokens via AI (${adminEmail ?? 'admin'})`
            )
          } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to save the tokens.' }
          }
          return { success: true, tokens: tokenSummary() }
        },
      },
      set_block_override: {
        description:
          'Write a scoped CSS rule for ONE block (targets its data-block attribute). Re-editing the same block replaces its prior rule. Commits design-overrides.css to the draft site.',
        inputSchema: z.object({
          block: z.enum(OVERRIDE_BLOCKS).describe('The block to style'),
          css: z
            .string()
            .describe('CSS rule(s) scoped to the block, e.g. [data-block="hero"] h1 { font-size: 3.5rem; }'),
        }),
        execute: async ({ block, css }) => {
          const res = upsertBlockOverride(files[OVERRIDES_PATH].content, block, css)
          if (!res.ok) return { error: res.reason }
          try {
            await commit(
              [{ path: OVERRIDES_PATH, content: res.next }],
              `Theme: style ${block} via AI (${adminEmail ?? 'admin'})`
            )
          } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to save the CSS.' }
          }
          return { success: true, block }
        },
      },
    },
    stopWhen: stepCountIs(6),
    onFinish: async ({ totalUsage }) => {
      await recordTokenUsage({
        task: 'content',
        sessionId,
        createdBy: user?.id ?? null,
        stage: 'theme_edit',
        model: 'claude-sonnet-4-6',
        inputTokens: totalUsage.inputTokens,
        outputTokens: totalUsage.outputTokens,
      })
      await supabase
        .from('sessions')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('id', sessionId)
    },
  })

  return result.toUIMessageStreamResponse({
    onError: (error) => aiStreamErrorMessage(error),
  })
}
