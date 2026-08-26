import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { asJson } from '@/lib/supabase/json-typed'
import { resolveStockPhotos, type ImageRef, type StockPhotoMetadata } from './stock-photo-resolver'

// The resolver's cost is the SEQUENTIAL Phase-1 Pexels search. These tests pin
// the idempotency the one-click publish flow relies on: once photos are in the
// `assets` table, a re-run does ZERO Pexels round-trips (so the subsequent
// assemble skips it and stays within its maxDuration).
const searchPexelsTop = vi.fn()
const downloadPexelsImage = vi.fn()
vi.mock('./pexels-fetcher', () => ({
  searchPexelsTop: (...args: unknown[]) => searchPexelsTop(...args),
  downloadPexelsImage: (...args: unknown[]) => downloadPexelsImage(...args),
}))

type AssetRow = Database['public']['Tables']['assets']['Row']

function stockAsset(fileName: string, pexelsId: number): AssetRow {
  const metadata: StockPhotoMetadata = {
    source: 'pexels',
    pexels_id: pexelsId,
    photographer: 'X',
    photographer_url: 'https://x',
    pexels_url: 'https://x',
    original_query: 'a',
    final_query: 'a, clean',
    avg_color: '#000000',
  }
  return {
    id: `asset-${pexelsId}`,
    session_id: 's1',
    file_name: fileName,
    storage_path: `sessions/s1/${fileName}`,
    public_url: null,
    mime_type: 'image/jpeg',
    file_size_bytes: 1,
    asset_category: 'stock-photo',
    metadata: asJson(metadata),
    uploaded_at: '2026-01-01T00:00:00Z',
  }
}

// Phase 2 (download/upload/insert) never runs in these tests — every ref either
// reuses an existing asset or the mocked search returns no candidates — so the
// supabase client is never touched.
const supabase = {} as unknown as SupabaseClient<Database>

const ref = (filename: string, subjectQuery: string): ImageRef => ({ pageUrl: '/p', filename, subjectQuery })

describe('resolveStockPhotos idempotency', () => {
  beforeEach(() => {
    searchPexelsTop.mockReset()
    downloadPexelsImage.mockReset()
  })

  it('skips the Pexels search entirely when every ref already has an asset', async () => {
    const imageRefs = [ref('hero-a.jpg', 'a'), ref('hero-b.jpg', 'b')]
    const existingAssets = [stockAsset('hero-a.jpg', 1), stockAsset('hero-b.jpg', 2)]

    const out = await resolveStockPhotos(
      { sessionId: 's1', apiKey: 'key', styleSuffix: 'clean', existingAssets, imageRefs },
      supabase
    )

    expect(searchPexelsTop).not.toHaveBeenCalled()
    // Existing Pexels metadata is surfaced for CREDITS.md.
    expect(out.map((r) => r.filename).sort()).toEqual(['hero-a.jpg', 'hero-b.jpg'])
  })

  it('searches once per DISTINCT filename when nothing is pre-resolved', async () => {
    searchPexelsTop.mockResolvedValue([]) // no candidates → no download/upload/insert
    const imageRefs = [ref('hero-a.jpg', 'a'), ref('hero-a.jpg', 'a'), ref('hero-b.jpg', 'b')]

    const out = await resolveStockPhotos(
      { sessionId: 's1', apiKey: 'key', styleSuffix: 'clean', existingAssets: [], imageRefs },
      supabase
    )

    expect(searchPexelsTop).toHaveBeenCalledTimes(2) // deduped by filename
    expect(out).toEqual([])
  })

  it('does no work and returns [] when the API key is missing', async () => {
    const out = await resolveStockPhotos(
      { sessionId: 's1', apiKey: '', styleSuffix: 'clean', existingAssets: [], imageRefs: [ref('h.jpg', 'a')] },
      supabase
    )

    expect(searchPexelsTop).not.toHaveBeenCalled()
    expect(out).toEqual([])
  })
})
