'use client'

// Shared banner shown wherever an AI request fails, so every surface reports a
// possible Claude API issue the same way. The `message` is produced server-side
// by lib/ai/ai-error.ts (classifyAiError / aiStreamErrorMessage) and already
// carries the status-page URL and next steps; this just presents it and offers
// a one-tap Retry. Warning tokens (not error) because these are "try again"
// situations, not hard failures.
export default function AiIssueNotice({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div
      role="alert"
      className="px-4 py-2.5 bg-warning/10 border-t border-warning/30 font-body text-sm text-warning-strong"
    >
      <p>{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1.5 rounded-pill bg-brand-cyan px-3 py-1 font-heading text-xs font-semibold text-text-inverse transition-colors hover:bg-brand-cyan-dark"
        >
          Retry
        </button>
      )}
    </div>
  )
}
