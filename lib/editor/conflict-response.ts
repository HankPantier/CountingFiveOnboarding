// Shape of a 409 from the editor's save routes (PATCH /files, POST /nav).
// Only `error: 'stale_sha'` with the server's sha + content is a conflict on
// the file being saved (the conflict bar can offer "keep mine / take theirs").
// Any other 409 (e.g. the nav save's page file or redirects.csv went stale
// mid-save) is a plain error message.
export interface ConflictResponse {
  error?: string
  message?: string
  currentSha?: string
  currentContent?: string
}

export function isStaleShaConflict(
  data: ConflictResponse
): data is ConflictResponse & { currentSha: string; currentContent: string } {
  return data.error === 'stale_sha' && typeof data.currentSha === 'string' && typeof data.currentContent === 'string'
}

// A stale sha on a file OTHER than nav.json during a nav save: say which one.
// The client shows it as a plain error (never the nav conflict bar).
export function staleOtherFileMessage(path: string): string {
  return path === 'content/redirects.csv'
    ? 'content/redirects.csv changed while saving, so the new redirects were not all written. Pages may already have moved; reload the editor and check the moved pages and redirects.csv.'
    : `The page file ${path} changed while saving (someone else edited or moved it). Reload the editor and save the navigation again.`
}
