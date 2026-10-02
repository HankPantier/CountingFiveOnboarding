import type { createServerClient } from '@/lib/supabase/server'

type Supabase = ReturnType<typeof createServerClient>

// Make `storagePath` (already in the private session-assets bucket) the
// session's single `logo` asset: earlier logo rows and their files are removed,
// then one row is inserted (public_url stays null — the bucket is private).
// Shared by the onboarding logo confirm route and the Theme Studio logo upload,
// so the palette step, packaging and the Divi export all read the same file.
export async function replaceSessionLogoRow(
  supabase: Supabase,
  sessionId: string,
  file: { storagePath: string; fileName: string; mime: string; size: number }
): Promise<{ ok: true; assetId: string } | { ok: false; error: unknown }> {
  const { data: prior, error: priorErr } = await supabase
    .from('assets')
    .select('storage_path')
    .eq('session_id', sessionId)
    .eq('asset_category', 'logo')
  if (priorErr) return { ok: false, error: priorErr }
  const priorPaths = (prior ?? [])
    .map((p) => p.storage_path)
    .filter((p): p is string => !!p && p !== file.storagePath)
  if (priorPaths.length > 0) {
    await supabase.storage.from('session-assets').remove(priorPaths)
  }
  await supabase.from('assets').delete().eq('session_id', sessionId).eq('asset_category', 'logo')

  const { data: asset, error: insertErr } = await supabase
    .from('assets')
    .insert({
      session_id: sessionId,
      file_name: file.fileName,
      storage_path: file.storagePath,
      public_url: null,
      mime_type: file.mime,
      file_size_bytes: file.size,
      asset_category: 'logo',
    })
    .select('id')
    .single()
  if (insertErr || !asset) return { ok: false, error: insertErr }
  return { ok: true, assetId: asset.id }
}
