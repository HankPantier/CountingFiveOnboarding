// ---------------------------------------------------------------------------
// Resumable (TUS) upload for large objects — server-only.
//
// Supabase Storage's standard upload (`supabase.storage.from().upload()`, a
// single POST /object) rejects large request bodies well under the bucket's
// configured file_size_limit: a ~45MB deliverable zip fails fast with EPIPE
// ("fetch failed") even though session-assets allows 300MB. Supabase's
// documented remedy for files >6MB is the resumable TUS endpoint, which
// accepts the payload in 6MB chunks. This module is that uploader.
//
// Server-only: it authenticates with SUPABASE_SERVICE_ROLE_KEY. Never import
// it into a client component.
// ---------------------------------------------------------------------------

// Supabase's resumable endpoint requires a fixed 6MB part size for every chunk
// except the last. Do not change without checking Supabase's TUS constraints.
const CHUNK_SIZE = 6 * 1024 * 1024

// Files at or above this size must not use the standard upload path. Matches
// Supabase's own "use resumable for files larger than 6MB" guidance.
export const RESUMABLE_THRESHOLD = 6 * 1024 * 1024

// A transient PATCH can be reset (EPIPE) mid-upload; the protocol lets us
// resync the offset from the server and resume rather than restart.
const MAX_CHUNK_RETRIES = 4

const b64 = (v: string) => Buffer.from(v).toString('base64')

export interface ResumableUploadOptions {
  bucket: string
  path: string
  body: Buffer
  contentType: string
  upsert?: boolean
}

export async function resumableUpload(opts: ResumableUploadOptions): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!baseUrl || !key) throw new Error('Supabase env missing for resumable upload')

  // Supabase's TUS create does not honor the x-upsert header: a resumable
  // upload targeting an object that already exists is refused with 409 "The
  // resource already exists" (unlike the standard upload's atomic overwrite).
  // Since callers upsert a single canonical path, delete the prior object
  // first. Best-effort — a 404 (nothing there yet) is expected and ignored.
  if (opts.upsert) {
    const encodedPath = opts.path.split('/').map(encodeURIComponent).join('/')
    await fetch(`${baseUrl}/storage/v1/object/${opts.bucket}/${encodedPath}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${key}`, apikey: key },
    }).catch(() => null)
  }

  const uploadMetadata = [
    `bucketName ${b64(opts.bucket)}`,
    `objectName ${b64(opts.path)}`,
    `contentType ${b64(opts.contentType)}`,
    `cacheControl ${b64('3600')}`,
  ].join(',')

  const createRes = await fetch(`${baseUrl}/storage/v1/upload/resumable`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      apikey: key,
      'tus-resumable': '1.0.0',
      'upload-length': String(opts.body.length),
      'upload-metadata': uploadMetadata,
      'x-upsert': opts.upsert ? 'true' : 'false',
    },
  })
  if (createRes.status !== 201) {
    const detail = await createRes.text().catch(() => '')
    throw new Error(`resumable create failed: HTTP ${createRes.status} ${detail}`.trim())
  }
  const location = createRes.headers.get('location')
  if (!location) throw new Error('resumable create returned no Location header')

  const total = opts.body.length
  let offset = 0
  let failures = 0
  while (offset < total) {
    const end = Math.min(offset + CHUNK_SIZE, total)
    try {
      // Copy the chunk into a standalone ArrayBuffer. A Node Buffer / typed
      // array carries an `ArrayBufferLike` generic that BodyInit won't accept,
      // whereas a concrete ArrayBuffer is a valid fetch body.
      const chunk = new ArrayBuffer(end - offset)
      new Uint8Array(chunk).set(opts.body.subarray(offset, end))
      const patchRes = await fetch(location, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${key}`,
          apikey: key,
          'tus-resumable': '1.0.0',
          'upload-offset': String(offset),
          'content-type': 'application/offset+octet-stream',
        },
        body: chunk,
      })
      if (patchRes.status !== 204) {
        const detail = await patchRes.text().catch(() => '')
        throw new Error(`HTTP ${patchRes.status} ${detail}`.trim())
      }
      offset = Number(patchRes.headers.get('upload-offset') ?? end)
      failures = 0
    } catch (err) {
      failures++
      if (failures >= MAX_CHUNK_RETRIES) {
        throw new Error(
          `resumable upload failed at offset ${offset}/${total}: ${describeError(err)}`
        )
      }
      // A reset here is usually a stale keep-alive socket in undici's pool
      // being reused and immediately dropped (EPIPE/ECONNRESET). Back off so
      // the pool can retire the dead connection before we retry.
      await sleep(500 * failures)
      // Resync the true offset from the server (a partial PATCH may have
      // landed) and resume from there rather than restarting the whole file.
      const head = await fetch(location, {
        method: 'HEAD',
        headers: { authorization: `Bearer ${key}`, apikey: key, 'tus-resumable': '1.0.0' },
      }).catch(() => null)
      if (head && head.status >= 200 && head.status < 300) {
        const serverOffset = Number(head.headers.get('upload-offset'))
        if (Number.isFinite(serverOffset)) offset = serverOffset
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = (err as Error & { cause?: unknown }).cause
  if (cause && typeof cause === 'object' && 'code' in cause) {
    return `${err.message} (${String((cause as { code: unknown }).code)})`
  }
  return err.message
}
