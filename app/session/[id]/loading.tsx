// Client-facing session chat takes a moment to load (session + transcript
// fetch); show a branded spinner instead of a blank screen.
export default function SessionLoading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-surface-page"
      role="status"
      aria-label="Loading your session"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border-default border-t-brand-cyan" />
    </div>
  )
}
