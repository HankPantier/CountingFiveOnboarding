/**
 * Truncates text to fit within an approximate token budget.
 * Uses the rough heuristic of 1 token ≈ 4 characters.
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4
  if (text.length <= maxChars) return text
  // Cut at a word boundary
  const truncated = text.slice(0, maxChars).replace(/\s\S*$/, '')
  return truncated + '...'
}

/**
 * Logs a warning if input tokens exceed the budget threshold.
 */
export function checkTokenBudget(
  label: string,
  pageUrl: string,
  inputTokens: number | undefined,
  budgetMax: number
): void {
  if (!inputTokens) return
  if (inputTokens > 8000) {
    console.warn(
      `[content-gen] ⚠️ Token budget exceeded: page="${pageUrl}" input=${inputTokens.toLocaleString()}`
    )
  } else if (inputTokens > budgetMax) {
    console.warn(
      `[content-gen] Token over target: ${label} page="${pageUrl}" input=${inputTokens} (target: ${budgetMax})`
    )
  }
}
