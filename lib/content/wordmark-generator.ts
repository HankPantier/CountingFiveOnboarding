/**
 * Generates an SVG wordmark from the firm name when no logo file was uploaded
 * during onboarding. The Phase II NavBar reads brand.json's logo.primary and
 * renders the file from public/content-assets/. Without a wordmark, the
 * fallback is plain text in the header — adequate but unbranded. This gives
 * every deliverable a styled top-left mark in the brand's primary color and
 * heading font.
 *
 * The SVG references the Google heading font by name and gracefully degrades
 * to serif if the font hasn't loaded (e.g., when the SVG is opened directly
 * without a Next.js page context). The width is estimated from character
 * count because computing text metrics server-side without a real font is
 * unreliable — a ~10% margin keeps the wordmark from clipping for most names.
 *
 * Pure and never throws. Callers should treat the output as a complete
 * standalone SVG file ready to write to disk.
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

export type WordmarkInput = {
  firmName: string
  primaryColor: string  // hex like "#003B71"
  headingFont: string   // Google font family name like "Public Sans"
}

export type WordmarkOutput = {
  svg: string
  filename: string  // e.g., "korbey-lague-pllp-wordmark.svg"
}

export function generateWordmarkSvg(input: WordmarkInput): WordmarkOutput {
  const safeName = escapeXmlText(input.firmName.trim() || 'Firm')

  // Heuristic char width at 28px font-size, biased slightly wide so a long
  // name like "Korbey Lague PLLP" doesn't clip past the right edge.
  const fontSize = 28
  const padding = 16
  const estimatedWidth = Math.max(160, Math.round(input.firmName.length * 17) + padding * 2)
  const height = 44

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${estimatedWidth} ${height}" width="${estimatedWidth}" height="${height}" role="img" aria-label="${safeName} wordmark">
  <text x="${padding}" y="${Math.round(height * 0.72)}" font-family="${escapeXmlText(input.headingFont)}, Georgia, serif" font-weight="700" font-size="${fontSize}" fill="${input.primaryColor}">${safeName}</text>
</svg>
`

  const slug = input.firmName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'firm'

  return { svg, filename: `${slug}-wordmark.svg` }
}
