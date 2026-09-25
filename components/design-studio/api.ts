// Client-side fetch helper for the Design Studio routes: JSON or multipart in,
// typed JSON out. A non-2xx response throws with the route's own { error }.
type ApiInit = { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; json?: unknown; form?: FormData }

export async function designApi<T = unknown>(url: string, init: ApiInit = {}): Promise<T> {
  const headers: HeadersInit | undefined = init.json !== undefined ? { 'Content-Type': 'application/json' } : undefined
  const body: BodyInit | undefined = init.json !== undefined ? JSON.stringify(init.json) : init.form
  const res = await fetch(url, { method: init.method ?? 'GET', headers, body })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : `Request failed (${res.status})`
    throw new Error(message)
  }
  return data as T
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}
