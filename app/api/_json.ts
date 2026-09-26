import type { UIMessage } from 'ai'
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

// Shape check for a useChat request's `messages`: an array of objects each with
// a string `role` and a `parts` array. Chat routes run this before touching the
// messages so a malformed body is a 400, not a crash in trimMessages /
// convertToModelMessages.
export function isUiMessageArray(value: unknown): value is UIMessage[] {
  return (
    Array.isArray(value) &&
    value.every(
      (m: unknown) =>
        !!m &&
        typeof m === 'object' &&
        typeof (m as { role?: unknown }).role === 'string' &&
        Array.isArray((m as { parts?: unknown }).parts)
    )
  )
}
