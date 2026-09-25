// Client-side fetch helper for the Design Studio routes: JSON or multipart in,
// typed JSON out. A non-2xx response throws with the route's own { error }.
type ApiInit = { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; json?: unknown; form?: FormData }

// The platform itself can reject an oversized request body before it ever
// reaches our route (a non-JSON 413), so that status gets a specific,
// friendly message instead of the generic "Request failed (413)".
const PAYLOAD_TOO_LARGE_MESSAGE = 'That image is too large to upload — try a smaller file.'

// Thrown for a non-2xx response. `message` is what the UI has always shown;
// `status` + `body` let a caller map specific refusals (e.g. apply's stale 409).
export class DesignApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message)
    this.name = 'DesignApiError'
  }
}

export async function designApi<T = unknown>(url: string, init: ApiInit = {}): Promise<T> {
  const headers: HeadersInit | undefined = init.json !== undefined ? { 'Content-Type': 'application/json' } : undefined
  const body: BodyInit | undefined = init.json !== undefined ? JSON.stringify(init.json) : init.form
  const res = await fetch(url, { method: init.method ?? 'GET', headers, body })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const jsonMessage = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : null
    const message = jsonMessage ?? (res.status === 413 ? PAYLOAD_TOO_LARGE_MESSAGE : `Request failed (${res.status})`)
    throw new DesignApiError(message, res.status, data)
  }
  return data as T
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}
