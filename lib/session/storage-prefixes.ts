// Every `session-assets` storage prefix that holds objects owned by one
// session. Session DELETE lists + removes all of them BEFORE the row cascade
// (after the cascade nothing references the objects any more, so they could
// never be found again). Design Studio (migration 078) keeps input captures,
// uploads, run/chat/version renders and chat attachments under `design/{id}`.
export function sessionStoragePrefixes(sessionId: string): string[] {
  return [
    `sessions/${sessionId}`,
    `pdfs/${sessionId}`,
    `content-packages/${sessionId}`,
    `design/${sessionId}`,
  ]
}
