/**
 * Synthesizes a square SVG headshot placeholder when a team member has no
 * uploaded photo. Pattern mirrors lib/content/wordmark-generator.ts:
 * generate a self-contained, brand-colored SVG that ships inside the
 * deliverable zip under public/content-assets/, so the Phase II TeamGrid
 * renders something polished instead of falling back to a name-in-box.
 *
 * Layout: solid primary-color background, white initials centered. Two-letter
 * initials by default (first letter of first name + first letter of last
 * name); falls back to a single letter for single-name entries.
 *
 * Pure and never throws.
 */

function escapeXmlText(input: string): string {
  return input.replace(/[<>&"']/g, c => {
    switch (c) {
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '&': return '&amp;'
      case '"': return '&quot;'
      case "'": return '&apos;'
      default: return c
    }
  })
}

function computeInitials(fullName: string): string {
  const cleaned = fullName.trim().replace(/\s+/g, ' ')
  if (!cleaned) return '?'
  // Drop credential suffixes like "Ron Lague, CPA, PFS" → "Ron Lague" before
  // computing initials. The caller usually passes a clean name but defensive
  // anyway for hand-edited team data.
  const namePart = cleaned.split(',')[0].trim()
  const tokens = namePart.split(' ').filter(Boolean)
  if (tokens.length === 1) {
    return tokens[0].charAt(0).toUpperCase()
  }
  return (tokens[0].charAt(0) + tokens[tokens.length - 1].charAt(0)).toUpperCase()
}

export type InitialsAvatarInput = {
  memberName: string
  primaryColor: string  // hex like "#003B71"
  foregroundColor?: string  // hex; defaults to "#FFFFFF"
  headingFont?: string  // Google font family; defaults to "Georgia, serif"
}

export type InitialsAvatarOutput = {
  svg: string
  filename: string  // e.g., "ron-lague-avatar.svg"
}

export function generateInitialsAvatar(input: InitialsAvatarInput): InitialsAvatarOutput {
  const initials = computeInitials(input.memberName)
  const fg = input.foregroundColor ?? '#FFFFFF'
  const font = input.headingFont ?? 'Georgia, serif'
  const safeName = escapeXmlText(input.memberName.trim() || 'Team member')

  // 400px square base. The Phase II TeamGrid uses aspect-[4/5] and constrains
  // photo width with `sizes` attribute, so the actual rendered size is
  // determined by CSS; 400px is a sane source resolution.
  const size = 400
  // Font size scaled to look balanced regardless of one-letter or two-letter
  // initials. Two letters need to fit horizontally with breathing room.
  const fontSize = initials.length === 1 ? Math.round(size * 0.5) : Math.round(size * 0.38)

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Initials avatar for ${safeName}">
  <rect width="${size}" height="${size}" fill="${input.primaryColor}"/>
  <text x="50%" y="50%" font-family="${escapeXmlText(font)}, Georgia, serif" font-weight="600" font-size="${fontSize}" fill="${fg}" text-anchor="middle" dominant-baseline="central">${escapeXmlText(initials)}</text>
</svg>
`

  const slug = input.memberName
    .toLowerCase()
    .split(',')[0]
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'member'

  return { svg, filename: `${slug}-avatar.svg` }
}
