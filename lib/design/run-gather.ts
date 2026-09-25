// Server-only. What every Design-model prompt of a run needs besides images
// (P3's generate-step gather, extracted so the revise step builds
// byte-identical shared parts): the draft theme texts, the current design as
// a bundle, the chosen page's real markup, the MBP (schema — only ever read
// through the brief builders), content/design.md, the firm name, the
// capability tier and palette freedom. Never throws for an unloadable page
// (a note); fails (our own message) when the theme can't be read.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { readOptional } from './apply-bundle'
import type { DesignBundle } from './bundle'
import { bundleFromRepoFiles } from './bundle-files'
import { capabilitiesFromJson } from './capabilities'
import type { PromptImage, SharedPromptArgs } from './brief'
import { DESIGN_MD_PATH } from './brief/brand'
import { extractBlockSamples } from './brief/samples'
import { loadRenderShell, type RenderShell } from './render/render-folds'
import type { DesignRunRow } from './run-store'
import { readSessionSchema } from './store'
import { PALETTE_FREEDOMS } from './studio-types'
import { readDraftThemeTexts, type DraftThemeTexts } from './theme-snapshot'
import type { DesignCapabilities, PaletteFreedom } from './run-types'

type Db = SupabaseClient<Database>

export type GatherTarget = { sessionId: string; jobId: string; githubRepo: string }
export type BriefBasics = {
  theme: DraftThemeTexts
  current: DesignBundle
  caps: DesignCapabilities
  paletteFreedom: PaletteFreedom
  firmName: string
  schema: unknown
  designMd: string | null
  blockSamples: string
  shell: RenderShell | null
  notes: string[]
}

export function firmNameFrom(brandText: string): string {
  try {
    const name = (JSON.parse(brandText) as { firm?: { name?: unknown } }).firm?.name
    return typeof name === 'string' && name.trim() ? name.trim() : 'the firm'
  } catch {
    return 'the firm'
  }
}

export function paletteFreedomOf(run: Pick<DesignRunRow, 'palette_freedom'>): PaletteFreedom {
  return (PALETTE_FREEDOMS as readonly string[]).includes(run.palette_freedom) ? (run.palette_freedom as PaletteFreedom) : 'evolve'
}

export async function gatherBriefBasics(
  db: Db,
  target: GatherTarget,
  run: Pick<DesignRunRow, 'capabilities' | 'palette_freedom'>,
  pagePath: string,
  opts: { markup: boolean }
): Promise<{ ok: true; basics: BriefBasics } | { ok: false; error: string }> {
  const theme = await readDraftThemeTexts(target.githubRepo)
  if (!theme.ok) return { ok: false, error: theme.error }
  const { brandText, designText } = theme.files
  // The current design's levers (its CSS region is irrelevant input here, and
  // skipping it means malformed legacy markers can't block the run).
  const current = bundleFromRepoFiles({ brandText, designText, overridesCss: '' }, { name: 'Current design', source: 'baseline' })
  if (!current.ok) return { ok: false, error: `The current design can’t be read: ${current.errors.join(' ')}`.slice(0, 500) }

  const notes: string[] = []
  let shell: RenderShell | null = null
  let blockSamples = ''
  if (opts.markup) {
    const loaded = await loadRenderShell(target, pagePath)
    if (loaded.ok) {
      shell = loaded.shell
      blockSamples = extractBlockSamples(loaded.shell.shellHtml)
    } else {
      notes.push(`Page ${pagePath} could not be loaded (${loaded.reason}) — concepts were generated without its markup.`)
    }
  }
  const [schema, designMd] = await Promise.all([readSessionSchema(db, target.sessionId), readOptional(target.githubRepo, DESIGN_MD_PATH)])
  return {
    ok: true,
    basics: {
      theme: theme.files,
      current: current.bundle,
      caps: capabilitiesFromJson(run.capabilities),
      paletteFreedom: paletteFreedomOf(run),
      firmName: firmNameFrom(brandText),
      schema,
      designMd: designMd?.content ?? null,
      blockSamples,
      shell,
      notes,
    },
  }
}

// The shared prompt args both the concept and the revise prompt are built from.
export function sharedPromptArgs(basics: BriefBasics, run: Pick<DesignRunRow, 'admin_brief'>, pagePath: string, images: PromptImage[]): SharedPromptArgs {
  return {
    caps: basics.caps,
    paletteFreedom: basics.paletteFreedom,
    current: basics.current,
    firmName: basics.firmName,
    schema: basics.schema,
    designMd: basics.designMd,
    adminBrief: run.admin_brief,
    images,
    blockSamples: basics.blockSamples,
    pagePath,
  }
}
