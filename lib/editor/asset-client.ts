// Browser-side helpers for the editor's image routes. Kept tiny and framework-
// free so both the inline replace control and the media library share one
// implementation of the upload/delete contract.

export type AssetEntry = { path: string; sha: string; size: number | null }

async function errorMessage(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  return data.error ?? `Request failed: ${res.status}`
}

export async function listAssets(sessionId: string): Promise<AssetEntry[]> {
  const res = await fetch(`/api/edit/${sessionId}/assets`)
  if (!res.ok) throw new Error(await errorMessage(res))
  const data = (await res.json()) as { assets: AssetEntry[] }
  return data.assets
}

async function putAsset(
  sessionId: string,
  file: File,
  assetPath: string,
  mode: 'create' | 'replace',
  expectedSha?: string
): Promise<{ blobSha: string }> {
  const form = new FormData()
  form.append('file', file)
  form.append('path', assetPath)
  form.append('mode', mode)
  if (expectedSha) form.append('expectedSha', expectedSha)
  const res = await fetch(`/api/edit/${sessionId}/asset`, { method: 'PUT', body: form })
  if (!res.ok) throw new Error(await errorMessage(res))
  return (await res.json()) as { blobSha: string }
}

export function replaceAsset(
  sessionId: string,
  file: File,
  assetPath: string,
  expectedSha?: string
): Promise<{ blobSha: string }> {
  return putAsset(sessionId, file, assetPath, 'replace', expectedSha)
}

export function createAsset(
  sessionId: string,
  file: File,
  assetPath: string
): Promise<{ blobSha: string }> {
  return putAsset(sessionId, file, assetPath, 'create')
}

export async function deleteAsset(
  sessionId: string,
  assetPath: string,
  sha: string
): Promise<void> {
  const res = await fetch(
    `/api/edit/${sessionId}/asset?path=${encodeURIComponent(assetPath)}&sha=${encodeURIComponent(sha)}`,
    { method: 'DELETE' }
  )
  if (!res.ok) throw new Error(await errorMessage(res))
}
