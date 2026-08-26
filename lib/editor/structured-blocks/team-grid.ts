// Inline field editing for a single team-grid block's text. Photo, reorder, and
// remove reuse team-photos.ts (call those directly with the block text as the
// "body" — refs then carry blockIndex 0); this module adds the text fields
// (name / job title / bio) and an "add member" op. Member spans are keyed off
// `### ` headings exactly like team-photos.parseMembers so all the helpers agree
// on card boundaries. Pure, never throws; returns input unchanged on drift.
//
// Grammar (matches the template's md-utils.ts parseTeamMembers):
//   ### Name, Credentials         (heading)
//   photo: file.jpg               (optional, immediately under the heading)
//   Managing Partner              (optional short job-title line)
//   Bio paragraph(s)…

import type { TeamGridModel, TeamMemberModel } from './types'

const HEADING_RE = /^### (.+)$/
const PHOTO_RE = /^photo:\s*(.*)$/
const H2_RE = /^##\s+(.+?)\s*$/

type MemberSpan = {
  index: number
  startLine: number
  endLine: number
  name: string
  photo: string | null
  photoLine: number | null
  titleLine: number | null
  title: string | null
  bioStart: number
  bioEnd: number
  bio: string
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function scanMembers(lines: string[]): MemberSpan[] {
  const headings: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) headings.push(i)
  }
  return headings.map((start, idx) => {
    const end = idx + 1 < headings.length ? headings[idx + 1] : lines.length
    const name = lines[start].match(HEADING_RE)![1].trim()

    let cursor = start + 1
    let photo: string | null = null
    let photoLine: number | null = null
    if (cursor < end) {
      const pm = lines[cursor].match(PHOTO_RE)
      if (pm) {
        photoLine = cursor
        photo = pm[1].trim() || null
        cursor++
      }
    }

    // Content lines after the (optional) photo line, ignoring blanks.
    const content: number[] = []
    for (let i = cursor; i < end; i++) if (!isBlank(lines[i])) content.push(i)

    let titleLine: number | null = null
    let title: string | null = null
    let bioIdx = content
    if (content.length >= 2) {
      const first = lines[content[0]].trim()
      if (first.length < 60 && !/[.!?]$/.test(first)) {
        titleLine = content[0]
        title = first.replace(/\*\*/g, '').trim()
        bioIdx = content.slice(1)
      }
    }
    const bioStart = bioIdx.length > 0 ? bioIdx[0] : cursor
    const bioEnd = bioIdx.length > 0 ? bioIdx[bioIdx.length - 1] + 1 : cursor
    const bio = lines.slice(bioStart, bioEnd).join('\n').trim()

    return { index: idx, startLine: start, endLine: end, name, photo, photoLine, titleLine, title, bioStart, bioEnd, bio }
  })
}

export function parseTeamGridBlock(block: string): TeamGridModel {
  const lines = block.split('\n')
  const heading = lines.find((l) => H2_RE.test(l))?.match(H2_RE)?.[1]?.trim() ?? ''
  const members: TeamMemberModel[] = scanMembers(lines).map((m) => ({
    index: m.index,
    name: m.name,
    title: m.title,
    photo: m.photo,
    bio: m.bio,
  }))
  return { heading, members }
}

function rewrite(
  block: string,
  index: number,
  fn: (lines: string[], member: MemberSpan) => string[] | null
): string {
  const lines = block.split('\n')
  const member = scanMembers(lines)[index]
  if (!member) return block
  const next = fn(lines, member)
  return next === null ? block : next.join('\n')
}

export function setTeamMemberField(
  block: string,
  index: number,
  field: 'name' | 'title' | 'bio',
  value: string
): string {
  return rewrite(block, index, (lines, m) => {
    const next = [...lines]
    if (field === 'name') {
      next[m.startLine] = `### ${value.trim()}`
      return next
    }
    if (field === 'title') {
      const title = value.trim()
      if (m.titleLine !== null) {
        if (title) next[m.titleLine] = title
        else next.splice(m.titleLine, 1)
        return next
      }
      if (!title) return null
      // Insert a title line right under the heading (or the photo line).
      const at = m.photoLine !== null ? m.photoLine + 1 : m.startLine + 1
      next.splice(at, 0, title)
      return next
    }
    // bio
    const bioLines = value.trim() === '' ? [] : value.trim().split('\n')
    if (m.bio !== '') {
      next.splice(m.bioStart, m.bioEnd - m.bioStart, ...bioLines)
    } else if (bioLines.length > 0) {
      const at = m.titleLine !== null ? m.titleLine + 1 : m.photoLine !== null ? m.photoLine + 1 : m.startLine + 1
      next.splice(at, 0, ...bioLines)
    }
    return next
  })
}

export function addTeamMember(block: string): string {
  const lines = [...block.split('\n')]
  while (lines.length > 0 && isBlank(lines[lines.length - 1])) lines.pop()
  return [...lines, '', '### New Member', 'Describe this team member.', ''].join('\n')
}
