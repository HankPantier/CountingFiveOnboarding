import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { Vibrant } from 'node-vibrant/node'
import chroma from 'chroma-js'

export const runtime = 'nodejs'

import type { PaletteData } from '@/types/palette'
export type { PaletteData, PaletteSwatch } from '@/types/palette'

function ensureContrast(dark: string, light: string): { dark: string; light: string } {
  let d = dark
  let l = light
  let attempts = 0
  while (chroma.contrast(d, l) < 4.5 && attempts < 20) {
    d = chroma(d).darken(0.3).hex()
    l = chroma(l).brighten(0.3).hex()
    attempts++
  }
  return { dark: d, light: l }
}

export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const { sessionId }: { sessionId: string } = await req.json()

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
  }

  const supabase = createServerClient()

  // Find the logo asset
  const { data: logoAsset } = await supabase
    .from('assets')
    .select('storage_path, file_name, mime_type')
    .eq('session_id', sessionId)
    .eq('asset_category', 'logo')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .single()

  if (!logoAsset) {
    // Return default brand palette when no logo is available
    const palette: PaletteData = {
      primary:       { hex: '#003B71', name: 'Primary' },
      secondary:     { hex: '#00C1DE', name: 'Secondary' },
      complementary: { hex: '#71003B', name: 'Complementary' },
      action:        { hex: '#DE00C1', name: 'Action' },
      nearBlack:     { hex: '#1A1A2E', name: 'Text / Dark' },
      nearWhite:     { hex: '#F5F7FA', name: 'Background / Light' },
    }
    return NextResponse.json({ palette, fromLogo: false })
  }

  // Fetch logo from Supabase Storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('session-assets')
    .download(logoAsset.storage_path)

  if (downloadError || !fileData) {
    return NextResponse.json({ error: 'Failed to download logo' }, { status: 500 })
  }

  const buffer = Buffer.from(await fileData.arrayBuffer())

  try {
    const vibrantPalette = await Vibrant.from(buffer).getPalette()

    const primary = vibrantPalette.Vibrant?.hex ?? '#003B71'
    const secondary = vibrantPalette.DarkVibrant?.hex ?? vibrantPalette.Muted?.hex ?? '#00C1DE'

    const complementary = chroma(primary)
      .set('hsl.h', (chroma(primary).get('hsl.h') + 180) % 360)
      .hex()

    const action = chroma(complementary).saturate(1).brighten(0.5).hex()

    let nearBlack = chroma(primary).darken(2.5).desaturate(0.3).hex()
    let nearWhite = chroma(secondary).brighten(3).desaturate(1.5).hex()

    // Ensure WCAG AA contrast ratio
    const adjusted = ensureContrast(nearBlack, nearWhite)
    nearBlack = adjusted.dark
    nearWhite = adjusted.light

    const palette: PaletteData = {
      primary:       { hex: primary, name: 'Primary' },
      secondary:     { hex: secondary, name: 'Secondary' },
      complementary: { hex: complementary, name: 'Complementary' },
      action:        { hex: action, name: 'Action' },
      nearBlack:     { hex: nearBlack, name: 'Text / Dark' },
      nearWhite:     { hex: nearWhite, name: 'Background / Light' },
    }

    return NextResponse.json({ palette, fromLogo: true })
  } catch (err) {
    console.error('[palette] Vibrant extraction failed:', err)
    return NextResponse.json({ error: 'Palette extraction failed' }, { status: 500 })
  }
}
