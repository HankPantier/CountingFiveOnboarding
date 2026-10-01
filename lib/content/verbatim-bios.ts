import type { SessionSchema } from '@/types/session-schema'
import { findBlockComments } from '@/lib/editor/block-annotation'
import { parseTeamGridBlock, setTeamMemberField } from '@/lib/editor/structured-blocks/team-grid'
import { activeTeam } from './active-team'

// "### Jane Doe, CPA" → "jane doe"
const memberKey = (heading: string): string => heading.split(',')[0].replace(/\*\*/g, '').trim().toLowerCase()

// Bios an operator said to keep word-for-word (team[].bioVerbatim), by name.
export function verbatimBios(schema: SessionSchema): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of activeTeam(schema)) {
    if (m.bioVerbatim && m.name?.trim() && m.bio?.trim()) out.set(m.name.trim().toLowerCase(), m.bio.trim())
  }
  return out
}

// Replaces the bio of every verbatim-bio member in the page's team-grid
// sections with the client's exact text. Deterministic on purpose: the writer
// model never sees bios, so asking it to copy one would just invite a
// paraphrase. Names, titles and photos are left as generated. Pure.
export function enforceVerbatimBios(content: string, schema: SessionSchema): string {
  const bios = verbatimBios(schema)
  if (!bios.size) return content
  const comments = findBlockComments(content)
  if (!comments.some((c) => c.comment?.blockId === 'team-grid')) return content

  let out = ''
  let cursor = 0
  comments.forEach((c, i) => {
    const end = i + 1 < comments.length ? comments[i + 1].index : content.length
    out += content.slice(cursor, c.index)
    let section = content.slice(c.index, end)
    if (c.comment?.blockId === 'team-grid') {
      parseTeamGridBlock(section).members.forEach((m) => {
        const bio = bios.get(memberKey(m.name))
        if (bio && m.bio.trim() !== bio) section = setTeamMemberField(section, m.index, 'bio', bio)
      })
    }
    out += section
    cursor = end
  })
  return out + content.slice(cursor)
}
