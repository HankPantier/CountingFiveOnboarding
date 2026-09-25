// Pure. The firm's brand brief for the DYNAMIC part of the prompt. The MBP
// reaches the model ONLY through buildBrandVoiceBlock / buildFirmContext,
// which emit curated fields (they read _meta.field_provenance internally to
// drop thin samples, but never print it). Raw schema_data JSON is never
// serialized here, and sessions.mbp_content is never read.
import type { SessionSchema } from '@/types/session-schema'
import { buildBrandVoiceBlock, buildFirmContext } from '@/lib/content/brand-voice'

export const DESIGN_MD_PATH = 'content/design.md'
const DESIGN_MD_CAP = 3000

// Ported from export-design-brief: drop an optional leading HTML comment and a
// YAML front-matter block, keeping the narrative design direction.
export function stripFrontMatter(md: string): string {
  let s = md.replace(/^\s*<!--[\s\S]*?-->\s*/, '')
  if (s.startsWith('---')) {
    const end = s.indexOf('\n---', 3)
    if (end !== -1) s = s.slice(end + 4).replace(/^\n/, '')
  }
  return s
}

export function buildBrandBrief(args: { firmName: string; schema: unknown; designMd: string | null }): string {
  const schema = (args.schema && typeof args.schema === 'object' && !Array.isArray(args.schema) ? args.schema : {}) as SessionSchema
  const voice = buildBrandVoiceBlock(schema).trim()
  const firm = buildFirmContext(schema).trim()
  const direction = args.designMd ? stripFrontMatter(args.designMd).trim().slice(0, DESIGN_MD_CAP) : ''
  return [
    `FIRM: ${args.firmName}`,
    voice,
    firm ? `FIRM PROFILE:\n${firm}` : '',
    direction ? `INTENDED DESIGN DIRECTION (from the site's design.md):\n${direction}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}
