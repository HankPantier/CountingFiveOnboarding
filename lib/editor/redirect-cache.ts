// Client-safe. After a server write removed rows from content/redirects.csv
// (a page was created or restored over a redirect), the editor's cached copy
// of redirects.csv carries the OLD blob sha, so saving it would 409. What to do
// with that cache entry:
//   'reload' — cached and not edited: re-fetch it (new content + sha);
//   'keep'   — the admin has unsaved edits in it: never overwrite them; the
//              next save surfaces the normal conflict bar, whose server copy
//              shows the removal;
//   'none'   — not cached: the next open fetches the fresh file anyway.
export const REDIRECTS_CSV_PATH = 'content/redirects.csv'

export function redirectsCacheAction(loaded: ReadonlyMap<string, unknown>, dirty: ReadonlyMap<string, unknown>): 'reload' | 'keep' | 'none' {
  if (!loaded.has(REDIRECTS_CSV_PATH)) return 'none'
  return dirty.has(REDIRECTS_CSV_PATH) ? 'keep' : 'reload'
}
