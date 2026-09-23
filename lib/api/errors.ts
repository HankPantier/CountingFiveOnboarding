import { NextResponse } from 'next/server'

export interface ApiErrorBody {
  error: string
}

export const DEFAULT_PUBLIC_ERROR = 'Something went wrong. Please try again.'

/**
 * Log an unexpected server-side failure and return a generic JSON error.
 *
 * Raw error text from Supabase (PostgrestError / StorageError / AuthError),
 * GitHub/Octokit, or fetch can leak table/constraint names, repo names and
 * rate-limit internals, so it is logged server-side only. The browser gets
 * `publicMessage` (or a generic fallback). Use this for 5xx paths; domain
 * errors our own code constructs for the UI (4xx) should keep their message.
 */
export function internalError(
  context: string,
  err: unknown,
  publicMessage?: string,
  status = 500,
): NextResponse<ApiErrorBody> {
  console.error(`[${context}]`, err)
  return NextResponse.json({ error: publicMessage ?? DEFAULT_PUBLIC_ERROR }, { status })
}
