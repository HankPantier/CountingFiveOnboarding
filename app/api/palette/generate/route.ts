import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { readJsonBody } from '@/app/api/_json'
import { Vibrant } from 'node-vibrant/node'
import { derivePalette, NEUTRAL_PALETTE } from '@/lib/content/derive-palette'
import { extractSvgColors, pickBrandColors } from '@/lib/content/svg-colors'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type { PaletteData, PaletteSwatch } from '@/types/palette'

export async function POST(req: Request) {
  const body = await readJsonBody<{ sessionId?: string }>(req)
  if (body instanceof NextResponse) return body
  const sessionId = body?.sessionId

  if (!sessionId || !UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'Missing or invalid sessionId' }, { status: 400 })
  }

  const auth = await requireSessionAccess(sessionId)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()

  const { data: logoAsset } = await supabase
    .from('assets')
    .select('storage_path, file_name, mime_type')
    .eq('session_id', sessionId)
    .eq('asset_category', 'logo')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .single()

  if (!logoAsset) {
    return NextResponse.json({ palette: NEUTRAL_PALETTE, fromLogo: false })
  }

  const { data: fileData, error: downloadError } = await supabase.storage
    .from('session-assets')
    .download(logoAsset.storage_path)

  if (downloadError || !fileData) {
    return NextResponse.json({ error: 'Failed to download logo' }, { status: 500 })
  }

  const buffer = Buffer.from(await fileData.arrayBuffer())

  // SVG: derive from the vector's own colors (no rasterizer needed).
  if (logoAsset.mime_type === 'image/svg+xml') {
    const picked = pickBrandColors(extractSvgColors(buffer.toString('utf-8')))
    if (!picked) {
      return NextResponse.json({ palette: NEUTRAL_PALETTE, fromLogo: false })
    }
    return NextResponse.json({ palette: derivePalette(picked.primary, picked.secondary), fromLogo: true })
  }

  // Raster: sample the dominant colors. Decode failure degrades to defaults
  // rather than erroring out the step.
  try {
    const vibrant = await Vibrant.from(buffer).getPalette()
    const primary = vibrant.Vibrant?.hex ?? NEUTRAL_PALETTE.primary.hex
    const secondary = vibrant.DarkVibrant?.hex ?? vibrant.Muted?.hex ?? NEUTRAL_PALETTE.secondary.hex
    return NextResponse.json({ palette: derivePalette(primary, secondary), fromLogo: true })
  } catch (err) {
    console.warn('[palette] raster extraction failed, using defaults:', err)
    return NextResponse.json({ palette: NEUTRAL_PALETTE, fromLogo: false })
  }
}
