import { StaleShaError } from '@/lib/github/repo-files'

// A tool-executor failure whose message was written for the user/model (e.g. the
// YAML frontmatter guard). Anything else is provider text.
export class ToolUserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolUserError'
  }
}

export const STALE_TOOL_MESSAGE =
  'This file changed on the server since it was loaded. Reload and try again.'

// Tool results stream to the browser in the UI message parts — including to
// Site Owners, who are external clients — so an executor must never return raw
// GitHub/Octokit or Supabase error text. Pass through only messages we wrote
// (ToolUserError) and the stale-sha conflict; log everything else server-side
// and return the fixed fallback.
export function toolError(context: string, err: unknown, fallback: string): { error: string } {
  if (err instanceof ToolUserError) return { error: err.message }
  if (err instanceof StaleShaError) return { error: STALE_TOOL_MESSAGE }
  console.error(`[${context}]`, err)
  return { error: fallback }
}
