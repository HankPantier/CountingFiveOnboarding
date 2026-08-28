import { NextResponse } from 'next/server'

// Parse a JSON request body, returning a typed 400 NextResponse on malformed
// input instead of letting a bare `await req.json()` throw an unhandled 500.
// Callers short-circuit on a NextResponse, same convention as the auth gates:
//
//   const body = await readJsonBody<MyBody>(req)
//   if (body instanceof NextResponse) return body
//
// Use this only where a body is required. Routes that treat a missing/empty
// body as valid should keep their own try/catch that falls through instead.
export async function readJsonBody<T = unknown>(
  req: Request
): Promise<T | NextResponse> {
  try {
    return (await req.json()) as T
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
}
