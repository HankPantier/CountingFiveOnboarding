/**
 * Keeps a locally-buffered FAQ editor in sync with externally-changed props.
 *
 * The inline FAQ editor holds a local buffer (so in-progress blank rows
 * survive) and keeps a stable React key (every keystroke round-trips the body).
 * That meant an EXTERNAL change — AI edit reload, source-mode edit, conflict
 * "take theirs" — never reached the buffer. The parent persists the buffer with
 * blank rows dropped, so compare on that normalized form: our own echo matches
 * the local buffer; anything else is external and must reseed.
 */
export type QaItem = { question: string; answer: string }

export function faqSignature(items: readonly QaItem[]): string {
  return JSON.stringify(
    items
      .filter((it) => it.question.trim() !== '' || it.answer.trim() !== '')
      .map((it) => [it.question, it.answer])
  )
}

/**
 * True when `incoming` props changed since `seenSignature` AND don't match the
 * local buffer — i.e. an external edit the buffer must adopt.
 */
export function isExternalFaqChange(
  incoming: readonly QaItem[],
  seenSignature: string,
  local: readonly QaItem[],
): boolean {
  const sig = faqSignature(incoming)
  return sig !== seenSignature && sig !== faqSignature(local)
}
